// Scripted live test of MusicMax on the Spotify web player (not part of `npm test`).
// Starts Brave with its own test profile and the unpacked extension, drives it over the
// Chrome DevTools Protocol (Node's built-in WebSocket: no dependencies) and prints a text
// timeline of MusicMax's state, instead of clicking on screenshots.
//
//   npm run e2e:login                  once: sign in to Spotify in the test profile (by hand)
//   npm run e2e:play -- <track url, spotify:track:… or id> [--seconds 30] [--clear-cache] [--sound]
//
// Why Brave: Spotify needs Widevine (DRM) to play, which Chrome for Testing / Playwright's
// Chromium don't ship, and Google Chrome 137+ ignores --load-extension. Brave has both.
// Another browser: set MUSICMAX_BROWSER to its .exe.

import { spawn } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { listFiles } from "../../scripts/package.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const EXT_DIR = join(root, "dist", "e2e-unpacked");
const PROFILE = join(root, ".e2e-profile"); // holds the Spotify login: gitignored
const BROWSER = process.env.MUSICMAX_BROWSER || "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe";
// The track page's big green play button. Only this test presses it, so it lives here
// rather than in content/spotify.js (which holds what the extension itself uses).
const TRACK_PLAY_BUTTON = '[data-testid="action-bar-row"] [data-testid="play-button"]';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class Fail extends Error {}
const fail = (msg) => {
  throw new Fail(msg);
};

// ---------- browser ----------

function launch(args) {
  if (!existsSync(BROWSER)) fail(`no browser at ${BROWSER}: set MUSICMAX_BROWSER to a Chromium browser with Widevine`);
  rmSync(join(PROFILE, "DevToolsActivePort"), { force: true });
  return spawn(BROWSER, [`--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check", ...args], { stdio: "ignore" });
}

// With --remote-debugging-port=0 the browser picks a free port and writes it to this file.
async function devtoolsUrl() {
  const file = join(PROFILE, "DevToolsActivePort");
  for (let i = 0; i < 150; i++) {
    const [port, path] = existsSync(file) ? readFileSync(file, "utf8").trim().split("\n") : [];
    if (path) return `ws://127.0.0.1:${port}${path}`;
    await sleep(100);
  }
  fail("the browser didn't open its DevTools port: close any window still using the test profile and retry");
}

// Minimal CDP client: one socket, page commands go through flat sessions (sessionId).
function connect(url) {
  const ws = new WebSocket(url);
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    const p = msg.id && pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result);
    } else if (msg.method) listeners.forEach((fn) => fn(msg));
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject, method });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve({ send, on: (fn) => listeners.push(fn) });
    ws.onerror = () => reject(new Error("couldn't connect to the browser's DevTools port"));
  });
}

async function openTab(cdp, url) {
  const { targetId } = await cdp.send("Target.createTarget", { url });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  return { targetId, sessionId, send: (method, params) => cdp.send(method, params, sessionId) };
}

async function evaluate(tab, expression, contextId) {
  const r = await tab.send("Runtime.evaluate", { expression, contextId, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

async function waitFor(what, fn, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) {
    const v = await fn().catch(() => null);
    if (v) return v;
  }
  fail(what);
}

// ---------- MusicMax ----------

// The same files as the store zip, so the test runs exactly what ships.
function buildUnpacked() {
  rmSync(EXT_DIR, { recursive: true, force: true });
  for (const f of listFiles()) cpSync(join(root, f), join(EXT_DIR, f));
}

async function extensionId(cdp) {
  const worker = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")).background.service_worker;
  const sw = await waitFor(
    "MusicMax's background didn't start: open brave://extensions in the test profile to see why",
    async () => (await cdp.send("Target.getTargets")).targetInfos.find((t) => t.type === "service_worker" && t.url.endsWith(`/${worker}`)),
    10000,
  );
  return new URL(sw.url).host;
}

// Sent from an extension page before Spotify opens, so no lookup can use old saved lyrics.
async function clearCache(cdp, extId) {
  const tab = await openTab(cdp, `chrome-extension://${extId}/popup/popup.html`);
  await waitFor("the popup page didn't load", () => evaluate(tab, "location.protocol === 'chrome-extension:' && !!chrome.runtime"), 5000);
  const res = await evaluate(tab, `chrome.runtime.sendMessage({ type: "clearCache" })`);
  if (!res?.ok) fail(`clearCache failed: ${JSON.stringify(res)}`);
  await cdp.send("Target.closeTarget", { targetId: tab.targetId });
}

// Read inside MusicMax's own content-script world, so it can use SGL.spotify's selectors.
const PROBE = `(() => {
  const S = SGL.spotify, html = document.documentElement.classList, mic = document.querySelector(S.SEL.mic), t = S.readTrack();
  return {
    song: t ? t.artists.join(", ") + " - " + t.title : "-",
    playing: S.isPlaying(),
    pos: S.positionText(),
    hasLyrics: html.contains("sgl-has-lyrics"),
    override: html.contains("sgl-override"),
    mic: !mic ? "missing" : mic.disabled ? "disabled" : "enabled",
    card: !!document.querySelector(".sgl-card"),
    view: !!document.querySelector(".sgl-view"),
  };
})()`;

const yn = (b) => (b ? "yes" : "no");
const describeState = (s) =>
  `${s.playing ? "playing" : "paused "} ${String(s.pos ?? "-").padStart(5)}  "${s.song}"  has-lyrics=${yn(s.hasLyrics)} override=${yn(s.override)} mic=${s.mic} card=${yn(s.card)} view=${yn(s.view)}`;

function trackUrl(song) {
  const id = song?.match(/(?:track[/:])?([A-Za-z0-9]{22})(?:\?|$)/)?.[1];
  if (!id) fail("give a Spotify track: npm run e2e:play -- https://open.spotify.com/track/<id>");
  return `https://open.spotify.com/track/${id}`;
}

// ---------- commands ----------

async function login() {
  const browser = launch(["https://open.spotify.com/"]);
  console.log("Brave opened with the MusicMax test profile.");
  console.log("1. Sign in to Spotify there (you type the password, not the script).");
  console.log("2. Play any song once. If Brave asks to enable Widevine, accept and let it restart.");
  console.log("3. Close the window. The login stays in .e2e-profile/ for the next runs.");
  await new Promise((r) => browser.on("exit", r));
}

async function play(song, opts) {
  const url = trackUrl(song);
  buildUnpacked();
  const browser = launch([
    "--remote-debugging-port=0",
    `--load-extension=${EXT_DIR}`,
    "--autoplay-policy=no-user-gesture-required", // the play button is pressed by script, not a person
    ...(opts.sound ? [] : ["--mute-audio"]),
    "about:blank",
  ]);
  const cdp = await connect(await devtoolsUrl());
  const t0 = Date.now();
  const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`;
  try {
    // The welcome page opens on first install: close it whenever it shows up.
    cdp.on((m) => {
      const t = m.params?.targetInfo;
      if (/^Target\.targetInfoChanged|^Target\.targetCreated/.test(m.method) && t?.type === "page" && /^chrome-extension:\/\/[^/]+\/welcome\//.test(t.url))
        cdp.send("Target.closeTarget", { targetId: t.targetId }).catch(() => {});
    });
    await cdp.send("Target.setDiscoverTargets", { discover: true });
    const extId = await extensionId(cdp);
    console.log(`${stamp()}  MusicMax loaded from dist/e2e-unpacked (id ${extId})`);
    if (opts.clearCache) {
      await clearCache(cdp, extId);
      console.log(`${stamp()}  saved lyrics cleared`);
    }

    const tab = await openTab(cdp, "about:blank");
    let world = null; // MusicMax's content-script context in the Spotify page
    cdp.on((m) => {
      if (m.sessionId !== tab.sessionId) return;
      const p = m.params;
      if (m.method === "Runtime.executionContextCreated" && p.context.auxData?.type === "isolated" && p.context.auxData.frameId === tab.targetId && p.context.origin.includes(extId)) world = p.context.id;
      else if (m.method === "Runtime.executionContextsCleared") world = null;
      else if (m.method === "Runtime.consoleAPICalled" && typeof p.args[0]?.value === "string" && p.args[0].value.includes("[SGL]"))
        console.log(`${stamp()}  ${p.args[0].value.replace(/%c/g, "")}`);
      else if (m.method === "Runtime.exceptionThrown" && JSON.stringify(p.exceptionDetails).includes(extId))
        console.log(`${stamp()}  [error] ${p.exceptionDetails.exception?.description || p.exceptionDetails.text}`);
    });
    await tab.send("Runtime.enable");
    await tab.send("Page.navigate", { url });
    console.log(`${stamp()}  opened ${url}`);

    await waitFor("MusicMax's content script didn't start on the Spotify page", async () => world && evaluate(tab, "!!globalThis.SGL?.spotify", world), 30000);
    const page = await waitFor(
      "the track page didn't load (no play button, no login button)",
      () => evaluate(tab, `document.querySelector('[data-testid="login-button"]') ? "signed-out" : document.querySelector(${JSON.stringify(TRACK_PLAY_BUTTON)}) ? "ready" : null`),
      30000,
    );
    if (page === "signed-out") fail("not signed in to Spotify in the test profile: run npm run e2e:login first");

    let last = "";
    const report = async () => {
      if (!world) return;
      const s = await evaluate(tab, PROBE, world).catch(() => null);
      if (!s) return;
      const key = JSON.stringify({ ...s, pos: undefined });
      if (key !== last) console.log(`${stamp()}  ${describeState(s)}`);
      last = key;
      return s;
    };
    await report();
    await evaluate(tab, `document.querySelector(${JSON.stringify(TRACK_PLAY_BUTTON)}).click()`);
    console.log(`${stamp()}  pressed play`);

    const startBy = Date.now() + 20000;
    while (!(await report())?.playing) {
      if (Date.now() > startBy) fail("Spotify didn't start playing: Widevine not enabled in the test profile? (run npm run e2e:login and play a song by hand)");
      await sleep(500);
    }
    for (const end = Date.now() + opts.seconds * 1000; Date.now() < end; await sleep(500)) await report();
    const s = await report().catch(() => null);
    console.log(`${stamp()}  done: ${s ? describeState(s) : "page state unreadable"}`);
  } finally {
    await cdp.send("Browser.close").catch(() => browser.kill());
  }
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { seconds: { type: "string", default: "30" }, "clear-cache": { type: "boolean" }, sound: { type: "boolean" } },
});
const [command, song] = positionals;
try {
  if (command === "login") await login();
  else if (command === "play") await play(song, { seconds: Number(values.seconds) || 30, clearCache: values["clear-cache"], sound: values.sound });
  else fail("usage: node tests/e2e/spotify.mjs login | play <track> [--seconds 30] [--clear-cache] [--sound]");
} catch (err) {
  console.error(err instanceof Fail ? `FAIL ${err.message}` : err);
  process.exitCode = 1;
}
