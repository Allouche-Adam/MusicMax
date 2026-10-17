// Asks every source it's given at once, then picks the best lyrics:
//   1. synced lyrics whose recording length matches the song (LRCLIB, then NetEase)
//   2. Genius (plain)
//   3. anything else, with timing stripped if it belongs to a different recording.
// The extension gives automatic lookups LRCLIB only; Genius and NetEase are used for the
// manual search when the user turns them on (see background/index.js).
// Every step is written to `trace` so the log shows why a result was (or wasn't) picked.

import { cleanTitle, rank, norm, MIN_SCORE } from "./match.js";
import { unsync } from "./lrc.js";

const SYNC_ORDER = ["LRCLIB", "NetEase"];
const TIMING_TOLERANCE = 3; // seconds between Spotify's length and the lyrics' recording

export function timingMatches(result, duration) {
  return !duration || !result.duration || Math.abs(result.duration - duration) <= TIMING_TOLERANCE;
}

export function choose(results, duration) {
  for (const name of SYNC_ORDER) {
    const r = results.find((x) => x.source === name && x.synced && timingMatches(x, duration));
    if (r) return r;
  }
  const genius = results.find((x) => x.source === "Genius");
  if (genius) return genius;
  const any = [...results].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
  if (!any) return null;
  return any.synced && !timingMatches(any, duration) ? { ...any, synced: false, lines: unsync(any.lines) } : any;
}

export function createLookup({ sources, log, now = Date.now }) {
  const byName = Object.fromEntries(sources.map((s) => [s.name, s]));
  const ms = (t0) => `${now() - t0}ms`;

  // Automatic lookup for the playing track. Returns { result, trace, errors }.
  // Synced LRCLIB lyrics that fit the song always win, so once they arrive we stop
  // waiting for the slower sources (Genius can take seconds).
  async function find(track) {
    const want = { title: track.title, artists: track.artists, duration: track.duration };
    const query = { ...track, cleanTitle: cleanTitle(track.title) };
    const trace = [];
    const found = [];
    const pending = new Set(sources.map((s) => s.name));
    let errors = 0;
    let winnerArrived;
    const winner = new Promise((r) => (winnerArrived = r));

    const run = async (src) => {
      const res = await ask(src);
      pending.delete(src.name);
      if (res) {
        found.push(res);
        if (res.source === SYNC_ORDER[0] && res.synced && timingMatches(res, track.duration)) winnerArrived();
      }
    };

    const ask = async (src) => {
      const t0 = now();
      try {
        const ranked = rank(await src.search(src.autoQuery(query)), want);
        const best = ranked[0];
        if (!best || best.score < MIN_SCORE) {
          trace.push(
            `${src.name}: ${ranked.length} results, no match` +
              (best ? ` (best "${best.artist} - ${best.title}", score ${best.score})` : "") +
              ` [${ms(t0)}]`,
          );
          return null;
        }
        const res = await src.fetchLyrics(best);
        trace.push(
          `${src.name}: "${best.artist} - ${best.title}" score ${best.score} → ` +
            (res ? `${res.lines.length} lines${res.synced ? ", synced" : ""}` : "no lyrics") +
            ` [${ms(t0)}]`,
        );
        return res && { ...res, score: best.score, duration: res.duration ?? best.duration };
      } catch (err) {
        errors++;
        trace.push(`${src.name}: ERROR ${err.message} [${ms(t0)}]`);
        log?.warn("lookup", `${src.name} failed for "${track.title}": ${err.message}`);
        return null;
      }
    };

    await Promise.race([Promise.all(sources.map(run)), winner]);

    if (pending.size) trace.push(`(didn't wait for ${[...pending].join(", ")})`);
    const pick = choose(found, track.duration);
    trace.push(pick ? `→ ${pick.source}${pick.synced ? " (synced)" : ""}` : "→ nothing found");
    const result = pick
      ? { status: "found", ...pick }
      : errors === sources.length
        ? { status: "error", error: "every lyrics source failed" }
        : { status: "notFound" };
    // Copy: sources we didn't wait for may still append to `trace` later.
    return { result, trace: trace.slice(), errors };
  }

  // Manual search ("Wrong lyrics?"): every source's results, best matches first. Results
  // sharing no word with the query are dropped (a throttled source can answer with
  // unrelated "popular" songs).
  async function search(q, want) {
    const trace = [];
    const lists = await Promise.all(
      sources.map(async (src) => {
        try {
          const list = await src.search({ q });
          const top = list.slice(0, 3).map((c) => `"${c.artist} - ${c.title}"`);
          trace.push(`${src.name}: ${list.length} results${top.length ? ` (${top.join(", ")})` : ""}`);
          return list;
        } catch (err) {
          trace.push(`${src.name}: ERROR ${err.message}`);
          return [];
        }
      }),
    );
    const all = dedupe(lists.flat());
    const relevant = all.filter((c) => queryOverlap(q, c) > 0);
    if (relevant.length < all.length) trace.push(`dropped ${all.length - relevant.length} results unrelated to the query`);
    const candidates = rank(relevant, want)
      .map((c) => ({ ...c, rel: queryOverlap(q, c) }))
      .sort((a, b) => b.score + 3 * b.rel - (a.score + 3 * a.rel))
      .slice(0, 25)
      .map(({ record, rel, ...c }) => c); // LRCLIB records carry whole lyrics: don't ship them around
    return { candidates, trace };
  }

  // Romaji for a Japanese song, from NetEase (matched like an automatic lookup).
  async function romaji(track) {
    const src = byName.NetEase;
    if (!src?.fetchRomaji) return null;
    const want = { title: track.title, artists: track.artists, duration: track.duration };
    const best = rank(await src.search(src.autoQuery({ ...track, cleanTitle: cleanTitle(track.title) })), want)[0];
    if (!best || best.score < MIN_SCORE) return null;
    return src.fetchRomaji(best);
  }

  async function fetchCandidate(c) {
    const src = byName[c.source];
    if (!src) throw new Error(`unknown source ${c.source}`);
    const res = await src.fetchLyrics(c);
    return res && { ...res, duration: res.duration ?? c.duration ?? null };
  }

  return { find, search, fetchCandidate, romaji };
}

// LRCLIB often has several uploads of the same song: keep one per source/title/artist/length,
// preferring a synced one.
export function dedupe(candidates) {
  const seen = new Map();
  for (const c of candidates) {
    const key = `${c.source}|${norm(c.title)}|${norm(c.artist)}|${Math.round(c.duration || 0)}`;
    const prev = seen.get(key);
    if (!prev || (!prev.synced && c.synced)) seen.set(key, c);
  }
  return [...seen.values()];
}

// Share of the query's words found in the candidate's title + artist (0..1).
export function queryOverlap(q, c) {
  const words = String(q).split(/\s+/).map(norm).filter(Boolean);
  if (!words.length) return 0;
  const hay = norm(`${c.title} ${c.artist}`);
  return words.filter((w) => hay.includes(w)).length / words.length;
}

export function describe(result) {
  if (!result) return "nothing";
  if (result.status === "found") {
    return `${result.source}${result.synced ? " synced" : ""}, ${result.lines.length} lines${result.manual ? " (picked by user)" : ""}`;
  }
  return result.status === "error" ? `error: ${result.error}` : "not found";
}
