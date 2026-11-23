// Welcome page, opened once after install (background/index.js). Two optional choices,
// saved through the same settings as the popup and the panel inside Spotify.

const $ = (id) => document.getElementById(id);
const { settings } = globalThis.SGL;

// "Translate to" choices: the same list as the settings.
for (const [code, name] of settings.LANGUAGES) {
  const o = document.createElement("option");
  o.value = code;
  o.textContent = name;
  $("translateTo").append(o);
}

// Genius & NetEase need the browser's permission for their sites, asked straight from the click.
const EXTRA_ORIGINS = settings.SCHEMA.flatMap((g) => g.items).find((i) => i.key === "extraSources").origins;

// The pop-out window only exists in Chromium browsers.
$("popout").hidden = !("documentPictureInPicture" in window);

function sync(s) {
  $("extraSources").setAttribute("aria-checked", String(!!s.extraSources));
  $("alwaysOurs").setAttribute("aria-checked", String(!!s.alwaysOurs));
  $("translate").setAttribute("aria-checked", String(!!s.translate));
  $("translateTo").value = s.translateTo;
  $("langRow").hidden = !s.translate;
}
settings.onChange(sync);
settings.ready.then(() => sync(settings.get()));

let savedTimer = 0;
async function save(key, value) {
  await settings.set(key, value);
  $("saved").textContent = "Saved. It applies right away in Spotify.";
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => ($("saved").textContent = ""), 2500);
}

$("extraSources").addEventListener("click", async () => {
  if (settings.get().extraSources) {
    await save("extraSources", false);
    return chrome.permissions.remove({ origins: EXTRA_ORIGINS }).catch(() => {});
  }
  // Declined in the browser's prompt: the switch stays off, nothing to save.
  if (await chrome.permissions.request({ origins: EXTRA_ORIGINS }).catch(() => false)) save("extraSources", true);
});
$("alwaysOurs").addEventListener("click", () => save("alwaysOurs", !settings.get().alwaysOurs));
$("translate").addEventListener("click", () => save("translate", !settings.get().translate));
$("translateTo").addEventListener("change", (e) => save("translateTo", e.target.value));
