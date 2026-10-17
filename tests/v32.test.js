// v3.2 logic: language detection, romanization, pause/seek detection, preferred source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { choose } from "../background/lookup.js";

// Browser scripts (they attach to globalThis.SGL): run them in a sandbox.
function load(file) {
  const ctx = {};
  ctx.globalThis = ctx;
  vm.runInNewContext(readFileSync(new URL(`../content/${file}`, import.meta.url), "utf8"), ctx);
  return ctx.SGL;
}
const { lang } = load("lang.js");
const { sync } = load("sync.js");

test("detect: writing systems", () => {
  assert.equal(lang.detect(["沈むように溶けてゆくように", "二人だけの空が広がる夜に"]), "ja");
  assert.equal(lang.detect(["사랑해 사랑해", "너를 보고 싶어", "오늘 밤에"]), "ko");
  assert.equal(lang.detect(["我爱你中国我的母亲", "你是我的眼睛和世界"]), "zh");
  assert.equal(lang.detect(["Я люблю тебя всегда", "Ты моя звезда сегодня"]), "ru");
});

test("detect: Latin-script languages from common words", () => {
  assert.equal(lang.detect(["Yo no sé lo que me pasa", "Pero te quiero a ti", "Y no me importa nada"]), "es");
  assert.equal(lang.detect(["Je ne sais pas pourquoi", "Tu es dans mon cœur", "Et je pense à toi"]), "fr");
  assert.equal(lang.detect(["I think we could have been something", "Maybe it's just the timing", "I don't know what to do"]), "en");
});

test("detect: too little to tell → null", () => {
  assert.equal(lang.detect([]), null);
  assert.equal(lang.detect(["Ooh", "Yeah", "Brr"]), null);
  assert.equal(lang.detect([""]), null);
});

test("detect: a few kana among Han still means Japanese", () => {
  assert.equal(lang.detect(["夜に駆ける", "夜空に光る星"]), "ja");
});

test("romanize: Korean, Cyrillic, Greek; Latin untouched", () => {
  assert.equal(lang.romanize("사랑해"), "saranghae");
  assert.equal(lang.romanize("안녕 하세요"), "annyeong haseyo");
  assert.equal(lang.romanize("Привет"), "Privet");
  assert.equal(lang.romanize("Ελλάδα"), "Ellada");
  assert.equal(lang.romanize("Hello"), null);
  assert.equal(lang.romanize(""), null);
});

test("clock: reports jumps (seeks) but not normal ticking", () => {
  let t = 0;
  const clock = sync.createClock(() => t);
  clock.update("0:10");
  t = 1000;
  assert.equal(clock.update("0:11"), false); // normal second
  t = 1500;
  assert.equal(clock.update("1:30"), true); // user seeked
  t = 2500;
  assert.equal(clock.update("1:31"), false);
});

test("clock: stalls when the text stops changing (paused)", () => {
  let t = 0;
  const clock = sync.createClock(() => t);
  clock.update("0:10");
  t = 900;
  assert.equal(clock.isStalled(), false);
  t = 2000;
  assert.equal(clock.isStalled(), true);
  clock.update("0:11");
  assert.equal(clock.isStalled(), false);
});

const lines = (synced) => (synced ? [{ t: 1, text: "a" }, { t: 2, text: "b" }] : [{ text: "a" }, { text: "b" }]);
const lrclib = { source: "LRCLIB", synced: true, lines: lines(true), duration: 190 };
const genius = { source: "Genius", synced: false, lines: lines(false) };
const netease = { source: "NetEase", synced: true, lines: lines(true), duration: 240 };

test("choose: a preferred source wins when it has the song", () => {
  assert.equal(choose([lrclib, genius], 190, "Genius").source, "Genius");
  assert.equal(choose([lrclib, genius], 190, "LRCLIB").source, "LRCLIB");
  // preferred but missing → normal order
  assert.equal(choose([lrclib, genius], 190, "NetEase").source, "LRCLIB");
});

test("choose: a preferred source's timing is still dropped for another recording", () => {
  const r = choose([netease, genius], 190, "NetEase");
  assert.equal(r.source, "NetEase");
  assert.equal(r.synced, false);
});
