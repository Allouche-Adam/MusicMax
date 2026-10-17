// "Lyrics" card in the Now Playing sidebar, like Spotify's own: a short preview that
// follows the song, "Show more" to read further, buttons for settings, full screen and
// the big view.

(() => {
  const SGL = globalThis.SGL;
  const { el, iconButton } = SGL;

  SGL.createCard = ({ onOpenView, onFullscreen, onSettings, onSeek, onShare }) => {
    let expanded = false;
    const root = el("div", "sgl-card");

    const header = el("div", "sgl-card-header");
    const actions = el("div", "sgl-actions");
    actions.append(
      iconButton("gear", "Lyrics settings", () => onSettings()),
      iconButton("fullscreen", "Enter full screen", () => onFullscreen()),
      iconButton("expand", "Open lyrics view", () => onOpenView())
    );
    header.append(el("h2", "sgl-card-title", "Lyrics"), actions);

    const body = el("div", "sgl-card-body");
    const list = new SGL.LyricsList({ className: "sgl-card-lines", anchor: 0.2, onSeek, onShare });
    list.attachScroller(body);
    body.append(list.root);

    const footer = el("div", "sgl-card-footer");
    const more = el("button", "sgl-more", "Show more");
    more.type = "button";
    more.addEventListener("click", () => setExpanded(!expanded));
    footer.append(more);
    root.append(header, body, footer);

    function setExpanded(on) {
      expanded = on;
      body.classList.toggle("sgl-expanded", on);
      more.textContent = on ? "Show less" : "Show more";
      if (!on) body.scrollTop = 0;
      requestAnimationFrame(() => list.recenter());
    }

    return {
      root,
      list,
      collapse: () => setExpanded(false),
      // Put the card first in the sidebar column (or take it out).
      place(column) {
        if (!column) return root.remove();
        if (column.firstElementChild !== root) {
          column.prepend(root);
          requestAnimationFrame(() => list.recenter());
        }
      },
      remove: () => root.remove(),
      isPlaced: () => root.isConnected,
    };
  };
})();
