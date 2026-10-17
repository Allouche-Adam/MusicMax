// The store zip holds only what the extension loads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { listFiles } from "../scripts/package.mjs";

test("package: extension files only, nothing from development", () => {
  const files = listFiles();
  for (const f of ["manifest.json", "background/index.js", "content/main.js", "popup/popup.html", "icons/icon128.png", "content.css"]) {
    assert.ok(files.includes(f), `${f} should be packaged`);
  }
  const top = new Set(files.map((f) => f.split("/")[0]));
  for (const f of ["tests", "store", "scripts", "node_modules", "dist", ".git", "package.json", "README.md"]) {
    assert.ok(!top.has(f), `${f} should not be packaged`);
  }
});

test("package: no developer reload hook ships", async () => {
  const { readFileSync } = await import("node:fs");
  for (const f of listFiles().filter((f) => f.endsWith(".js"))) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.ok(!/SGL_DEV_RELOAD|devReload|runtime\.reload/.test(src), `${f} still has the dev reload hook`);
  }
});
