// content/settings.js against a fake chrome.storage, including quick successive changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function setup(initial = {}) {
  const store = { settings: initial };
  const listeners = [];
  const slow = () => new Promise((r) => setTimeout(r, 5)); // storage is async: give races a chance
  const chrome = {
    storage: {
      local: {
        async get(key) {
          await slow();
          return { [key]: structuredClone(store[key]) };
        },
        async set(obj) {
          await slow();
          const old = store.settings;
          Object.assign(store, structuredClone(obj));
          for (const fn of listeners) fn({ settings: { oldValue: old, newValue: store.settings } }, "local");
        },
      },
      onChanged: { addListener: (fn) => listeners.push(fn) },
    },
  };
  const ctx = { chrome, navigator: { language: "fr-FR" }, structuredClone };
  ctx.globalThis = ctx;
  vm.runInNewContext(readFileSync(new URL("../content/settings.js", import.meta.url), "utf8"), ctx);
  return { settings: ctx.SGL.settings, store };
}

test("defaults fill in anything not saved; translate target follows the browser", async () => {
  const { settings } = setup({ karaoke: false });
  await settings.ready;
  const s = settings.get();
  assert.equal(s.karaoke, false);
  assert.equal(s.ambient, true);
  assert.equal(s.textSize, "m");
  assert.equal(s.translateTo, "fr");
});

test("two quick changes are both saved (no lost update)", async () => {
  const { settings, store } = setup({ textSize: "l" });
  await settings.ready;
  settings.set("karaoke", true);
  await settings.set("breakDots", true);
  assert.equal(store.settings.karaoke, true);
  assert.equal(store.settings.breakDots, true);
  assert.equal(store.settings.textSize, "l"); // untouched keys survive
  assert.equal(settings.get().karaoke, true);
});

test("many rapid changes end in the last value", async () => {
  const { settings, store } = setup();
  await settings.ready;
  let last;
  for (let i = 10; i <= 100; i += 10) last = settings.set("glow", i);
  await last;
  assert.equal(store.settings.glow, 100);
});

test("listeners hear about changes", async () => {
  const { settings } = setup();
  await settings.ready;
  const seen = [];
  settings.onChange((s) => seen.push(s.align));
  await settings.set("align", "center");
  assert.ok(seen.includes("center"));
});

test("Genius & NetEase are off by default and only optional permissions", async () => {
  const { settings } = setup();
  await settings.ready;
  assert.equal(settings.get().extraSources, false);
  assert.equal(settings.get().source, undefined); // the old "preferred source" setting is gone
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  const item = settings.SCHEMA.flatMap((g) => g.items).find((i) => i.key === "extraSources");
  assert.deepEqual([...item.origins], manifest.optional_host_permissions);
  assert.deepEqual(manifest.host_permissions, ["https://lrclib.net/*", "https://i.scdn.co/*"]);
});

test("MusicMax starts switched on; the off switch is saved like any setting", async () => {
  const { settings, store } = setup();
  await settings.ready;
  assert.equal(settings.get().enabled, true);
  await settings.set("enabled", false);
  assert.equal(store.settings.enabled, false);
  assert.equal(settings.get().alwaysOurs, false); // "Always use MusicMax lyrics" is opt-in
});

test("secret effects: a folded section at the bottom, everything off by default", async () => {
  const { settings } = setup();
  await settings.ready;
  const s = settings.get();
  assert.equal(s.secretStars, false);
  assert.equal(s.secretCursor, false);
  const last = settings.SCHEMA.at(-1);
  assert.equal(last.collapsed, true);
  assert.equal(last.items.map((i) => i.key).join(), "secretStars,secretCursor");
});
