// The big lyrics view. Two placements:
//   - overlay: covers the main area like Spotify's cinema mode (opened from the mic)
//   - embedded: inside Spotify's expanded Now Playing view, under its header (lyrics tab)
// It also hosts the "Wrong lyrics?" picker and the settings panel.

(() => {
  const SGL = globalThis.SGL;
  const { el, iconButton } = SGL;

  SGL.createView = ({ onClose, onSeek, onWrongLyrics, onShare, onSearchManually }) => {
    const root = el("div", "sgl-view");
    root.hidden = true;

    // Ambient light behind the lyrics: the cover, blurred and slowly turning.
    // It pulses each time a new synced line starts.
    const ambient = el("div", "sgl-view-ambient");
    const ambientImg = SGL.blurredCover();
    ambient.append(ambientImg);

    const header = el("div", "sgl-view-header");
    const title = el("div", "sgl-view-title");
    const actions = el("div", "sgl-actions");
    const gearBtn = iconButton("gear", "Lyrics settings", () => toggleSettings());
    const fsBtn = iconButton("fullscreen", "Enter full screen", () => toggleFullscreen());
    const closeBtn = iconButton("collapse", "Close lyrics", () => onClose());
    actions.append(gearBtn, fsBtn, closeBtn);
    header.append(title, actions);

    const scroll = el("div", "sgl-view-scroll");
    const status = el("div", "sgl-status");
    const searchBtn = el("button", "sgl-more sgl-search-btn", "Search manually");
    searchBtn.type = "button";
    searchBtn.addEventListener("click", () => onSearchManually());
    const note = el("div", "sgl-note");
    const noteText = el("span");
    const noteBtn = el("button", "sgl-link-btn");
    noteBtn.type = "button";
    note.append(noteText, noteBtn);
    const list = new SGL.LyricsList({ className: "sgl-view-lines", anchor: 0.35, onSeek, onShare });
    list.attachScroller(scroll);

    const footer = el("div", "sgl-view-footer");
    const provider = el("a", "sgl-provider");
    provider.target = "_blank";
    provider.rel = "noopener noreferrer";
    const wrong = el("button", "sgl-link-btn", "Wrong lyrics?");
    wrong.type = "button";
    wrong.addEventListener("click", () => onWrongLyrics());
    // The header (and its gear) is hidden inside Spotify's expanded view: a second way in.
    const settingsLink = el("button", "sgl-link-btn", "Settings");
    settingsLink.type = "button";
    settingsLink.addEventListener("click", () => toggleSettings(true));
    footer.append(provider, wrong, settingsLink);

    scroll.append(status, searchBtn, note, list.root, footer);

    // Settings panel (same controls as the toolbar popup).
    const settingsPanel = el("div", "sgl-panel sgl-settings");
    settingsPanel.hidden = true;
    const panelHead = el("div", "sgl-picker-head");
    panelHead.append(el("h2", "sgl-picker-title", "Lyrics settings"), iconButton("close", "Close settings", () => toggleSettings(false)));
    const panelBody = el("div", "sgl-settings-body");
    settingsPanel.append(panelHead, panelBody);
    SGL.settings.render(panelBody);
    settingsPanel.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault(); // tells the view's own Escape handler to stay open
      toggleSettings(false);
    });

    root.append(ambient, header, scroll, settingsPanel);
    document.body.append(root);

    function toggleSettings(force) {
      const show = force ?? settingsPanel.hidden;
      settingsPanel.hidden = !show;
      gearBtn.classList.toggle("is-on", show);
    }

    // The ambient image is 64px and scaled up: enough to cover the view's diagonal while it turns.
    function sizeAmbient() {
      const r = root.getBoundingClientRect();
      if (r.width) ambientImg.style.setProperty("--sgl-k", Math.ceil(Math.hypot(r.width, r.height) / 64) + 2);
    }
    addEventListener("resize", () => !root.hidden && sizeAmbient());

    function toggleFullscreen() {
      if (document.fullscreenElement === root) document.exitFullscreen().catch(() => {});
      else root.requestFullscreen().catch((err) => SGL.log.warn("view", `full screen refused: ${err.message}`));
    }

    document.addEventListener("fullscreenchange", () => {
      const fs = document.fullscreenElement === root;
      fsBtn.setIcon(fs ? "exitFullscreen" : "fullscreen", fs ? "Exit full screen" : "Enter full screen");
      requestAnimationFrame(() => {
        list.recenter();
        sizeAmbient();
      });
    });

    return {
      root,
      list,
      isOpen: () => !root.hidden,
      isEmbedded: () => root.classList.contains("sgl-embedded"),
      isFullscreen: () => document.fullscreenElement === root,
      settingsOpen: () => !settingsPanel.hidden,
      toggleSettings,

      // container: Spotify's expanded view to sit inside, or null for the overlay.
      open(container) {
        if (container) {
          if (root.parentElement !== container) container.append(root);
          root.classList.add("sgl-embedded");
        } else {
          if (root.parentElement !== document.body) document.body.append(root);
          root.classList.remove("sgl-embedded");
          this.place();
        }
        const wasHidden = root.hidden;
        root.hidden = false;
        sizeAmbient();
        if (wasHidden) {
          scroll.scrollTop = 0;
          requestAnimationFrame(() => list.recenter());
        }
      },

      close() {
        if (document.fullscreenElement === root) document.exitFullscreen().catch(() => {});
        toggleSettings(false);
        root.hidden = true;
      },

      place() {
        if (root.classList.contains("sgl-embedded")) return;
        const { top, bottom } = SGL.spotify.contentArea();
        root.style.top = `${top}px`;
        root.style.bottom = `${bottom}px`;
      },

      toggleFullscreen,

      setAmbient({ enabled, cover }) {
        ambient.hidden = !enabled || !cover;
        if (enabled && cover) ambientImg.setCover(cover);
      },

      pulse() {
        ambient.classList.remove("is-pulse");
        void ambient.offsetWidth; // restart the animation
        ambient.classList.add("is-pulse");
      },

      // A line above the lyrics ("Translating…", "Download translation"…), or null.
      setNote(n) {
        note.hidden = !n;
        if (!n) return;
        noteText.textContent = n.text;
        noteBtn.hidden = !n.button;
        noteBtn.textContent = n.button || "";
        noteBtn.onclick = n.onClick || null;
      },

      // state: { title, result, loading, breakDots }
      render({ title: songTitle, result, loading, breakDots }) {
        title.textContent = songTitle || "";
        const found = result?.status === "found";
        list.render(found ? result : null, { breakDots });
        status.textContent = loading
          ? "Loading lyrics…"
          : found
            ? ""
            : result?.status === "notFound"
              ? "No lyrics found for this song."
              : result?.status === "error"
                ? `Couldn't load lyrics: ${result.error}`
                : "";
        status.hidden = !status.textContent;
        searchBtn.hidden = loading || found || !result;
        if (found && result.url) {
          provider.textContent = `Lyrics provided by ${result.source}${result.manual ? " (picked by you)" : ""}`;
          provider.href = result.url;
          provider.hidden = false;
        } else provider.hidden = true;
        wrong.hidden = !found;
      },
    };
  };
})();
