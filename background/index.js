// Service worker: everything the content script can't do itself (cross-origin requests,
// decoding cover art, persistent storage). The content script talks to it by message.

import { createLogger } from "./log.js";
import { createHttp } from "./http.js";
import { createCache } from "./cache.js";
import { createLookup, describe } from "./lookup.js";
import { coverTheme } from "./color.js";
import { trackKey } from "./match.js";
import { createGenius } from "./sources/genius.js";
import { createLrclib } from "./sources/lrclib.js";
import { createNetease } from "./sources/netease.js";

const storage = chrome.storage.local;
const log = createLogger({ storage });
const http = createHttp();
const cache = createCache(storage, { log });
// Automatic lookups use LRCLIB only (an open, documented lyrics API). Genius and NetEase
// join the manual "Wrong lyrics?" search, and give Japanese romaji, only when the user
// turns on "extraSources" and grants their optional host permissions.
const lrclib = createLrclib(http);
const auto = createLookup({ sources: [lrclib], log });
const all = createLookup({ sources: [lrclib, createGenius(http), createNetease(http)], log });
const EXTRA_ORIGINS = ["https://genius.com/*", "https://music.163.com/*"];

async function extraOn() {
  const { settings } = await storage.get("settings");
  return !!settings?.extraSources && (await chrome.permissions.contains({ origins: EXTRA_ORIGINS }));
}

// Keep the setting in step with the permission: the popup can close while Chrome's
// permission prompt is up, so the grant itself turns the setting on; taking it away in
// chrome://extensions turns it off.
chrome.permissions.onAdded.addListener(async ({ origins = [] }) => {
  if (!EXTRA_ORIGINS.every((o) => origins.includes(o))) return;
  const { settings = {} } = await storage.get("settings");
  if (!settings.extraSources) await storage.set({ settings: { ...settings, extraSources: true } });
});
// Permission taken away in chrome://extensions: turn the setting off to match.
chrome.permissions.onRemoved.addListener(async ({ origins = [] }) => {
  if (!origins.some((o) => EXTRA_ORIGINS.includes(o))) return;
  const { settings = {} } = await storage.get("settings");
  if (settings.extraSources) await storage.set({ settings: { ...settings, extraSources: false } });
});

// First install only (not updates): show the welcome page with how-to and two choices.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") chrome.tabs.create({ url: chrome.runtime.getURL("welcome/welcome.html") });
});

storage.get("settings").then((r) => log.setVerbose(!!r.settings?.verbose));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) log.setVerbose(!!changes.settings.newValue?.verbose);
});

self.addEventListener("error", (e) => log.error("worker", e.message, e.error));
self.addEventListener("unhandledrejection", (e) => log.error("worker", "unhandled rejection", e.reason));

const label = (t) => `"${t.artists?.join(", ")} - ${t.title}"`;

async function themeFor(url) {
  if (!url) return null;
  try {
    return await coverTheme(http, url);
  } catch (err) {
    log.warn("color", `cover color failed: ${err.message}`);
    return null;
  }
}

// Two messages for the same song at once (fast skipping, two tabs) share one lookup.
const inflight = new Map();

// Automatic results saved by older versions may come from Genius or NetEase: look those
// up again. Hand-picked lyrics are the user's choice and always kept.
const usable = (hit) => hit && (hit.result?.manual || hit.result?.status !== "found" || hit.result?.source === "LRCLIB");

async function lookupTrack(track) {
  const key = trackKey(track);
  const t0 = Date.now();
  const hit = await cache.get(key);
  if (usable(hit)) {
    let color = hit.color;
    if (!color && track.cover) {
      color = await themeFor(track.cover);
      if (color) await cache.update(key, { color });
    }
    log.info("lookup", `${label(track)} → ${describe(hit.result)} (saved)`);
    return { result: hit.result, color, cached: true, trace: ["from saved lyrics"] };
  }

  const [{ result, trace, errors }, color] = await Promise.all([auto.find(track), themeFor(track.cover)]);
  // Don't remember a "not found" if a source was down: it might have had the song.
  if (result.status === "found" || (result.status === "notFound" && errors === 0)) {
    await cache.put(key, { result, color });
  }
  const level = result.status === "error" ? "warn" : "info";
  log[level]("lookup", `${label(track)} → ${describe(result)} in ${Date.now() - t0}ms`, { trace });
  return { result, color, cached: false, trace };
}

const handlers = {
  lookup: ({ track }) => {
    const key = trackKey(track);
    if (!inflight.has(key)) {
      inflight.set(key, lookupTrack(track).finally(() => inflight.delete(key)));
    }
    return inflight.get(key);
  },

  // Romaji (NetEase) for a Japanese song, as timed lines.
  romaji: async ({ track }) => {
    if (!(await extraOn())) return { lines: null };
    try {
      const lines = await all.romaji(track);
      log.info("romaji", `${label(track)} → ${lines ? `${lines.length} lines` : "none on NetEase"}`);
      return { lines };
    } catch (err) {
      log.warn("romaji", `${label(track)}: ${err.message}`);
      return { error: err.message };
    }
  },

  // The cover as a data: URL, so the page can draw it into a share image without
  // "tainting" the canvas (a tainted canvas can't be exported).
  coverData: async ({ url }) => {
    const blob = await http.blob(url);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { dataUrl: `data:${blob.type || "image/jpeg"};base64,${btoa(bin)}` };
  },

  // The in-page settings panel can't ask for permissions (content scripts have no
  // chrome.permissions): open the toolbar popup, where the switch can.
  openPopup: async () => {
    try {
      await chrome.action.openPopup();
    } catch {
      await chrome.tabs.create({ url: chrome.runtime.getURL("popup/popup.html") });
    }
    return { ok: true };
  },

  search: async ({ query, track }) => {
    const res = await ((await extraOn()) ? all : auto).search(query, { title: track.title, artists: track.artists, duration: track.duration });
    log.info("search", `"${query}" → ${res.candidates.length} results`, res.trace.length ? { trace: res.trace } : undefined);
    return res;
  },

  // The user picked lyrics by hand: remember them for good (pinned).
  choose: async ({ track, candidate }) => {
    const key = trackKey(track);
    if (candidate.source !== "LRCLIB" && !(await extraOn())) return { error: "turn on Genius & NetEase in settings first" };
    const res = await all.fetchCandidate(candidate);
    if (!res) {
      log.info("choose", `${label(track)}: ${candidate.source} "${candidate.title}" has no lyrics`);
      return { result: { status: "notFound" } };
    }
    const result = { status: "found", manual: true, ...res };
    const prev = await cache.peek(key);
    const color = prev?.color ?? (await themeFor(track.cover));
    await cache.put(key, { result, color }, { pinned: true });
    log.info("choose", `${label(track)} → ${describe(result)}`);
    return { result, color };
  },

  // Forget the hand-picked lyrics and look the song up automatically again.
  reset: async ({ track }) => {
    await cache.remove(trackKey(track));
    log.info("choose", `${label(track)}: back to automatic match`);
    return handlers.lookup({ track });
  },

  log: ({ level, scope, msg, data }) => {
    log.add(level, `page:${scope}`, msg, data);
    return { ok: true };
  },

  stats: () => cache.stats(),
  clearCache: async () => {
    await cache.clear();
    log.info("cache", "saved lyrics cleared");
    return { ok: true };
  },
  getLog: () => ({ entries: log.entries() }),
  clearLog: () => {
    log.clear();
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) return;
  Promise.resolve()
    .then(() => handler(msg))
    .then(sendResponse, (err) => {
      log.error(msg.type, err.message, err);
      sendResponse({ error: err.message });
    });
  return true; // keep the channel open for the async response
});

log.loaded.then(() => log.info("worker", `started (v${chrome.runtime.getManifest().version})`));
