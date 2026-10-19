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

function sync(s) {
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

$("alwaysOurs").addEventListener("click", () => save("alwaysOurs", !settings.get().alwaysOurs));
$("translate").addEventListener("click", () => save("translate", !settings.get().translate));
$("translateTo").addEventListener("change", (e) => save("translateTo", e.target.value));
