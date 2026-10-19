// Cover colors, the debug log, and the content script's song-following math.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { dominantHueSat, themeFrom, hslToRgb } from "../background/color.js";
import { createLogger, toPlain } from "../background/log.js";

const pixels = (rgbs) => Uint8ClampedArray.from(rgbs.flatMap(([r, g, b]) => [r, g, b, 255]));

test("color: red cover → Spotify-like dark red and pink tint", () => {
  const { bg, tint } = themeFrom(dominantHueSat(pixels(Array(100).fill([200, 30, 30]))));
  assert.equal(bg, "rgb(102, 0, 0)"); // Spotify used rgb(101, 0, 0)
  assert.match(tint, /^rgb\(255, 1\d\d, 1\d\d\)$/);
});

test("color: black & white cover → tinted dark grey", () => {
  const data = pixels([...Array(50).fill([0, 0, 0]), ...Array(50).fill([255, 255, 255])]);
  const { s } = dominantHueSat(data);
  assert.equal(s, 0.11);
  assert.equal(hslToRgb(210, 0.11, 0.21), "rgb(48, 54, 59)"); // Spotify: rgb(48, 54, 60)
});

test("color: an empty image doesn't produce NaN", () => {
  const { bg, tint } = themeFrom(dominantHueSat(new Uint8ClampedArray(0)));
  assert.doesNotMatch(bg + tint, /NaN/);
});

test("log: keeps only the newest entries and hides debug unless verbose", () => {
  const quiet = { log() {}, info() {}, warn() {}, error() {} };
  const log = createLogger({ max: 3, consoleImpl: quiet });
  log.debug("t", "hidden");
  for (let i = 0; i < 5; i++) log.info("t", `m${i}`);
  assert.deepEqual(log.entries().map((e) => e.msg), ["m2", "m3", "m4"]);
  log.setVerbose(true);
  log.debug("t", "shown");
  assert.equal(log.entries().at(-1).msg, "shown");
});

test("log: data is made storable (errors, long strings, deep objects)", () => {
  const plain = toPlain({ err: new Error("boom"), s: "x".repeat(2000), deep: { a: { b: { c: { d: { e: 1 } } } } } });
  assert.equal(plain.err.message, "boom");
  assert.ok(plain.s.length < 600);
  assert.equal(plain.deep.a.b.c, "[…]");
  assert.doesNotThrow(() => JSON.stringify(plain));
});

// content/sync.js is a plain browser script: run it in a sandbox and grab SGL.sync.
function loadSync() {
  const ctx = {};
  ctx.globalThis = ctx;
  vm.runInNewContext(readFileSync(new URL("../content/sync.js", import.meta.url), "utf8"), ctx);
  return ctx.SGL.sync;
}

test("sync: parseClock", () => {
  const { parseClock } = loadSync();
  assert.equal(parseClock("1:02"), 62);
  assert.equal(parseClock("0:00"), 0);
  assert.equal(parseClock("1:02:03"), 3723);
  assert.equal(parseClock("-0:45"), -45);
  for (const junk of ["", "abc", "1:", ":30", null, undefined, "1:2:3:4", 42]) assert.equal(parseClock(junk), null, String(junk));
});

test("sync: clock counts forward from the last change, at most 1s", () => {
  const { createClock } = loadSync();
  let t = 0;
  const clock = createClock(() => t);
  clock.update("0:10");
  t = 400;
  assert.equal(clock.position(), 10.4);
  t = 5000; // paused: text stopped changing
  assert.equal(clock.position(), 11);
  clock.update("0:11");
  t = 5250;
  assert.equal(clock.position(), 11.25);
  clock.jump(42.5); // we seeked
  assert.equal(clock.position(), 42.5);
  clock.update("garbage"); // ignored
  assert.equal(clock.position(), 42.5);
});

test("sync: activeIndex finds the line being sung", () => {
  const { activeIndex } = loadSync();
  const lines = [{ t: 1 }, { t: 5 }, { t: 9 }];
  assert.equal(activeIndex(lines, 0), -1);
  assert.equal(activeIndex(lines, 1), 0);
  assert.equal(activeIndex(lines, 6), 1);
  assert.equal(activeIndex(lines, 100), 2);
  assert.equal(activeIndex([], 3), -1);
});

test("sync: karaoke fill finishes when the words are likely sung, not at the next line", () => {
  const { syllables, fillDuration } = loadSync();
  assert.equal(syllables("I don't wanna go"), 5);
  assert.equal(syllables("こんにちは"), 5);
  assert.equal(syllables("♪"), 0);
  // A short bar followed by 6 s of beat: done in about 1.4 s, not crawling for 6.
  const d = fillDuration("I don't wanna go", 6);
  assert.ok(d > 1 && d < 2, `got ${d}`);
  // A long line in a short gap: never past the next line.
  assert.equal(fillDuration("one two three four five six seven eight nine ten eleven twelve", 2), 2);
  // Instrumental break: the dots keep the whole gap.
  assert.equal(fillDuration("", 8), 8);
  assert.equal(fillDuration("♪", 8), 8);
});
