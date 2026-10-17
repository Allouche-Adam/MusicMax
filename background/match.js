// Deciding whether a search result is the song that's playing.

export const MIN_SCORE = 3; // artist match (2) + at least a partial title match (1)

// "Song - Remastered 2011" / "Song (feat. X)" / "Song - Live at Wembley" -> "Song"
export function cleanTitle(t) {
  return String(t || "")
    .replace(/\s*[(\[](feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/gi, "")
    .replace(/\s*[(\[][^)\]]*\b(remaster(ed)?|version|edit|live|mono|stereo|demo|acoustic)\b[^)\]]*[)\]]/gi, "")
    .replace(/\s+[-–—]\s+.*\b(remaster(ed)?|live|edit|version|mix|mono|stereo|acoustic|demo|from|recorded|session|bonus|instrumental)\b.*$/i, "")
    .trim();
}

// Lowercase, no accents, no punctuation/spaces; "&" == "and". Keeps non-Latin letters.
export function norm(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .normalize("NFC") // recompose (NFKD splits Korean syllables into jamo)
    .replace(/&/g, "and")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

// Cache key for a track. Spotify's track ID isn't reliably on the page, so artists + title.
export function trackKey(track) {
  return `${(track.artists || []).map(norm).join(",")}|${norm(track.title)}`;
}

const JUNK = /\b(karaoke|instrumental|tribute|8d audio|sped up|slowed|nightcore)\b/i;
const LIVE = /\blive\b/i;

// hit: {title, artist, duration?}  want: {title, artists[], duration?}
export function scoreMatch(hit, want) {
  const wantTitle = norm(cleanTitle(want.title));
  const hitTitle = norm(cleanTitle(hit.title));
  const wantArtists = (want.artists || []).map(norm).filter(Boolean);
  const hitArtist = norm(hit.artist);
  let score = 0;

  if (hitArtist && wantArtists.some((a) => hitArtist.includes(a) || a.includes(hitArtist))) score += 2;

  if (hitTitle && hitTitle === wantTitle) score += 2;
  else if (hitTitle && wantTitle && (hitTitle.includes(wantTitle) || wantTitle.includes(hitTitle))) score += 1;

  if (hit.duration && want.duration) {
    const diff = Math.abs(hit.duration - want.duration);
    if (diff <= 3) score += 1;
    else if (diff > 30) score -= 1;
  }

  // Genius' own translation pages ("Genius Traducciones al Español", ...).
  if (/^genius/.test(norm(hit.artist))) score -= 3;
  if (JUNK.test(hit.title || "") && !JUNK.test(want.title || "")) score -= 2;
  // cleanTitle() hides "(Live at ...)", so check the raw titles: a live take has other timing.
  if (LIVE.test(hit.title || "") && !LIVE.test(want.title || "")) score -= 1;

  return score;
}

export function rank(candidates, want) {
  return candidates
    .map((c) => ({ ...c, score: scoreMatch(c, want) }))
    .sort((a, b) => b.score - a.score);
}
