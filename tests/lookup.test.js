import { test } from "node:test";
import assert from "node:assert/strict";
import { createLookup, choose, timingMatches, describe, queryOverlap, dedupe } from "../background/lookup.js";

const track = { title: "Rino Hercules", artists: ["Summrs", "PlaqueBoyMax"], duration: 190 };
const hit = (source, extra = {}) => ({ source, ref: 1, title: "Rino Hercules", artist: "Summrs", duration: 190, ...extra });
const lines = (synced) => (synced ? [{ t: 1, text: "a" }, { t: 2, text: "b" }] : [{ text: "a" }, { text: "b" }]);

// A fake source: search returns `results`, fetchLyrics returns `lyrics` (or throws).
function source(name, { results = [hit(name)], lyrics, searchError, fetchError, delay = 0 } = {}) {
  return {
    name,
    autoQuery: () => ({ q: "x" }),
    async search() {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (searchError) throw new Error(searchError);
      return results;
    },
    async fetchLyrics(c) {
      if (fetchError) throw new Error(fetchError);
      return lyrics === undefined ? { source: name, synced: false, lines: lines(false), duration: c.duration } : lyrics;
    },
  };
}

const quietLog = { warn() {}, info() {}, debug() {}, error() {} };

test("prefers synced LRCLIB, then synced NetEase, then Genius", () => {
  const g = { source: "Genius", synced: false, lines: lines(false) };
  const l = { source: "LRCLIB", synced: true, lines: lines(true), duration: 190 };
  const n = { source: "NetEase", synced: true, lines: lines(true), duration: 190 };
  assert.equal(choose([g, n, l], 190).source, "LRCLIB");
  assert.equal(choose([g, n], 190).source, "NetEase");
  assert.equal(choose([g], 190).source, "Genius");
  assert.equal(choose([], 190), null);
});

test("synced lyrics for a different recording length lose their timing", () => {
  const l = { source: "LRCLIB", synced: true, lines: lines(true), duration: 240 };
  const r = choose([l], 190);
  assert.equal(r.synced, false);
  assert.deepEqual(r.lines, [{ text: "a" }, { text: "b" }]);
  // ...but Genius wins over mistimed synced lyrics
  assert.equal(choose([l, { source: "Genius", synced: false, lines: lines(false) }], 190).source, "Genius");
});

test("timingMatches tolerates 3s and unknown durations", () => {
  assert.ok(timingMatches({ duration: 192 }, 190));
  assert.ok(!timingMatches({ duration: 195 }, 190));
  assert.ok(timingMatches({ duration: null }, 190));
  assert.ok(timingMatches({ duration: 100 }, null));
});

test("find: picks the synced result and writes a trace", async () => {
  const lookup = createLookup({
    log: quietLog,
    sources: [
      source("Genius"),
      source("LRCLIB", { lyrics: { source: "LRCLIB", synced: true, lines: lines(true), duration: 190 } }),
      source("NetEase", { results: [] }),
    ],
  });
  const { result, trace, errors } = await lookup.find(track);
  assert.equal(result.status, "found");
  assert.equal(result.source, "LRCLIB");
  assert.equal(errors, 0);
  assert.ok(trace.some((l) => l.startsWith("NetEase: 0 results")));
  assert.ok(trace.at(-1).includes("LRCLIB (synced)"));
});

test("find: doesn't wait for slow sources once synced LRCLIB lyrics arrive", async () => {
  const lookup = createLookup({
    log: quietLog,
    sources: [
      source("Genius", { delay: 1000 }),
      source("LRCLIB", { lyrics: { source: "LRCLIB", synced: true, lines: lines(true), duration: 190 } }),
    ],
  });
  const t0 = Date.now();
  const { result, trace } = await lookup.find(track);
  assert.ok(Date.now() - t0 < 500, "should not wait for Genius");
  assert.equal(result.source, "LRCLIB");
  assert.ok(trace.includes("(didn't wait for Genius)"));
});

test("find: still waits for everything when LRCLIB has no synced lyrics", async () => {
  const lookup = createLookup({
    log: quietLog,
    sources: [source("Genius", { delay: 100 }), source("LRCLIB")],
  });
  const { result } = await lookup.find(track);
  assert.equal(result.source, "Genius");
});

test("find: one source crashing doesn't stop the others", async () => {
  const lookup = createLookup({
    log: quietLog,
    sources: [source("Genius", { searchError: "HTTP 403 from genius.com" }), source("LRCLIB"), source("NetEase", { fetchError: "bad json" })],
  });
  const { result, errors, trace } = await lookup.find(track);
  assert.equal(result.source, "LRCLIB");
  assert.equal(errors, 2);
  assert.ok(trace.some((l) => l.includes("Genius: ERROR HTTP 403")));
});

test("find: every source failing is an error (not cached as 'not found')", async () => {
  const lookup = createLookup({
    log: quietLog,
    sources: [source("Genius", { searchError: "offline" }), source("LRCLIB", { searchError: "offline" }), source("NetEase", { searchError: "offline" })],
  });
  const { result, errors } = await lookup.find(track);
  assert.equal(result.status, "error");
  assert.equal(errors, 3);
});

test("find: weak matches are rejected → not found", async () => {
  const wrong = [{ source: "x", ref: 1, title: "Totally Different", artist: "Someone Else" }];
  const lookup = createLookup({
    log: quietLog,
    sources: [source("Genius", { results: wrong }), source("LRCLIB", { results: wrong })],
  });
  const { result, errors } = await lookup.find(track);
  assert.equal(result.status, "notFound");
  assert.equal(errors, 0);
});

test("find: a match whose page has no lyrics (instrumental) → not found", async () => {
  const lookup = createLookup({ log: quietLog, sources: [source("Genius", { lyrics: null })] });
  assert.equal((await lookup.find(track)).result.status, "notFound");
});

test("search: merges and ranks every source, without heavy records", async () => {
  const lookup = createLookup({
    log: quietLog,
    sources: [
      source("Genius", { results: [hit("Genius", { title: "Hercules", artist: "Lelo" })] }),
      source("LRCLIB", { results: [hit("LRCLIB", { record: { syncedLyrics: "big" } })] }),
      source("NetEase", { searchError: "down" }),
    ],
  });
  const { candidates, trace } = await lookup.search("rino hercules", track);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].source, "LRCLIB");
  assert.equal(candidates[0].record, undefined);
  assert.ok(trace.some((l) => l.includes("NetEase: ERROR down")));
});

test("search: drops results that share no word with the query", async () => {
  const lookup = createLookup({
    log: quietLog,
    sources: [
      source("NetEase", {
        results: [
          { source: "NetEase", ref: 1, title: "那些年", artist: "胡夏" },
          { source: "NetEase", ref: 2, title: "Rino Hercules", artist: "Summrs" },
        ],
      }),
    ],
  });
  const { candidates, trace } = await lookup.search("Summrs Rino Hercules", track);
  assert.deepEqual(candidates.map((c) => c.ref), [2]);
  assert.ok(trace.some((l) => l.includes("dropped 1")));
});

test("dedupe keeps one copy per song, preferring synced", () => {
  const out = dedupe([
    { source: "LRCLIB", title: "Rino Hercules", artist: "Summrs", duration: 190, synced: false, ref: 1 },
    { source: "LRCLIB", title: "Rino Hercules", artist: "summrs", duration: 189.96, synced: true, ref: 2 },
    { source: "LRCLIB", title: "Rino Hercules", artist: "Summrs", duration: 190, synced: true, ref: 3 },
    { source: "Genius", title: "Rino Hercules", artist: "Summrs", duration: null, ref: 4 },
    { source: "LRCLIB", title: "Rino Hercules", artist: "Summrs", duration: 250, synced: true, ref: 5 },
  ]);
  assert.deepEqual(out.map((c) => c.ref), [2, 4, 5]);
});

test("queryOverlap works with non-Latin queries", () => {
  assert.equal(queryOverlap("夜に駆ける", { title: "夜に駆ける", artist: "YOASOBI" }), 1);
  assert.equal(queryOverlap("summrs rino", { title: "Rino Hercules", artist: "Summrs" }), 1);
  assert.equal(queryOverlap("summrs rino", { title: "那些年", artist: "胡夏" }), 0);
  assert.equal(queryOverlap("", { title: "x", artist: "y" }), 0);
});

test("fetchCandidate: unknown source is a clear error", async () => {
  const lookup = createLookup({ log: quietLog, sources: [source("Genius")] });
  await assert.rejects(lookup.fetchCandidate({ source: "Nope" }), /unknown source/);
});

test("describe gives a one-line summary", () => {
  assert.equal(describe({ status: "found", source: "LRCLIB", synced: true, lines: [1, 2] }), "LRCLIB synced, 2 lines");
  assert.equal(describe({ status: "notFound" }), "not found");
  assert.equal(describe({ status: "error", error: "x" }), "error: x");
  assert.equal(describe(null), "nothing");
});
