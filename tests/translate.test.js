// Translation: what MusicMax decides to do, how failures are named, and the download
// watchdog, against a fake Chrome Translator.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadLang(Translator) {
  const ctx = {
    Translator,
    AbortController,
    DOMException,
    Promise,
    setTimeout: (...a) => setTimeout(...a),
    clearTimeout: (id) => clearTimeout(id),
  };
  ctx.globalThis = ctx;
  vm.runInNewContext(readFileSync(new URL("../content/lang.js", import.meta.url), "utf8"), ctx);
  return ctx.SGL.lang;
}

const { translationStep, translationFailure, detect } = loadLang();
const step = (o) => translationStep({ from: "ja", to: "en", status: "available", activated: false, ...o });
const fakeTranslator = { translate: async (text) => `[${text}]` };

test("translationStep: every situation has an answer", () => {
  assert.equal(step({ from: null }), "unknown-language");
  assert.equal(step({ from: "en" }), "same-language");
  assert.equal(step({}), "translate");
  assert.equal(step({ status: "downloadable" }), "needs-download");
  assert.equal(step({ status: "downloading" }), "needs-download");
  assert.equal(step({ status: "downloadable", activated: true }), "translate");
  assert.equal(step({ status: "unsupported" }), "no-translator");
  assert.equal(step({ status: "unavailable" }), "pair-unavailable");
});

test("translationFailure: names the reason, anything unknown is a plain failure", () => {
  assert.equal(translationFailure(new DOMException("x", "TimeoutError")), "stalled");
  assert.equal(translationFailure(new DOMException("x", "NetworkError")), "network");
  assert.equal(translationFailure(new DOMException("x", "NotAllowedError")), "blocked");
  assert.equal(translationFailure(new Error("boom")), "failed");
  assert.equal(translationFailure(undefined), "failed");
});

test("translateLines: translates, keeps blank lines blank, reuses the translator", async () => {
  let created = 0;
  const lang = loadLang({
    create: async () => {
      created++;
      return fakeTranslator;
    },
  });
  assert.deepEqual([...(await lang.translateLines(["a", "", "b"], "ja", "en"))], ["[a]", "", "[b]"]);
  await lang.translateLines(["c"], "ja", "en");
  assert.equal(created, 1);
});

test("translateLines: a failure isn't remembered, the next try starts over", async () => {
  let tries = 0;
  const lang = loadLang({
    create: async () => {
      if (++tries === 1) throw new DOMException("no network", "NetworkError");
      return fakeTranslator;
    },
  });
  await assert.rejects(lang.translateLines(["a"], "ja", "en"), { name: "NetworkError" });
  assert.deepEqual([...(await lang.translateLines(["a"], "ja", "en"))], ["[a]"]);
});

test("watchdog: a download with no progress is given up on, and can be retried", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let tries = 0;
  const lang = loadLang({
    create: ({ signal }) => {
      assert.ok(signal, "the download can be cancelled");
      return ++tries === 1 ? new Promise(() => {}) : Promise.resolve(fakeTranslator);
    },
  });
  const hung = lang.translateLines(["a"], "ja", "en");
  const failed = assert.rejects(hung, { name: "TimeoutError" });
  await Promise.resolve();
  t.mock.timers.tick(30000);
  await failed;
  assert.deepEqual([...(await lang.translateLines(["a"], "ja", "en"))], ["[a]"]);
});

test("watchdog: progress keeps the download alive, and every waiting song hears it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let report;
  let finish;
  const lang = loadLang({
    create: ({ monitor }) => {
      monitor({ addEventListener: (_, fn) => (report = fn) });
      return new Promise((resolve) => (finish = resolve));
    },
  });
  const first = [];
  const second = [];
  const a = lang.translateLines(["a"], "ja", "en", { onProgress: (p) => first.push(p) });
  const b = lang.translateLines(["b"], "ja", "en", { onProgress: (p) => second.push(p) });
  await Promise.resolve();
  t.mock.timers.tick(25000);
  report({ loaded: 0.5 });
  t.mock.timers.tick(25000); // 50 s in total, but never 30 s without progress
  report({ loaded: 1 });
  finish(fakeTranslator);
  assert.deepEqual([...(await a)], ["[a]"]);
  assert.deepEqual([...(await b)], ["[b]"]);
  assert.deepEqual(first, [0.5, 1]);
  assert.deepEqual(second, [0.5, 1]);
});

test("detect: the newly supported languages", () => {
  assert.equal(detect(["Aku cinta kamu dan hati ini", "Tidak ada yang lain di hati", "Kita dengan cinta untuk itu"]), "id");
  assert.equal(detect(["Anh yêu em và em yêu anh", "Không có một người cho tôi", "Những người là của anh"]), "vi");
  assert.equal(detect(["আমি তোমাকে ভালোবাসি", "তুমি আমার জীবন"]), "bn");
  assert.equal(detect(["நான் உன்னை காதலிக்கிறேன்", "நீ என் உயிர்"]), "ta");
  assert.equal(detect(["నేను నిన్ను ప్రేమిస్తున్నాను", "నువ్వు నా ప్రాణం"]), "te");
});
