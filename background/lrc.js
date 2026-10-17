// Turning lyric text into display lines: [{ t?: seconds, text }].
// Synced (LRC) lines have `t`; an empty `text` in synced lyrics is an instrumental break.

const STAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

// Credit lines NetEase (and some LRC files) put at the top: "作词 : X", "Producer: Y".
const CREDIT =
  /^(作词|作曲|编曲|制作人|制作|混音|母带|录音|和声|监制|出品|发行|吉他|贝斯|鼓|键盘|弦乐|词|曲|lyrics? by|written by|composed by|lyricist|composer|producer|arranger|mixing|mastering)\s*[:：]/i;

// Whole-line section headers: "[Chorus]", "[Verse 1: Artist]".
const SECTION = /^\[[^\]]*\]$/;

export function cleanText(s) {
  return String(s).replace(/\s+/g, " ").trim();
}

export function parseLrc(text) {
  if (!text) return [];
  const offsetTag = /\[offset:\s*([+-]?\d+)\]/i.exec(text);
  const offset = offsetTag ? Number(offsetTag[1]) / 1000 : 0;

  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const stamps = [...raw.matchAll(STAMP)];
    if (!stamps.length) continue; // metadata like [ar: ...] or plain text
    const line = cleanText(raw.replace(STAMP, ""));
    if (CREDIT.test(line) || SECTION.test(line)) continue;
    for (const s of stamps) {
      const frac = s[3] ? Number(s[3]) / 10 ** s[3].length : 0;
      const t = Number(s[1]) * 60 + Number(s[2]) + frac - offset;
      out.push({ t: Math.max(0, Math.round(t * 1000) / 1000), text: line });
    }
  }
  out.sort((a, b) => a.t - b.t);

  // Collapse runs of empty lines, drop leading/trailing ones.
  const tidy = [];
  for (const l of out) {
    if (!l.text && (!tidy.length || !tidy[tidy.length - 1].text)) continue;
    tidy.push(l);
  }
  while (tidy.length && !tidy[tidy.length - 1].text) tidy.pop();
  return tidy;
}

// True when the timestamps are real (not every line stamped 00:00, say).
export function isReallySynced(lines) {
  const times = new Set(lines.filter((l) => l.text).map((l) => l.t));
  return times.size >= Math.min(3, lines.length) && times.size > 1;
}

export function plainLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map(cleanText)
    .filter((l) => l && !SECTION.test(l) && !CREDIT.test(l))
    .map((text) => ({ text }));
}

// Synced lines without timing (when the timing belongs to a different recording).
export function unsync(lines) {
  return lines.filter((l) => l.text).map((l) => ({ text: l.text }));
}
