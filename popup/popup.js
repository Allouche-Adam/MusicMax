// Toolbar popup: every setting (shared with the panel inside Spotify), saved-lyrics
// stats, clearing, and the debug log.

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
const { settings } = globalThis.SGL;

let toastTimer = 0;
function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

$("version").textContent = `v${chrome.runtime.getManifest().version}`;
settings.render($("settings"));

async function showStats() {
  const s = await send({ type: "stats" }).catch(() => null);
  $("statSongs").textContent = s?.count ?? "–";
  $("statPinned").textContent = s?.pinned ?? "–";
  $("statMissing").textContent = s?.notFound ?? "–";
}

$("clear").addEventListener("click", async () => {
  await send({ type: "clearCache" });
  await showStats();
  toast("Saved lyrics cleared");
});

$("copy").addEventListener("click", async () => {
  const { entries = [] } = (await send({ type: "getLog" })) || {};
  const header = `MusicMax v${chrome.runtime.getManifest().version} — ${navigator.userAgent}\n`;
  const lines = entries.map(
    (e) => `${e.t} ${e.level.toUpperCase().padEnd(5)} [${e.scope}] ${e.msg}${e.data !== undefined ? " " + JSON.stringify(e.data) : ""}`
  );
  await navigator.clipboard.writeText(header + lines.join("\n"));
  toast(`Copied ${entries.length} log lines`);
});

$("clearLog").addEventListener("click", async () => {
  await send({ type: "clearLog" });
  toast("Log cleared");
});

const syncVerbose = (s) => $("verbose").setAttribute("aria-checked", String(!!s.verbose));
settings.onChange(syncVerbose);
settings.ready.then(() => syncVerbose(settings.get()));
$("verbose").addEventListener("click", async () => {
  const on = !settings.get().verbose;
  await settings.set("verbose", on);
  toast(on ? "Detailed logging on" : "Detailed logging off");
});

showStats();
