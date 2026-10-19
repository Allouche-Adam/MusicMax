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

// Opened from Spotify for one switch (Genius & NetEase need permission from here).
chrome.storage.session
  ?.get("popupFocus")
  .then(async ({ popupFocus }) => {
    if (!popupFocus) return;
    await chrome.storage.session.remove("popupFocus");
    const row = document.querySelector(`.sgs-row[data-key="${popupFocus}"]`);
    if (!row) return;
    row.scrollIntoView({ block: "center" });
    row.classList.add("is-focus");
    if (popupFocus === "extraSources" && !settings.get().extraSources) toast("Turn this on, then click Allow");
  })
  .catch(() => {});

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

// Secret settings: click the version 5 times (again to hide them and turn them off).
let versionClicks = 0;
let versionTimer = 0;
$("version").addEventListener("click", async () => {
  clearTimeout(versionTimer);
  versionTimer = setTimeout(() => (versionClicks = 0), 1500);
  if (++versionClicks < 5) return;
  versionClicks = 0;
  const unlock = !settings.get().secretUnlocked;
  await settings.set("secretUnlocked", unlock);
  if (!unlock) {
    await settings.set("secretStars", false);
    await settings.set("secretCursor", false);
  }
  toast(unlock ? "✨ Secret settings unlocked" : "Secret settings hidden");
  if (unlock) [...document.querySelectorAll(".sgs-group")].pop()?.scrollIntoView({ behavior: "smooth", block: "center" });
});

// Master switch at the very bottom: off = Spotify behaves as if MusicMax weren't installed.
function syncPower(s) {
  const off = s.enabled === false;
  document.body.classList.toggle("is-off", off);
  $("power").textContent = off ? "Turn MusicMax back on" : "Turn off MusicMax";
  $("powerNote").textContent = off
    ? "MusicMax is off. Spotify is untouched."
    : "Spotify will work as if MusicMax weren't installed.";
  $("version").textContent = off ? "OFF" : `v${chrome.runtime.getManifest().version}`;
}
settings.onChange(syncPower);
settings.ready.then(() => syncPower(settings.get()));
$("power").addEventListener("click", async () => {
  const off = settings.get().enabled !== false;
  await settings.set("enabled", !off);
  toast(off ? "MusicMax turned off" : "MusicMax is back on");
});
