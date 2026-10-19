// Shared helpers for the content scripts. Every content file is wrapped in an IIFE and
// hangs its exports on globalThis.SGL (content scripts share one global scope, so
// top-level declarations in different files would collide).

(() => {
  const SGL = (globalThis.SGL = globalThis.SGL || {});

  // Only the Firefox build's manifest has browser_specific_settings (see scripts/package.mjs).
  SGL.firefox = !!chrome.runtime.getManifest().browser_specific_settings?.gecko;

  SGL.el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const ICONS = {
    fullscreen: "M1 1h5v1.5H2.5V6H1V1zm9 0h5v5h-1.5V2.5H10V1zM1 10h1.5v3.5H6V15H1v-5zm13.5 0H15v5h-5v-1.5h3.5V10z",
    exitFullscreen: "M6 1v5H1V4.5h3.5V1H6zm4 0h1.5v3.5H15V6h-5V1zM1 10h5v5H4.5v-3.5H1V10zm9 0h5v1.5h-3.5V15H10v-5z",
    expand: "M9 1h6v6h-1.5V3.56L9.53 7.53 8.47 6.47l3.97-3.97H9V1zM1 9h1.5v3.44l3.97-3.97 1.06 1.06-3.97 3.97H7V15H1V9z",
    collapse: "M15 2.06 11.06 6H14v1.5H8.5V2H10v2.94L13.94 1 15 2.06zM1 13.94 4.94 10H2V8.5h5.5V14H6v-2.94L2.06 15 1 13.94z",
    close: "M2.47 2.47a.75.75 0 0 1 1.06 0L8 6.94l4.47-4.47a.75.75 0 1 1 1.06 1.06L9.06 8l4.47 4.47a.75.75 0 1 1-1.06 1.06L8 9.06l-4.47 4.47a.75.75 0 0 1-1.06-1.06L6.94 8 2.47 3.53a.75.75 0 0 1 0-1.06z",
    gear: "M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM9 .5l.35 1.6c.45.13.88.31 1.28.54l1.38-.88 1.41 1.41-.88 1.38c.23.4.41.83.54 1.28L15.5 7v2l-1.6.35c-.13.45-.31.88-.54 1.28l.88 1.38-1.41 1.41-1.38-.88c-.4.23-.83.41-1.28.54L9 15.5H7l-.35-1.6a5.4 5.4 0 0 1-1.28-.54l-1.38.88-1.41-1.41.88-1.38a5.4 5.4 0 0 1-.54-1.28L.5 9V7l1.6-.35c.13-.45.31-.88.54-1.28l-.88-1.38 1.41-1.41 1.38.88c.4-.23.83-.41 1.28-.54L7 .5h2z",
  };

  SGL.iconButton = (name, label, onClick) => {
    const b = SGL.el("button", "sgl-icon-btn");
    b.type = "button";
    b.title = label;
    b.setAttribute("aria-label", label);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", ICONS[name]);
    path.setAttribute("fill-rule", "evenodd"); // the gear's center is a hole
    svg.append(path);
    b.append(svg);
    b.addEventListener("click", onClick);
    b.setIcon = (n, newLabel) => {
      path.setAttribute("d", ICONS[n]);
      if (newLabel) {
        b.title = newLabel;
        b.setAttribute("aria-label", newLabel);
      }
    };
    return b;
  };

  // The album cover, blurred once into a tiny canvas, for the ambient backgrounds.
  // Performance: a CSS blur on an element that is then scaled up gets re-done by Chrome
  // at the full on-screen size (on every frame while it turns). A canvas only has 24×24
  // real pixels, so scaling it up just stretches an already-blurred picture: GPU-cheap.
  SGL.blurredCover = () => {
    const SIZE = 24;
    const canvas = SGL.el("canvas", "sgl-ambient-canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    let current = null;
    canvas.setCover = (url) => {
      if (!url || url === current) return;
      current = url;
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        if (current !== url) return;
        ctx.clearRect(0, 0, SIZE, SIZE);
        ctx.filter = "blur(1.2px) saturate(1.5)";
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
      };
      img.src = url;
    };
    return canvas;
  };

  // Message the background worker. Never throws: failures come back as { error }.
  SGL.send = async (msg) => {
    try {
      const res = await chrome.runtime.sendMessage(msg);
      return res ?? { error: "no response from the extension" };
    } catch (err) {
      const m = String(err?.message || err);
      return {
        error: m.includes("context invalidated") ? "the extension was reloaded: refresh this page" : m,
        invalidated: m.includes("context invalidated"),
      };
    }
  };

  // ---------- logging ----------
  // Console lines start with a green [SGL]. info/warn/error also go to the background
  // log (popup → "Copy debug log"); identical messages are sent at most every 30s.

  let verbose = false;
  try {
    chrome.storage.local.get("settings").then((r) => (verbose = !!r.settings?.verbose)).catch(() => {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.settings) verbose = !!changes.settings.newValue?.verbose;
    });
  } catch {}

  const lastSent = new Map();
  function out(level, scope, msg, data, { forward = true } = {}) {
    if (level === "debug" && !verbose) return;
    const fn = level === "debug" ? "log" : level;
    const extra = data !== undefined ? [data] : [];
    console[fn](`%c[SGL]%c ${scope}: ${msg}`, "color:#1ed760;font-weight:bold", "", ...extra);
    if (level === "debug" || !forward) return;
    const key = `${level}|${scope}|${msg}`;
    if (Date.now() - (lastSent.get(key) || 0) < 30000) return;
    lastSent.set(key, Date.now());
    const plain = data instanceof Error ? { message: data.message, stack: data.stack } : data;
    SGL.send({ type: "log", level, scope, msg: String(msg), data: plain });
  }

  // opts.forward = false: console only (when the background already logged the same thing).
  SGL.log = {
    debug: (scope, msg, data) => out("debug", scope, msg, data),
    info: (scope, msg, data, opts) => out("info", scope, msg, data, opts),
    warn: (scope, msg, data, opts) => out("warn", scope, msg, data, opts),
    error: (scope, msg, data, opts) => out("error", scope, msg, data, opts),
    isVerbose: () => verbose,
  };

  // Debugging from the page's DevTools console:
  //   postMessage({ type: "SGL_DUMP_LOG", last: 40 }, "*")
  // prints the newest background log entries (lookups, errors, traces) right there.
  addEventListener("message", async (e) => {
    if (e.source !== window || e.data?.type !== "SGL_DUMP_LOG") return;
    const res = await SGL.send({ type: "getLog" });
    const lines = (res.entries || [])
      .slice(-(Number(e.data.last) || 40))
      .map((x) => `${x.t.slice(11, 19)} ${x.level.toUpperCase().padEnd(5)} [${x.scope}] ${x.msg}${x.data !== undefined ? " " + JSON.stringify(x.data) : ""}`);
    console.log(`[SGL] background log (${lines.length} entries):\n${lines.join("\n")}`);
  });

  // Wraps a function so an exception is logged instead of killing the caller (the main loop).
  SGL.guard = (scope, fn) =>
    function guarded(...args) {
      try {
        return fn.apply(this, args);
      } catch (err) {
        SGL.log.error(scope, err?.message || String(err), err);
      }
    };
})();
