// LRCLIB (lrclib.net): free, open lyrics database, often with synced (timed) lyrics.

import { parseLrc, plainLines, isReallySynced } from "../lrc.js";

const NO_COOKIES = { credentials: "omit" }; // LRCLIB needs none

export function createLrclib(http) {
  // Either a free-text query, or a precise title + artist search.
  async function search({ q, title, artist }) {
    const params = q ? { q } : { track_name: title, artist_name: artist };
    const list = await http.json(`https://lrclib.net/api/search?${new URLSearchParams(params)}`, NO_COOKIES);
    return (Array.isArray(list) ? list : [])
      .filter((r) => r.plainLyrics || r.syncedLyrics)
      .map((r) => ({
        source: "LRCLIB",
        ref: r.id,
        title: r.trackName,
        artist: r.artistName,
        duration: r.duration || null,
        synced: !!r.syncedLyrics,
        record: r, // search results already include the lyrics: no second request needed
      }));
  }

  async function fetchLyrics(c) {
    const r = c.record || (await http.json(`https://lrclib.net/api/get/${encodeURIComponent(c.ref)}`, NO_COOKIES));
    if (r.instrumental) return null;
    const synced = r.syncedLyrics ? parseLrc(r.syncedLyrics) : [];
    const useSynced = synced.length > 0 && isReallySynced(synced);
    const lines = useSynced ? synced : plainLines(r.plainLyrics);
    if (!lines.length) return null;
    return {
      source: "LRCLIB",
      synced: useSynced,
      lines,
      url: `https://lrclib.net/api/get/${r.id}`,
      title: r.trackName,
      artist: r.artistName,
      duration: r.duration || null,
    };
  }

  return {
    name: "LRCLIB",
    search,
    fetchLyrics,
    autoQuery: (t) => ({ title: t.cleanTitle, artist: t.artists[0] }),
  };
}
