// Genius: biggest catalog of plain (unsynced) lyrics. No public lyrics API, so we read
// the song page and pull the text out of its lyrics containers.

import { plainLines } from "../lrc.js";

export function createGenius(http) {
  async function search({ q }) {
    const data = await http.json(
      `https://genius.com/api/search/song?per_page=10&q=${encodeURIComponent(q)}`,
      { headers: { Accept: "application/json" } }
    );
    const hits = data?.response?.sections?.flatMap((s) => s.hits || []) || [];
    return hits
      .map((h) => h.result)
      .filter((r) => r?.url)
      .map((r) => ({
        source: "Genius",
        ref: r.url,
        title: r.title,
        artist: r.artist_names || r.primary_artist?.name || "",
        duration: null,
        synced: false,
      }));
  }

  async function fetchLyrics(c) {
    const text = extractGeniusLyrics(await http.text(c.ref));
    const lines = plainLines(text);
    if (!lines.length) return null; // instrumental, or "lyrics not released yet"
    return { source: "Genius", synced: false, lines, url: c.ref, title: c.title, artist: c.artist };
  }

  return { name: "Genius", search, fetchLyrics, autoQuery: (t) => ({ q: `${t.artists[0]} ${t.cleanTitle}` }) };
}

// Pulls the text out of every <div data-lyrics-container="true"> on a Genius song page.
// String scanning because MV3 service workers have no DOMParser.
export function extractGeniusLyrics(html) {
  const parts = [];
  const open = /<div[^>]*data-lyrics-container="true"[^>]*>/g;
  let m;
  while ((m = open.exec(html))) {
    const el = divInner(html, m.index);
    if (!el) break;
    parts.push(removeExcluded(el.inner));
    open.lastIndex = el.end;
  }
  return htmlToText(parts.join("<br>")).replace(/\n{3,}/g, "\n\n").trim();
}

// Given the index of an opening <div>, returns its inner HTML and the index after its </div>.
function divInner(html, start) {
  const tag = /<\/?div\b[^>]*>/gi;
  tag.lastIndex = start;
  let depth = 0;
  let innerStart = -1;
  let t;
  while ((t = tag.exec(html))) {
    if (t[0][1] === "/") {
      depth--;
      if (depth === 0) return { inner: html.slice(innerStart, t.index), end: tag.lastIndex };
    } else {
      if (depth === 0) innerStart = tag.lastIndex;
      depth++;
    }
  }
  return null;
}

// Drops the "N Contributors / Translations / Song title Lyrics" header blocks.
function removeExcluded(html) {
  const re = /<div[^>]*data-exclude-from-selection="true"[^>]*>/;
  let m;
  while ((m = re.exec(html))) {
    const el = divInner(html, m.index);
    if (!el) break;
    html = html.slice(0, m.index) + html.slice(el.end);
  }
  return html;
}

function htmlToText(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
