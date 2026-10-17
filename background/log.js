// Debug log for the whole extension. Keeps the last few hundred entries in
// chrome.storage.local so they survive the service worker going to sleep; the popup's
// "Copy debug log" button reads them. Content-script messages are forwarded here too.

const KEY = "debugLog";
const LEVELS = ["debug", "info", "warn", "error"];

export function createLogger({ storage, max = 300, consoleImpl = console, now = Date.now } = {}) {
  let entries = [];
  let verbose = false;
  let saveTimer = null;

  const loaded = storage
    ? storage
        .get(KEY)
        .then((r) => {
          entries = [...(r?.[KEY] || []), ...entries].slice(-max);
        })
        .catch(() => {})
    : Promise.resolve();

  function save() {
    if (!storage || saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      storage.set({ [KEY]: entries }).catch(() => {});
    }, 1000);
  }

  function add(level, scope, msg, data) {
    if (!LEVELS.includes(level)) level = "info";
    if (level === "debug" && !verbose) return;
    const entry = { t: new Date(now()).toISOString(), level, scope, msg: String(msg) };
    if (data !== undefined) entry.data = toPlain(data);
    entries.push(entry);
    if (entries.length > max) entries.splice(0, entries.length - max);
    const fn = level === "debug" ? "log" : level;
    consoleImpl[fn]?.(`[SGL ${scope}] ${entry.msg}`, ...(data !== undefined ? [entry.data] : []));
    save();
  }

  return {
    loaded,
    debug: (scope, msg, data) => add("debug", scope, msg, data),
    info: (scope, msg, data) => add("info", scope, msg, data),
    warn: (scope, msg, data) => add("warn", scope, msg, data),
    error: (scope, msg, data) => add("error", scope, msg, data),
    add,
    entries: () => entries.slice(),
    setVerbose: (on) => {
      verbose = !!on;
    },
    clear: () => {
      entries = [];
      save();
    },
  };
}

// Makes data safe to store as JSON: errors become {message, stack}, long strings are cut.
export function toPlain(data, depth = 0) {
  if (data instanceof Error) return { message: data.message, stack: data.stack?.split("\n").slice(0, 4).join("\n") };
  if (typeof data === "string") return data.length > 500 ? `${data.slice(0, 500)}…` : data;
  if (data === null || typeof data !== "object") return data;
  if (depth > 3) return "[…]";
  if (Array.isArray(data)) return data.slice(0, 30).map((d) => toPlain(d, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(data).slice(0, 30)) out[k] = toPlain(v, depth + 1);
  return out;
}
