// Remembers lookups in chrome.storage.local so replays are instant and work offline.
//
//   - at most 500 songs; when full, the least recently played go first (LRU)
//   - a song not played for 90 days is forgotten
//   - "not found" is only remembered for 3 days, then searched again (lyrics get added later)
//   - songs whose lyrics the user picked by hand are never dropped
//
// Each song is its own storage key ("lyr:<key>"); a small index ("lyrIndex") holds
// lastPlayed/pinned for every song so trimming never has to load the lyrics.

export const LIMITS = {
  maxEntries: 500,
  maxIdleMs: 90 * 24 * 3600 * 1000,
  notFoundMs: 3 * 24 * 3600 * 1000,
  touchEveryMs: 24 * 3600 * 1000, // only rewrite lastPlayed once a day
};

const VERSION = 2;
const INDEX = "lyrIndex";
const k = (key) => `lyr:${key}`;

export function createCache(storage, { now = Date.now, limits = LIMITS, log } = {}) {
  // Storage calls are async; serialize writes so two lookups can't clobber the index.
  let chain = Promise.resolve();
  const locked = (fn) => {
    const run = chain.then(fn);
    chain = run.catch(() => {});
    return run;
  };

  async function readIndex() {
    return (await storage.get(INDEX))[INDEX] || {};
  }

  function expired(entry, meta, t) {
    if (meta.pinned) return false;
    if (t - meta.lastPlayed > limits.maxIdleMs) return true;
    return entry?.result?.status === "notFound" && t - entry.savedAt > limits.notFoundMs;
  }

  async function trim(index) {
    const t = now();
    const drop = [];
    for (const [key, meta] of Object.entries(index)) {
      // notFound expiry needs savedAt, which lives with the entry; idle expiry doesn't.
      if (!meta.pinned && t - meta.lastPlayed > limits.maxIdleMs) drop.push(key);
      else if (meta.notFound && t - meta.savedAt > limits.notFoundMs) drop.push(key);
    }
    const alive = Object.entries(index).filter(([key, meta]) => !drop.includes(key) && !meta.pinned);
    const pinnedCount = Object.keys(index).length - drop.length - alive.length;
    const over = alive.length + pinnedCount - limits.maxEntries;
    if (over > 0) {
      alive.sort((a, b) => a[1].lastPlayed - b[1].lastPlayed);
      drop.push(...alive.slice(0, over).map(([key]) => key));
    }
    if (!drop.length) return 0;
    for (const key of drop) delete index[key];
    await storage.remove(drop.map(k));
    await storage.set({ [INDEX]: index });
    log?.debug("cache", `trimmed ${drop.length} entries`);
    return drop.length;
  }

  return {
    // Returns the stored entry, or null. Counts as "played" (updates lastPlayed).
    get: (key) =>
      locked(async () => {
        const index = await readIndex();
        const meta = index[key];
        if (!meta) return null;
        const entry = (await storage.get(k(key)))[k(key)];
        const t = now();
        if (!entry || entry.v !== VERSION || expired(entry, meta, t)) {
          delete index[key];
          await storage.remove(k(key));
          await storage.set({ [INDEX]: index });
          return null;
        }
        if (t - meta.lastPlayed > limits.touchEveryMs) {
          meta.lastPlayed = t;
          await storage.set({ [INDEX]: index });
        }
        return entry;
      }),

    // Read without counting as a play.
    peek: async (key) => {
      const entry = (await storage.get(k(key)))[k(key)];
      return entry?.v === VERSION ? entry : null;
    },

    put: (key, entry, { pinned = false } = {}) =>
      locked(async () => {
        const index = await readIndex();
        const t = now();
        const stored = { ...entry, v: VERSION, savedAt: t };
        index[key] = {
          lastPlayed: t,
          savedAt: t,
          pinned: !!pinned,
          notFound: entry?.result?.status === "notFound",
        };
        await storage.set({ [k(key)]: stored, [INDEX]: index });
        await trim(index);
        return stored;
      }),

    // Change an entry (e.g. add its color) without touching lastPlayed/pinned.
    update: (key, patch) =>
      locked(async () => {
        const entry = (await storage.get(k(key)))[k(key)];
        if (!entry) return null;
        const next = { ...entry, ...patch };
        await storage.set({ [k(key)]: next });
        return next;
      }),

    remove: (key) =>
      locked(async () => {
        const index = await readIndex();
        delete index[key];
        await storage.remove(k(key));
        await storage.set({ [INDEX]: index });
      }),

    clear: () =>
      locked(async () => {
        const index = await readIndex();
        await storage.remove([...Object.keys(index).map(k), INDEX]);
      }),

    stats: async () => {
      const index = await readIndex();
      const metas = Object.values(index);
      return {
        count: metas.length,
        pinned: metas.filter((m) => m.pinned).length,
        notFound: metas.filter((m) => m.notFound).length,
      };
    },

    trimNow: () => locked(async () => trim(await readIndex())),
  };
}
