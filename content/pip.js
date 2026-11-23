// Pop-out lyrics: a small always-on-top window (Chrome's Document Picture-in-Picture, the
// same thing Spotify's miniplayer uses) with the synced lyrics, the cover and the player
// buttons, so the lyrics stay on screen over other tabs and apps. Its background is the
// cover's colors, slowly moving (the cover itself, cropped that small, often clashed).
// Chrome only: Firefox has no such window, so the button isn't shown there.

(() => {
  const SGL = globalThis.SGL;
  const { el, iconButton, spotify } = SGL;

  const supported = "documentPictureInPicture" in window;
  const SIZE = { width: 360, height: 560 };

  SGL.createPip = ({ onSeek, onOpen, onClose, onAllowExtras }) => {
    let win = null;

    const root = el("div", "sgl-pip");
    const ambient = el("div", "sgl-pip-ambient");

    const head = el("div", "sgl-pip-head");
    const art = el("img", "sgl-pip-art");
    art.alt = "";
    const meta = el("div", "sgl-pip-meta");
    const title = el("div", "sgl-pip-title");
    const artist = el("div", "sgl-pip-artist");
    meta.append(title, artist);
    head.append(art, meta);

    const scroll = el("div", "sgl-pip-scroll");
    const status = el("div", "sgl-pip-status");
    // Same offer as the big view's: no lyrics, and Genius & NetEase not allowed yet.
    const extras = el("div", "sgl-pip-extras");
    const extrasBtn = el("button", "sgl-more", "Search Genius & NetEase");
    extrasBtn.type = "button";
    extrasBtn.addEventListener("click", () => onAllowExtras());
    extras.append(extrasBtn, el("p", "sgl-extras-hint", "Allow them once and MusicMax checks them for every song."));
    const list = new SGL.LyricsList({ className: "sgl-pip-lines", anchor: 0.38, onSeek });
    list.attachScroller(scroll);
    scroll.append(status, extras, list.root);

    const controls = el("div", "sgl-pip-controls");
    // Spotify's own player buttons do the work.
    const play = iconButton("play", "Play", () => spotify.press("playPause"));
    play.classList.add("sgl-pip-play");
    controls.append(
      iconButton("prev", "Previous", () => spotify.press("previous")),
      play,
      iconButton("next", "Next", () => spotify.press("next"))
    );

    const note = SGL.noteBar();
    root.append(ambient, head, note, scroll, controls);

    async function open() {
      if (!supported) return null;
      if (win) {
        win.focus();
        return win;
      }
      // Must run straight from a click (Chrome only opens it on a user gesture).
      win = await documentPictureInPicture.requestWindow(SIZE);
      const doc = win.document;
      // Spotify's stylesheets (its fonts), then ours.
      for (const node of document.querySelectorAll('link[rel="stylesheet"]')) doc.head.append(node.cloneNode());
      const ours = doc.createElement("link");
      ours.rel = "stylesheet";
      ours.href = chrome.runtime.getURL("content.css");
      doc.head.append(ours);
      doc.title = "MusicMax lyrics";
      doc.body.className = "sgl-pip-body";
      doc.body.append(root);
      win.addEventListener("resize", () => list.recenter());
      win.addEventListener("pagehide", () => {
        win = null;
        root.remove();
        onClose?.();
      });
      onOpen?.(win);
      win.requestAnimationFrame(() => list.recenter());
      return win;
    }

    return {
      supported,
      list,
      isOpen: () => !!win,
      window: () => win,
      open,
      close: () => win?.close(),
      setNote: note.set,

      setTrack({ title: t, artists, cover }) {
        title.textContent = t || "";
        artist.textContent = (artists || []).join(", ");
        if (cover) art.src = cover;
        art.hidden = !cover;
      },

      setTheme({ bg, tint }) {
        root.style.setProperty("--sgl-bg", bg);
        root.style.setProperty("--sgl-tint", tint);
      },

      setAmbient(enabled) {
        ambient.hidden = !enabled;
      },

      // result: the lookup result for the playing song (or null while it loads).
      render({ result, loading, breakDots, extrasOff }) {
        const found = result?.status === "found";
        list.render(found ? result : null, { breakDots });
        status.textContent =
          loading || !result ? "Loading lyrics…" : found ? "" : "No lyrics found for this song.";
        status.hidden = !status.textContent;
        extras.hidden = loading || !result || found || !extrasOff;
        if (win) win.requestAnimationFrame(() => list.recenter());
      },

      // Spotify's own lines, when we have nothing better: the highlight follows Spotify's
      // (list.setActive). There's no timing, so no karaoke fill, and a click presses the same
      // line in Spotify's lyrics, which jumps the song there.
      showSpotifyLines(texts, onPress) {
        const lines = texts.map((text, i) => ({ text: text === "♪" ? "" : text, onPress: () => onPress(i) }));
        list.render({ synced: true, lines }, { breakDots: false });
        status.hidden = true;
      },

      setStatus(text) {
        status.textContent = text;
        status.hidden = false;
      },

      // Mirror Spotify's play/pause button.
      syncControls() {
        const playing = spotify.isPlaying();
        play.setIcon(playing ? "pause" : "play", playing ? "Pause" : "Play");
      },
    };
  };
})();
