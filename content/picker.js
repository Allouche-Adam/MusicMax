// "Wrong lyrics?" panel: search every source, pick the right song; the choice is saved
// for good. Lives inside the big view so it works there, embedded or full screen.

(() => {
  const SGL = globalThis.SGL;
  const { el, iconButton } = SGL;

  const fmt = (sec) => (sec ? `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}` : "");

  SGL.createPicker = ({ mount, onSearch, onChoose, onReset }) => {
    const root = el("div", "sgl-picker");
    root.hidden = true;

    const head = el("div", "sgl-picker-head");
    head.append(el("h2", "sgl-picker-title", "Find the right lyrics"), iconButton("close", "Close", () => close()));

    const form = el("form", "sgl-picker-form");
    const input = el("input", "sgl-picker-input");
    input.type = "search";
    input.placeholder = "Artist and song title";
    input.setAttribute("aria-label", "Search lyrics");
    const go = el("button", "sgl-more", "Search");
    go.type = "submit";
    form.append(input, go);

    const status = el("div", "sgl-picker-status");
    const results = el("div", "sgl-picker-results");
    const reset = el("button", "sgl-link-btn", "Go back to the automatic match");
    reset.type = "button";
    reset.addEventListener("click", async () => {
      status.textContent = "Looking it up again…";
      await onReset();
      close();
    });

    root.append(head, form, status, results, reset);
    mount.append(root);

    // Keep Spotify's keyboard shortcuts (space = play/pause...) out of the search box.
    for (const type of ["keydown", "keyup", "keypress"]) {
      root.addEventListener(type, (e) => {
        if (e.key === "Escape" && type === "keydown") close();
        e.stopPropagation();
      });
    }

    let searchId = 0;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      const id = ++searchId;
      status.textContent = "Searching Genius, LRCLIB and NetEase…";
      results.replaceChildren();
      const res = await onSearch(q);
      if (id !== searchId) return; // a newer search started
      if (res?.error) {
        status.textContent = `Search failed: ${res.error}`;
        return;
      }
      const list = res?.candidates || [];
      status.textContent = list.length ? "" : "No results. Try fewer words, or the original title.";
      results.replaceChildren(...list.map(row));
    });

    function row(c) {
      const b = el("button", "sgl-picker-row");
      b.type = "button";
      const meta = [c.artist, fmt(c.duration), c.source].filter(Boolean).join(" · ");
      b.append(el("span", "sgl-picker-row-title", c.title), el("span", "sgl-picker-row-meta", meta));
      if (c.synced) b.append(el("span", "sgl-badge", "Synced"));
      b.addEventListener("click", async () => {
        status.textContent = `Loading lyrics from ${c.source}…`;
        const res = await onChoose(c);
        if (res?.result?.status === "found") close();
        else status.textContent = res?.error ? `Couldn't load: ${res.error}` : "That one has no lyrics. Try another.";
      });
      return b;
    }

    function open({ query, manual }) {
      root.hidden = false;
      input.value = query;
      status.textContent = "";
      results.replaceChildren();
      reset.hidden = !manual;
      input.focus();
      form.requestSubmit();
    }

    function close() {
      searchId++;
      root.hidden = true;
    }

    return { open, close, isOpen: () => !root.hidden };
  };
})();
