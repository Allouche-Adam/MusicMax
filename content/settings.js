// Settings: one list of options, used by both the toolbar popup and the panel inside
// Spotify. Stored in chrome.storage.local under "settings"; every page updates live.

(() => {
  const SGL = (globalThis.SGL = globalThis.SGL || {});

  const LANGUAGES = [
    ["en", "English"],
    ["fr", "French"],
    ["es", "Spanish"],
    ["pt", "Portuguese"],
    ["de", "German"],
    ["it", "Italian"],
    ["nl", "Dutch"],
    ["ja", "Japanese"],
    ["ko", "Korean"],
    ["zh", "Chinese"],
    ["ru", "Russian"],
    ["ar", "Arabic"],
    ["tr", "Turkish"],
    ["hi", "Hindi"],
  ];
  const browserLang = (navigator.language || "en").slice(0, 2);

  const SCHEMA = [
    {
      group: "Lyrics",
      items: [
        { key: "textSize", label: "Text size", type: "choice", options: [["s", "S"], ["m", "M"], ["l", "L"], ["xl", "XL"]], default: "m" },
        { key: "align", label: "Alignment", type: "choice", options: [["left", "Left"], ["center", "Center"]], default: "left" },
        { key: "karaoke", label: "Karaoke fill on the current line", type: "toggle", default: true },
        { key: "breakDots", label: "Dots during instrumental breaks", type: "toggle", default: true },
        { key: "translate", label: "Show a translation under each line", type: "toggle", default: false },
        {
          key: "translateTo",
          label: "Translate to",
          type: "select",
          options: LANGUAGES,
          default: LANGUAGES.some(([c]) => c === browserLang) ? browserLang : "en",
        },
        { key: "romanize", label: "Show romanization (Japanese, Korean, Cyrillic, Greek)", type: "toggle", default: false },
        {
          key: "alwaysOurs",
          label: "Always use MusicMax lyrics (even when Spotify has its own)",
          type: "toggle",
          default: false,
        },
      ],
    },
    {
      group: "Look",
      items: [
        { key: "background", label: "Lyrics background", type: "choice", options: [["cover", "Moving cover"], ["flat", "Flat color"]], default: "cover" },
        { key: "ambient", label: "Ambient light around covers & videos", type: "toggle", default: true },
        {
          key: "ambientSpotify",
          label: "Ambient light on Spotify's own lyrics",
          type: "toggle",
          default: true,
          // MusicMax's view covers Spotify's lyrics then: the light would run unseen.
          disabledWhen: (s) => s.alwaysOurs,
          disabledNote: "Off while “Always use MusicMax lyrics” is on",
        },
        { key: "glow", label: "Glow strength", type: "range", min: 10, max: 100, step: 5, default: 75 },
        { key: "pulse", label: "Pulse the light on each new line", type: "toggle", default: true },
      ],
    },
    {
      group: "Behavior",
      items: [
        // Off by default: songs are looked up on LRCLIB only. Turning this on asks Chrome
        // for access to these sites (optional_host_permissions in the manifest).
        {
          key: "extraSources",
          label: "Also search Genius & NetEase (manual search, Japanese romaji)",
          type: "toggle",
          default: false,
          origins: ["https://genius.com/*", "https://music.163.com/*"],
        },
        { key: "shortcuts", label: "Keyboard shortcuts: L lyrics · F full screen", type: "toggle", default: true },
      ],
    },
    {
      // Folded at the bottom: fun extras, off by default.
      group: "Secret ✨",
      collapsed: true,
      items: [
        { key: "secretStars", label: "Stars fly off each new lyric line", type: "toggle", default: false },
        { key: "secretCursor", label: "Sparkle trail behind the cursor", type: "toggle", default: false },
      ],
    },
  ];

  const DEFAULTS = Object.fromEntries(SCHEMA.flatMap((g) => g.items).map((i) => [i.key, i.default]));
  DEFAULTS.verbose = false;
  DEFAULTS.enabled = true; // the popup's "Turn off MusicMax" button

  let current = { ...DEFAULTS };
  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => fn(current));

  const ready = chrome.storage.local
    .get("settings")
    .then((r) => {
      current = { ...DEFAULTS, ...(r.settings || {}) };
      notify();
    })
    .catch(() => {});

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.settings) return;
    current = { ...DEFAULTS, ...(changes.settings.newValue || {}) };
    notify();
  });

  // Writes go out one at a time: two quick changes used to read the same stored settings
  // and the second write erased the first. `unsaved` holds this page's changes until
  // they're written.
  const unsaved = {};
  let writing = Promise.resolve();

  function set(key, value) {
    current = { ...current, [key]: value };
    unsaved[key] = value;
    notify();
    writing = writing
      .then(async () => {
        const batch = { ...unsaved };
        if (!Object.keys(batch).length) return;
        const { settings = {} } = await chrome.storage.local.get("settings");
        await chrome.storage.local.set({ settings: { ...settings, ...batch } });
        for (const [k, v] of Object.entries(batch)) if (unsaved[k] === v) delete unsaved[k];
      })
      .catch(() => {});
    return writing;
  }

  // Builds the controls into `container`. Used by the popup and the in-page panel.
  function render(container) {
    const el = (tag, cls, text) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    };
    const controls = new Map();

    for (const group of SCHEMA) {
      const section = el(group.collapsed ? "details" : "section", "sgs-group");
      section.append(el(group.collapsed ? "summary" : "h3", "sgs-group-title", group.group));
      for (const item of group.items) {
        const row = el("div", `sgs-row sgs-row-${item.type}`);
        row.dataset.key = item.key;
        const label = el("span", "sgs-label", item.label);
        row.append(label);
        let control;

        if (item.type === "toggle") {
          control = el("button", "sgs-switch");
          control.type = "button";
          control.setAttribute("role", "switch");
          control.setAttribute("aria-label", item.label);
          control.addEventListener("click", () => {
            const on = !current[item.key];
            if (!item.origins) return set(item.key, on);
            // Only extension pages (the popup) can ask for permissions, and only straight
            // from the click. The panel inside Spotify opens the popup instead.
            if (!chrome.permissions) return chrome.runtime.sendMessage({ type: "openPopup", focus: item.key }).catch(() => {});
            if (!on) {
              set(item.key, false);
              return chrome.permissions.remove({ origins: item.origins }).catch(() => {});
            }
            chrome.permissions.request({ origins: item.origins }).then((ok) => ok && set(item.key, true), () => {});
          });
          control.sync = (v) => control.setAttribute("aria-checked", String(!!v));
        } else if (item.type === "choice") {
          control = el("div", "sgs-segmented");
          control.setAttribute("role", "radiogroup");
          control.setAttribute("aria-label", item.label);
          const buttons = item.options.map(([value, text]) => {
            const b = el("button", "sgs-seg", text);
            b.type = "button";
            b.setAttribute("role", "radio");
            b.addEventListener("click", () => set(item.key, value));
            control.append(b);
            return [value, b];
          });
          control.sync = (v) => buttons.forEach(([value, b]) => b.setAttribute("aria-checked", String(value === v)));
        } else if (item.type === "select") {
          control = el("select", "sgs-select");
          control.setAttribute("aria-label", item.label);
          for (const [value, text] of item.options) {
            const o = el("option", null, text);
            o.value = value;
            control.append(o);
          }
          control.addEventListener("change", () => set(item.key, control.value));
          control.sync = (v) => (control.value = v);
        } else if (item.type === "range") {
          control = el("input", "sgs-range");
          control.type = "range";
          control.min = item.min;
          control.max = item.max;
          control.step = item.step;
          control.setAttribute("aria-label", item.label);
          control.addEventListener("input", () => set(item.key, Number(control.value)));
          control.sync = (v) => {
            control.value = v;
            control.style.setProperty("--sgs-fill", `${((v - item.min) / (item.max - item.min)) * 100}%`);
          };
        }
        row.append(control);
        controls.set(item.key, control);
        section.append(row);
      }
      container.append(section);
    }

    const items = Object.fromEntries(SCHEMA.flatMap((g) => g.items).map((i) => [i.key, i]));
    const sync = (s) => {
      controls.forEach((c, key) => {
        c.sync(s[key]);
        const off = !!items[key].disabledWhen?.(s);
        c.disabled = off;
        c.closest(".sgs-row").classList.toggle("is-disabled", off);
        c.closest(".sgs-row").title = off ? items[key].disabledNote || "" : "";
      });
    };
    sync(current);
    listeners.add(sync);
    // Keep Spotify's keyboard shortcuts away from these controls (Escape still closes the panel).
    for (const type of ["keydown", "keyup", "keypress"]) {
      container.addEventListener(type, (e) => e.key !== "Escape" && e.stopPropagation());
    }
    return () => listeners.delete(sync);
  }

  SGL.settings = {
    SCHEMA,
    DEFAULTS,
    LANGUAGES,
    ready,
    get: () => current,
    set,
    onChange: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    render,
  };
})();
