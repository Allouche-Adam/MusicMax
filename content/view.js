// The big lyrics view. Two placements:
//   - overlay: covers the main area like Spotify's cinema mode (opened from the mic)
//   - embedded: inside Spotify's expanded Now Playing view, under its header (lyrics tab)

(() => {
  const SGL = globalThis.SGL;
  const { el, iconButton } = SGL;

  SGL.createView = ({ onClose, onSeek, onWrongLyrics }) => {
    const root = el("div", "sgl-view");
    root.hidden = true;

    const header = el("div", "sgl-view-header");
    const title = el("div", "sgl-view-title");
    const actions = el("div", "sgl-actions");
    const fsBtn = iconButton("fullscreen", "Enter full screen", () => toggleFullscreen());
    const closeBtn = iconButton("collapse", "Close lyrics", () => onClose());
    actions.append(fsBtn, closeBtn);
    header.append(title, actions);

    const scroll = el("div", "sgl-view-scroll");
    const status = el("div", "sgl-status");
    const list = new SGL.LyricsList({ className: "sgl-view-lines", anchor: 0.35, onSeek });
    list.attachScroller(scroll);

    const footer = el("div", "sgl-view-footer");
    const provider = el("a", "sgl-provider");
    provider.target = "_blank";
    provider.rel = "noopener noreferrer";
    const wrong = el("button", "sgl-link-btn", "Wrong lyrics?");
    wrong.type = "button";
    wrong.addEventListener("click", () => onWrongLyrics());
    footer.append(provider, wrong);

    scroll.append(status, list.root, footer);
    root.append(header, scroll);
    document.body.append(root);

    function toggleFullscreen() {
      if (document.fullscreenElement === root) document.exitFullscreen().catch(() => {});
      else root.requestFullscreen().catch((err) => SGL.log.warn("view", `full screen refused: ${err.message}`));
    }

    document.addEventListener("fullscreenchange", () => {
      const fs = document.fullscreenElement === root;
      fsBtn.setIcon(fs ? "exitFullscreen" : "fullscreen", fs ? "Exit full screen" : "Enter full screen");
      requestAnimationFrame(() => list.recenter());
    });

    return {
      root,
      list,
      isOpen: () => !root.hidden,
      isEmbedded: () => root.classList.contains("sgl-embedded"),

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
        if (wasHidden) {
          scroll.scrollTop = 0;
          requestAnimationFrame(() => list.recenter());
        }
      },

      close() {
        if (document.fullscreenElement === root) document.exitFullscreen().catch(() => {});
        root.hidden = true;
      },

      place() {
        if (root.classList.contains("sgl-embedded")) return;
        const { top, bottom } = SGL.spotify.contentArea();
        root.style.top = `${top}px`;
        root.style.bottom = `${bottom}px`;
      },

      toggleFullscreen,

      // state: { title, result, loading }
      render({ title: songTitle, result, loading }) {
        title.textContent = songTitle || "";
        const found = result?.status === "found";
        list.render(found ? result : null);
        status.textContent = loading ? "Loading lyrics…" : found ? "" : result?.status === "error" ? `Couldn't load lyrics: ${result.error}` : "";
        status.hidden = !status.textContent;
        if (found && result.url) {
          provider.textContent = `Lyrics provided by ${result.source}${result.manual ? " (picked by you)" : ""}`;
          provider.href = result.url;
          provider.hidden = false;
        } else provider.hidden = true;
        wrong.hidden = !found;
        footer.hidden = !found;
      },
    };
  };
})();
