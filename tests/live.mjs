// Live check against the real Genius / LRCLIB / NetEase (needs internet; not part of `npm test`).
// Usage: node tests/live.mjs

import { createHttp } from "../background/http.js";
import { createLookup, describe } from "../background/lookup.js";
import { createGenius } from "../background/sources/genius.js";
import { createLrclib } from "../background/sources/lrclib.js";
import { createNetease } from "../background/sources/netease.js";

const http = createHttp();
const lookup = createLookup({
  sources: [createGenius(http), createLrclib(http), createNetease(http)],
  log: { warn() {}, info() {}, debug() {}, error() {} },
});

const songs = [
  { title: "Rino Hercules", artists: ["Summrs", "PlaqueBoyMax"], duration: 190, expect: "found" },
  { title: "Mr. Brightside", artists: ["The Killers"], duration: 222, expect: "found" },
  { title: "Bohemian Rhapsody - Remastered 2011", artists: ["Queen"], duration: 354, expect: "found" },
  { title: "Dynamite", artists: ["BTS"], duration: 199, expect: "found" },
  { title: "夜に駆ける", artists: ["YOASOBI"], duration: 261, expect: "found" },
  { title: "zzqx nonexistent song", artists: ["Nobody Real"], duration: 100, expect: "notFound" },
];

let failed = 0;
for (const s of songs) {
  const t0 = Date.now();
  const { result, trace } = await lookup.find(s);
  const ok = result.status === s.expect;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${s.artists[0]} - ${s.title}: ${describe(result)} [${Date.now() - t0}ms]`);
  for (const line of trace) console.log(`     ${line}`);
}
process.exit(failed ? 1 : 0);
