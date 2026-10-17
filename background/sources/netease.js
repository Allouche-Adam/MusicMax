// NetEase Cloud Music: huge catalog (strong for Asian music, decent elsewhere), lyrics
// usually timed. Unofficial web API: it may change without notice.

import { parseLrc, isReallySynced, unsync } from "../lrc.js";

// Never send cookies: once NetEase's NMTID cookie comes back, its search stops matching
// the query and returns unrelated popular songs instead.
const NO_COOKIES = { credentials: "omit" };

export function createNetease(http) {
  async function search({ q }) {
    const data = await http.json(
      `https://music.163.com/api/search/get?s=${encodeURIComponent(q)}&type=1&limit=10`,
      NO_COOKIES
    );
    return (data?.result?.songs || []).map((s) => ({
      source: "NetEase",
      ref: s.id,
      title: s.name,
      artist: (s.artists || []).map((a) => a.name).join(", "),
      duration: s.duration ? s.duration / 1000 : null,
      synced: true, // most NetEase lyrics are timed; checked for real in fetchLyrics
    }));
  }

  async function fetchLyrics(c) {
    const data = await http.json(
      `https://music.163.com/api/song/lyric?id=${encodeURIComponent(c.ref)}&lv=1&tv=-1`,
      NO_COOKIES
    );
    if (data?.nolyric || data?.uncollected) return null;
    const lrc = data?.lrc?.lyric || "";
    if (/纯音乐/.test(lrc)) return null; // "pure music": instrumental
    const lines = parseLrc(lrc);
    if (lines.filter((l) => l.text).length < 3) return null;
    const synced = isReallySynced(lines);
    return {
      source: "NetEase",
      synced,
      lines: synced ? lines : unsync(lines),
      url: `https://music.163.com/#/song?id=${c.ref}`,
      title: c.title,
      artist: c.artist,
      duration: c.duration,
    };
  }

  // Romanized lyrics (romaji) that NetEase has for many Japanese songs, as timed lines.
  async function fetchRomaji(c) {
    const data = await http.json(
      `https://music.163.com/api/song/lyric?id=${encodeURIComponent(c.ref)}&lv=1&rv=-1`,
      NO_COOKIES
    );
    const lines = parseLrc(data?.romalrc?.lyric || "").filter((l) => l.text);
    return lines.length >= 3 ? lines : null;
  }

  return {
    name: "NetEase",
    search,
    fetchLyrics,
    fetchRomaji,
    autoQuery: (t) => ({ q: `${t.artists[0]} ${t.cleanTitle}` }),
  };
}
