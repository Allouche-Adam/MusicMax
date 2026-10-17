// Main loop. Every half second: which song is playing, does Spotify have lyrics for it,
// and if not, fetch ours and show them through Spotify's own (disabled) lyrics controls:
// the mic button, the expanded view's lyrics tab, and a card in the Now Playing sidebar.

(() => {
  const SGL = globalThis.SGL;
  const { spotify, sync, log, guard } = SGL;

  const POLL_MS = 500;
  const SYNC_MS = 100;
  const SETTLE_MS = 1200; // let Spotify update its mic button after a track change
  const RETRY_MS = [5000, 30000, 120000]; // after a failed lookup
  const DEFAULT_THEME = { bg: "rgb(53, 53, 53)", tint: "rgb(200, 200, 200)" };
  const html = document.documentElement;

  // { id, title, artists, cover, duration, since, missing, loading, result, color, attempts, retryAt }
  let current = null;
  let lastPath = location.pathname;
  const clock = sync.createClock();

  const view = SGL.createView({ onClose: () => closeView(), onSeek: seek, onWrongLyrics: openPicker });
  const card = SGL.createCard({
    onOpenView: () => openView(),
    onFullscreen: () => {
      openView({ overlay: true });
      view.toggleFullscreen();
    },
    onSeek: seek,
  });
  const picker = SGL.createPicker({ mount: view.root, onSearch, onChoose, onReset });
  const ambient = SGL.createAmbient();

  // Ambient light on/off (popup). On by default.
  let ambientOn = true;
  const applyAmbientSetting = (settings) => {
    ambientOn = settings?.ambient !== false;
    ambient.setEnabled(ambientOn);
    view.setAmbient({ enabled: ambientOn, cover: current?.cover });
  };
  chrome.storage.local.get("settings").then((r) => applyAmbientSetting(r.settings), () => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) applyAmbientSetting(changes.settings.newValue);
  });

  const hasLyrics = () => !!current?.missing && current.result?.status === "found";
  const trackMsg = (t) => ({ title: t.title, artists: t.artists, duration: t.duration, cover: t.cover });
  const label = (t) => `"${t.artists.join(", ")} - ${t.title}"`;

  function applyTheme(theme) {
    const { bg, tint } = theme || DEFAULT_THEME;
    for (const node of [view.root, card.root]) {
      node.style.setProperty("--sgl-bg", bg);
      node.style.setProperty("--sgl-tint", tint);
    }
  }
  applyTheme(null);

  function render() {
    const result = current?.result;
    view.render({ title: current?.title, result, loading: current?.loading });
    view.setAmbient({ enabled: ambientOn, cover: current?.cover });
    card.list.render(result?.status === "found" ? result : null);
    syncNow();
  }

  // ---------- view ----------

  function openView({ overlay = false } = {}) {
    if (!hasLyrics()) return;
    const container = overlay ? null : spotify.expandedContainer();
    if (container && !html.classList.contains("sgl-tab-open")) {
      // Unchecked tabs use Spotify's tint color; reuse it for the tab we "uncheck".
      html.style.setProperty("--sgl-tab-off", getComputedStyle(spotify.lyricsTab()).color);
    }
    view.open(container);
    html.classList.toggle("sgl-tab-open", !!container);
    html.classList.add("sgl-view-open");
    syncNow();
  }

  function closeView() {
    picker.close();
    view.close();
    html.classList.remove("sgl-view-open", "sgl-tab-open");
  }

  function seek(t) {
    if (t == null || !spotify.seekTo(t)) return;
    clock.jump(t);
    syncNow();
  }

  // ---------- following the song ----------

  let pulsedLine = -1;

  function syncNow() {
    const r = current?.result;
    if (r?.status !== "found" || !r.synced) return;
    clock.update(spotify.positionText());
    const idx = sync.activeIndex(r.lines, clock.position() + sync.LEAD);
    if (view.isOpen()) view.list.setActive(idx);
    if (card.isPlaced()) card.list.setActive(idx);

    // A new line is being sung: pulse the ambient light (not for instrumental breaks).
    if (idx !== pulsedLine) {
      const fresh = idx > pulsedLine && idx - pulsedLine <= 2; // not after a seek
      pulsedLine = idx;
      if (fresh && hasLyrics() && ambientOn && r.lines[idx]?.text) {
        ambient.pulse();
        if (view.isOpen()) view.pulse();
      }
    }
  }

  // ---------- "Wrong lyrics?" ----------

  // The song the picker was opened for. Searches and choices apply to it, even if the
  // next song starts meanwhile (picking must never save lyrics under the wrong song).
  let pickerTrack = null;

  function openPicker() {
    if (!current) return;
    pickerTrack = current;
    const title = current.title.replace(/\s*[(\[][^)\]]*[)\]]/g, "").replace(/\s+-\s+.*$/, "");
    picker.open({ query: `${current.artists[0]} ${title}`, manual: !!current.result?.manual });
  }

  async function onSearch(query) {
    if (!pickerTrack) return { error: "no song" };
    return SGL.send({ type: "search", query, track: trackMsg(pickerTrack) });
  }

  async function onChoose(candidate) {
    const track = pickerTrack;
    if (!track) return { error: "the song changed" };
    const res = await SGL.send({ type: "choose", track: trackMsg(track), candidate });
    if (res?.result?.status === "found" && track === current) {
      track.result = res.result;
      if (res.color) track.color = res.color;
      applyTheme(track.color);
      render();
      log.info("choose", `${label(track)} → ${candidate.source} "${candidate.artist} - ${candidate.title}"`, undefined, { forward: false });
    }
    return res;
  }

  async function onReset() {
    const track = pickerTrack;
    if (!track) return { error: "the song changed" };
    const res = await SGL.send({ type: "reset", track: trackMsg(track) });
    if (track === current && !res?.error) {
      track.result = res.result;
      track.color = res.color;
      applyTheme(track.color);
      render();
    }
    return res;
  }

  // ---------- loading ----------

  async function load(track) {
    track.loading = true;
    track.attempts++;
    if (track === current) render();
    const res = await SGL.send({ type: "lookup", track: trackMsg(track) });
    track.loading = false;

    if (res.error) {
      track.result = { status: "error", error: res.error };
      log.warn("lookup", `${label(track)}: ${res.error}`);
      if (!res.invalidated) track.retryAt = Date.now() + (RETRY_MS[track.attempts - 1] ?? Infinity);
    } else {
      track.result = res.result;
      track.color = res.color;
      if (res.result.status === "error") track.retryAt = Date.now() + (RETRY_MS[track.attempts - 1] ?? Infinity);
      const r = res.result;
      const what = r.status === "found" ? `${r.source}${r.synced ? " synced" : ""}, ${r.lines.length} lines` : r.status === "error" ? `error: ${r.error}` : "not found";
      // Console only: the background already logged this lookup.
      log.info("lookup", `${label(track)} → ${what}${res.cached ? " (saved)" : ""}`, res.trace, { forward: false });
    }

    if (track === current) {
      applyTheme(track.color);
      render();
      tick();
    }
  }

  // ---------- main loop ----------

  function onTrackChange(t) {
    current = { ...t, since: Date.now(), missing: false, loading: false, result: null, color: null, attempts: 0, retryAt: null, duration: null };
    card.collapse();
    card.remove();
    picker.close();
    pickerTrack = null;
    pulsedLine = -1;
    html.classList.remove("sgl-has-lyrics");
    // Spotify has lyrics for the new song: don't leave our view up while we settle.
    const mic = spotify.micButton();
    if (view.isOpen() && mic && !mic.disabled) closeView();
    render();
    log.debug("track", `now playing ${label(t)}`);
  }

  function tick() {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      if (view.isOpen() && !view.isEmbedded()) closeView(); // user navigated somewhere in Spotify
    }

    const t = spotify.readTrack();
    if (!t) return;
    if (t.id !== current?.id) onTrackChange(t);
    if (Date.now() - current.since < SETTLE_MS) return;

    current.missing = !!spotify.micButton()?.disabled;
    if (current.missing) {
      current.duration ??= spotify.duration();
      const due = !current.result || (current.result.status === "error" && Date.now() >= (current.retryAt ?? Infinity));
      if (due && !current.loading) load(current);
    }

    const has = hasLyrics();
    html.classList.toggle("sgl-has-lyrics", has);
    card.place(has ? spotify.sidebarColumn() : null);

    // Mark the expanded view's lyrics tab so CSS can make it look enabled.
    const tab = spotify.lyricsTab();
    if (tab) {
      if (tab.disabled && has) tab.dataset.sglTab = "";
      else delete tab.dataset.sglTab;
    }

    if (view.isOpen()) {
      const container = spotify.expandedContainer();
      if (!(current.missing && (current.loading || has))) closeView();
      else if (view.isEmbedded() && !container) closeView(); // expanded view minimized
      else if (!view.isEmbedded() && container && has) openView(); // expanded view opened: move inside it
      else view.place();
    }
  }

  // ---------- events ----------

  const hit = (e, node) => {
    if (!node) return false;
    const r = node.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  };

  // Spotify keeps the mic button and the lyrics tab `disabled` when it has no lyrics. We
  // never touch them (React owns them); CSS makes them look enabled. Chrome never fires
  // `click` on a disabled button, but it does fire `pointerup`, so that is our "click".
  addEventListener(
    "pointerup",
    guard("click", (e) => {
      if (e.button !== 0 || !hasLyrics()) return;
      const mic = spotify.micButton();
      const tab = spotify.lyricsTab();
      const onMic = mic?.disabled && hit(e, mic);
      const onTab = tab?.disabled && hit(e, tab);
      if (!onMic && !onTab) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (onTab) openView(); // a tab only selects; clicking it again keeps lyrics shown
      else if (view.isOpen()) closeView();
      else openView();
    }),
    true
  );

  // Another tab (artwork, Canvas...) chosen while our lyrics are in the expanded view.
  addEventListener(
    "click",
    guard("click", (e) => {
      if (view.isOpen() && view.isEmbedded() && e.target.closest?.(spotify.SEL.tabs)) closeView();
    }),
    true
  );

  addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !view.isOpen() || document.fullscreenElement || picker.isOpen()) return;
    if (e.target.closest?.("input, textarea, [contenteditable]")) return;
    closeView();
  });

  addEventListener("resize", () => {
    view.place();
    view.list.recenter();
    card.list.recenter();
  });

  setInterval(guard("tick", tick), POLL_MS);
  setInterval(guard("ambient", ambient.update), POLL_MS);
  setInterval(guard("sync", syncNow), SYNC_MS);
  setTimeout(guard("startup", spotify.checkSelectors), 6000);
  log.info("content", `v${chrome.runtime.getManifest().version} running`, undefined, { forward: false });
  guard("tick", tick)();
})();
