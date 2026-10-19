// Following the song: Spotify only shows the position as "1:02" (whole seconds), so we
// note when that text changes and count forward from there. No DOM access here, so
// these functions are unit-tested in Node.

(() => {
  const SGL = (globalThis.SGL = globalThis.SGL || {});

  // "1:02" -> 62, "1:02:03" -> 3723, "-0:45" -> -45, junk -> null
  function parseClock(text) {
    if (typeof text !== "string") return null;
    const t = text.trim();
    if (!/^-?\d{1,3}(:\d{1,2}){1,2}$/.test(t)) return null;
    const neg = t.startsWith("-");
    const secs = t
      .replace("-", "")
      .split(":")
      .reduce((acc, part) => acc * 60 + Number(part), 0);
    return neg ? -secs : secs;
  }

  function createClock(now = () => performance.now()) {
    let lastText = null;
    let base = 0;
    let at = now();
    return {
      // Call often with Spotify's position text. Returns true when the song jumped
      // (a seek, or the next song), i.e. the new time isn't where we expected.
      update(text) {
        if (text === lastText) return false;
        const expected = base + Math.min(now() - at, 1000) / 1000;
        lastText = text;
        const v = parseClock(text);
        if (v == null || v < 0) return false;
        base = v;
        at = now();
        return Math.abs(v - expected) > 1.5;
      },
      // No new position text for a while: the song is paused (or buffering).
      isStalled() {
        return now() - at > 1500;
      },
      // Seconds into the song. Never runs more than 1s past the last text change, so a
      // paused song doesn't drift.
      position() {
        return base + Math.min(now() - at, 1000) / 1000;
      },
      // We just seeked: trust our own number until Spotify's text catches up.
      jump(sec) {
        base = sec;
        at = now();
        lastText = null;
      },
    };
  }

  // Index of the line being sung at time t (last line with line.t <= t), or -1.
  function activeIndex(lines, t) {
    let lo = 0;
    let hi = lines.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid].t <= t) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }

  // ---------- karaoke fill length ----------
  // Synced lyrics only say when each line starts. Filling a line over the whole time until
  // the next one crawls when the singer finishes early and a beat follows (the rapper's
  // done with the bar, the fill's on its first words). So we guess how long the words
  // take to sing, from their syllables, and finish by then (never after the next line).

  const SING_RATE = 5; // syllables per second when a song has too few lines to measure
  const VOWELS = /[aeiouyàáâãäåæèéêëìíîïòóôõöøœùúûüýÿаеёиоуыэюяіїєαεηιουωάέήίόύώ]+/giu;
  const ONE_EACH = /[぀-ヿ㐀-鿿가-힯]/gu; // kana, kanji, hangul: a syllable each

  function syllables(text) {
    let n = (text.match(ONE_EACH) || []).length;
    for (const word of text.replace(ONE_EACH, " ").split(/\s+/)) {
      if (!/\p{L}/u.test(word)) continue;
      const groups = (word.match(VOWELS) || []).length;
      // No vowels we know (Arabic, Hebrew…): about one syllable per 2.5 letters.
      n += groups || Math.max(1, Math.round(word.replace(/[^\p{L}]/gu, "").length / 2.5));
    }
    return n;
  }

  // How fast this song is sung, in syllables per second, from its own timestamps: each
  // line's syllables over the time until the next line. A line followed by a pause looks
  // slow (the pause counts too), so we take a value from the fast end (75th percentile):
  // a ballad lands around 2, rap around 5-6.
  function songRate(lines) {
    const rates = [];
    for (let i = 0; i + 1 < (lines?.length || 0); i++) {
      const gap = lines[i + 1].t - lines[i].t;
      const n = lines[i].text ? syllables(lines[i].text) : 0;
      if (n >= 3 && gap > 0.5 && gap < 15) rates.push(n / gap);
    }
    if (rates.length < 6) return SING_RATE;
    rates.sort((a, b) => a - b);
    return Math.min(7, Math.max(1.5, rates[Math.floor(rates.length * 0.75)]));
  }

  // Seconds the fill takes for a line with `gap` seconds until the next one, at the
  // song's pace (songRate). Instrumental breaks (no words) keep the whole gap: their dots
  // count it down.
  function fillDuration(text, gap, rate = SING_RATE) {
    const n = text ? syllables(text) : 0;
    if (!n) return gap;
    return Math.min(gap, Math.max(0.8, n / rate + 0.2));
  }

  // Highlight lines a touch early, like Spotify, so the eye is there when the words start.
  SGL.sync = { parseClock, createClock, activeIndex, syllables, songRate, fillDuration, LEAD: 0.25 };
})();
