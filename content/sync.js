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

  // Highlight lines a touch early, like Spotify, so the eye is there when the words start.
  SGL.sync = { parseClock, createClock, activeIndex, LEAD: 0.25 };
})();
