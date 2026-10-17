// Toolbar popup: saved-lyrics stats, clearing, and the debug log.

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

function flash(text) {
  $("msg").textContent = text;
  setTimeout(() => ($("msg").textContent = ""), 2500);
}

async function showStats() {
  const s = await send({ type: "stats" });
  if (!s || s.error) {
    $("stats").textContent = "Couldn't read saved lyrics.";
    return;
  }
  const parts = [`${s.count} song${s.count === 1 ? "" : "s"}`];
  if (s.pinned) parts.push(`${s.pinned} picked by you`);
  if (s.notFound) parts.push(`${s.notFound} with no lyrics found`);
  $("stats").textContent = parts.join(" · ") + " (max 500).";
}

$("clear").addEventListener("click", async () => {
  await send({ type: "clearCache" });
  await showStats();
  flash("Saved lyrics cleared.");
});

$("copy").addEventListener("click", async () => {
  const { entries = [] } = (await send({ type: "getLog" })) || {};
  const manifest = chrome.runtime.getManifest();
  const header = `Spotify Lyrics Fallback v${manifest.version} — ${navigator.userAgent}\n`;
  const lines = entries.map((e) => `${e.t} ${e.level.toUpperCase().padEnd(5)} [${e.scope}] ${e.msg}${e.data !== undefined ? " " + JSON.stringify(e.data) : ""}`);
  await navigator.clipboard.writeText(header + lines.join("\n"));
  flash(`Copied ${entries.length} log lines.`);
});

$("clearLog").addEventListener("click", async () => {
  await send({ type: "clearLog" });
  flash("Log cleared.");
});

chrome.storage.local.get("settings").then(({ settings }) => {
  $("verbose").checked = !!settings?.verbose;
});

$("verbose").addEventListener("change", async (e) => {
  const { settings = {} } = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({ settings: { ...settings, verbose: e.target.checked } });
  flash(e.target.checked ? "Detailed logging on." : "Detailed logging off.");
});

showStats();
