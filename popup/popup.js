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
settings.render($("settings"), { heading: "h2" });

// The welcome page is also the guide: reopen it any time.
$("howTo").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("welcome/welcome.html") }));

// Support links (popup/links.js). The feedback form shows up once its link is filled in.
const LINKS = globalThis.MUSICMAX_LINKS || {};
$("rate").href = navigator.userAgent.includes("Firefox") ? LINKS.firefoxReviews : LINKS.chromeReviews;
$("coffee").href = LINKS.coffee;
if (LINKS.feedbackForm) {
  $("feedback").href = LINKS.feedbackForm;
  $("feedback").hidden = false;
}

// What's new: the card stays until dismissed; opening the popup clears the icon's dot.
const NEWS = globalThis.MUSICMAX_NEWS;
$("newsIntro").textContent = NEWS.intro || "";
$("newsIntro").hidden = !NEWS.intro;
$("newsItems").append(
  ...NEWS.items.map((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    return li;
  })
);
chrome.storage.local.get("newsSeen").then(({ newsSeen }) => ($("news").hidden = newsSeen === NEWS.id));
chrome.storage.local.set({ newsOpened: NEWS.id });
chrome.action.setBadgeText({ text: "" });
$("newsClose").addEventListener("click", () => {
  $("news").hidden = true;
  chrome.storage.local.set({ newsSeen: NEWS.id });
});
$("newsOpen").addEventListener("click", () => {
  $("news").hidden = false;
  $("news").scrollIntoView({ block: "center" });
});

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
