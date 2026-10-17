import { test } from "node:test";
import assert from "node:assert/strict";
import { createCache, LIMITS } from "../background/cache.js";

// In-memory stand-in for chrome.storage.local (structured-clones like the real one).
function fakeStorage({ quotaBytes = Infinity } = {}) {
  const data = {};
  const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  return {
    data,
    async get(keys) {
      if (keys == null) return clone(data);
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, clone(data[k])]));
    },
    async set(obj) {
      const next = { ...data, ...clone(obj) };
      if (JSON.stringify(next).length > quotaBytes) throw new Error("QUOTA_BYTES quota exceeded");
      Object.assign(data, clone(obj));
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
    },
  };
}

const DAY = 24 * 3600 * 1000;
const found = (n = 1) => ({ result: { status: "found", source: "Genius", lines: [{ text: `line ${n}` }] } });
const notFound = () => ({ result: { status: "notFound" } });

function setup(limits = {}) {
  let t = 1_000_000_000_000;
  const storage = fakeStorage();
  const cache = createCache(storage, { now: () => t, limits: { ...LIMITS, ...limits } });
  return { storage, cache, advance: (ms) => (t += ms) };
}

test("stores and returns an entry", async () => {
  const { cache } = setup();
  await cache.put("a", found());
  const e = await cache.get("a");
  assert.equal(e.result.lines[0].text, "line 1");
  assert.equal(await cache.get("missing"), null);
});

test("evicts the least recently played when over the limit", async () => {
  const { cache, advance } = setup({ maxEntries: 3, touchEveryMs: 0 });
  await cache.put("a", found());
  advance(1000);
  await cache.put("b", found());
  advance(1000);
  await cache.put("c", found());
  advance(1000);
  await cache.get("a"); // a was played again: b is now the oldest
  advance(1000);
  await cache.put("d", found());
  assert.ok(await cache.peek("a"));
  assert.equal(await cache.peek("b"), null);
  assert.ok(await cache.peek("c"));
  assert.ok(await cache.peek("d"));
  assert.equal((await cache.stats()).count, 3);
});

test("forgets songs not played for 90 days", async () => {
  const { cache, advance } = setup();
  await cache.put("old", found());
  advance(91 * DAY);
  assert.equal(await cache.get("old"), null);
});

test("'not found' is retried after 3 days, found lyrics are kept", async () => {
  const { cache, advance } = setup();
  await cache.put("nf", notFound());
  await cache.put("ok", found());
  advance(2 * DAY);
  assert.ok(await cache.get("nf"));
  advance(2 * DAY);
  assert.equal(await cache.get("nf"), null);
  assert.ok(await cache.get("ok"));
});

test("hand-picked lyrics are never evicted or expired", async () => {
  const { cache, advance } = setup({ maxEntries: 2 });
  await cache.put("mine", found(), { pinned: true });
  for (const k of ["a", "b", "c", "d"]) {
    advance(1000);
    await cache.put(k, found());
  }
  advance(400 * DAY);
  assert.ok(await cache.get("mine"));
});

test("only rewrites lastPlayed once a day", async () => {
  const { cache, storage, advance } = setup();
  await cache.put("a", found());
  const before = storage.data.lyrIndex.a.lastPlayed;
  advance(3600 * 1000);
  await cache.get("a");
  assert.equal(storage.data.lyrIndex.a.lastPlayed, before);
  advance(DAY);
  await cache.get("a");
  assert.ok(storage.data.lyrIndex.a.lastPlayed > before);
});

test("concurrent puts don't lose index entries", async () => {
  const { cache } = setup();
  await Promise.all(Array.from({ length: 50 }, (_, i) => cache.put(`k${i}`, found(i))));
  assert.equal((await cache.stats()).count, 50);
});

test("entries from an older format are ignored and removed", async () => {
  const { cache, storage } = setup();
  await cache.put("a", found());
  storage.data["lyr:a"].v = 1;
  assert.equal(await cache.get("a"), null);
  assert.equal(storage.data.lyrIndex.a, undefined);
});

test("index pointing at a missing entry heals itself", async () => {
  const { cache, storage } = setup();
  await cache.put("a", found());
  delete storage.data["lyr:a"];
  assert.equal(await cache.get("a"), null);
  assert.equal((await cache.stats()).count, 0);
});

test("clear removes everything", async () => {
  const { cache, storage } = setup();
  await cache.put("a", found());
  await cache.put("b", found(), { pinned: true });
  await cache.clear();
  assert.deepEqual(Object.keys(storage.data), []);
});

test("a storage failure rejects that call but doesn't jam the queue", async () => {
  let t = 0;
  const storage = fakeStorage({ quotaBytes: 600 });
  const cache = createCache(storage, { now: () => ++t });
  const big = { result: { status: "found", lines: [{ text: "x".repeat(2000) }] } };
  await assert.rejects(cache.put("big", big), /quota/);
  await cache.put("small", found()); // still works afterwards
  assert.ok(await cache.get("small"));
});
