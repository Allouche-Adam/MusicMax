// Sources against canned API responses, including the broken ones.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHttp } from "../background/http.js";
import { createGenius } from "../background/sources/genius.js";
import { createLrclib } from "../background/sources/lrclib.js";
import { createNetease } from "../background/sources/netease.js";

// fetch stand-in: routes by URL substring → { status, body }.
function fakeFetch(routes) {
  return async (url) => {
    const route = Object.entries(routes).find(([part]) => url.includes(part));
    if (!route) return new Response("not found", { status: 404 });
    const r = typeof route[1] === "function" ? route[1](url) : route[1];
    const body = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return new Response(body, { status: r.status ?? 200 });
  };
}
const http = (routes) => createHttp(fakeFetch(routes), { timeoutMs: 500 });

test("LRCLIB: synced lyrics win over plain, instrumental is skipped", async () => {
  const lrclib = createLrclib(
    http({
      "api/search": {
        body: [
          { id: 1, trackName: "Song", artistName: "A", duration: 200, plainLyrics: "x\ny", syncedLyrics: "[00:01.00]x\n[00:02.00]y\n[00:03.00]z" },
          { id: 2, trackName: "Song", artistName: "A", duration: 200, instrumental: true, plainLyrics: "" },
        ],
      },
    })
  );
  const [c] = await lrclib.search({ title: "Song", artist: "A" });
  const res = await lrclib.fetchLyrics(c);
  assert.equal(res.synced, true);
  assert.equal(res.lines.length, 3);
  assert.equal(await lrclib.fetchLyrics({ record: { instrumental: true } }), null);
});

test("LRCLIB: a non-array response is treated as no results", async () => {
  const lrclib = createLrclib(http({ "api/search": { body: { error: "weird" } } }));
  assert.deepEqual(await lrclib.search({ q: "x" }), []);
});

test("NetEase: parses search and timed lyrics, strips credits", async () => {
  const ne = createNetease(
    http({
      "search/get": { body: { result: { songs: [{ id: 7, name: "Song", artists: [{ name: "A" }, { name: "B" }], duration: 200500 }] } } },
      "song/lyric": { body: { lrc: { lyric: "[00:00.00] 作词 : X\n[00:05.00]one\n[00:06.00]two\n[00:07.00]three" } } },
    })
  );
  const [c] = await ne.search({ q: "a song" });
  assert.equal(c.artist, "A, B");
  assert.equal(c.duration, 200.5);
  const res = await ne.fetchLyrics(c);
  assert.equal(res.synced, true);
  assert.deepEqual(res.lines.map((l) => l.text), ["one", "two", "three"]);
});

test("NetEase and LRCLIB requests never carry cookies", async () => {
  const seen = [];
  const spy = createHttp(async (url, opts) => {
    seen.push([new URL(url).host, opts.credentials]);
    return new Response(url.includes("lrclib") ? "[]" : JSON.stringify({ result: { songs: [] }, lrc: { lyric: "" } }));
  });
  await createNetease(spy).search({ q: "x" });
  await createNetease(spy).fetchLyrics({ ref: 1 });
  await createLrclib(spy).search({ q: "x" });
  assert.deepEqual(seen, [
    ["music.163.com", "omit"],
    ["music.163.com", "omit"],
    ["lrclib.net", "omit"],
  ]);
});

test("NetEase: instrumental, missing and 'no lyric' songs give null", async () => {
  const cases = [{ nolyric: true }, { uncollected: true }, { lrc: { lyric: "[00:00.00]纯音乐，请欣赏" } }, {}, { lrc: { lyric: "[00:01]only one line" } }];
  for (const body of cases) {
    const ne = createNetease(http({ "song/lyric": { body } }));
    assert.equal(await ne.fetchLyrics({ ref: 1 }), null, JSON.stringify(body));
  }
});

test("NetEase: an empty search result is an empty list", async () => {
  const ne = createNetease(http({ "search/get": { body: { result: {} } } }));
  assert.deepEqual(await ne.search({ q: "x" }), []);
});

test("Genius: search maps hits, Cloudflare block surfaces as a readable error", async () => {
  const ok = createGenius(
    http({
      "api/search/song": {
        body: { response: { sections: [{ hits: [{ result: { url: "https://genius.com/a", title: "Song", artist_names: "A" } }, { result: {} }] }] } },
      },
    })
  );
  const hits = await ok.search({ q: "a song" });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].ref, "https://genius.com/a");

  const blocked = createGenius(http({ "api/search/song": { status: 403, body: "<html>Just a moment...</html>" } }));
  await assert.rejects(blocked.search({ q: "x" }), /HTTP 403 from genius\.com/);
});

test("Genius: HTML instead of JSON is an error, not a crash elsewhere", async () => {
  const g = createGenius(http({ "api/search/song": { body: "<html>captcha</html>" } }));
  await assert.rejects(g.search({ q: "x" }));
});

test("http: slow servers time out with a clear message", async () => {
  const slow = createHttp(
    (url, { signal }) =>
      new Promise((_, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))),
    { timeoutMs: 50 }
  );
  await assert.rejects(slow.json("https://lrclib.net/api/search?q=x"), /timed out after 0.05s \(lrclib\.net\)/);
});

test("http: a 503 is retried once, then succeeds", async () => {
  let calls = 0;
  const flaky = createHttp(
    async () => (++calls === 1 ? new Response("busy", { status: 503 }) : new Response("[1]", { status: 200 })),
    { retryDelayMs: 1 }
  );
  assert.deepEqual(await flaky.json("https://lrclib.net/api/search?q=x"), [1]);
  assert.equal(calls, 2);
});

test("http: a 404 is not retried; a second 503 gives up", async () => {
  let calls = 0;
  const notFound = createHttp(async () => (calls++, new Response("", { status: 404 })), { retryDelayMs: 1 });
  await assert.rejects(notFound.json("https://lrclib.net/x"), /HTTP 404/);
  assert.equal(calls, 1);
  calls = 0;
  const down = createHttp(async () => (calls++, new Response("", { status: 503 })), { retryDelayMs: 1 });
  await assert.rejects(down.json("https://lrclib.net/x"), /HTTP 503/);
  assert.equal(calls, 2);
});

test("http: network failure passes through", async () => {
  const down = createHttp(async () => {
    throw new TypeError("Failed to fetch");
  });
  await assert.rejects(down.json("https://genius.com/x"), /Failed to fetch/);
});
