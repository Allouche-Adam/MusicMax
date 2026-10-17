// Main loop. Every half second: which song is playing, does Spotify have lyrics for it,
// and if not, fetch ours and show them through Spotify's own (disabled) lyrics controls:
// the mic button, the expanded view's lyrics tab, and a card in the Now Playing sidebar.

(() => {
  const SGL = globalThis.SGL;
  const { spotify, sync, log, guard, settings } = SGL;

  const POLL_MS = 500;
  const SYNC_MS = 100;
  const SETTLE_MS = 1200; // let Spotify update its mic button after a track change
  const RETRY_MS = [5000, 30000, 120000]; // after a failed lookup
  const SCALES = { s: 0.8, m: 1, l: 1.2, xl: 1.4 };
  const html = document.documentElement;
  const langName = (code) => {
    try {
      return new Intl.DisplayNames(["en"], { type: "language" }).of(code);
    } catch {
      return code;
    }
  };

  // { id, title, artists, cover, duration, since, missing, loading, result, color,
  //   attempts, retryAt, lang, trans, romaji }
  let current = null;
  let lastPath = location.pathname;
  let S = settings.get();
  const clock = sync.createClock();

  const view = SGL.createView({
    onClose: () => closeView(),
    onSeek: seek,
    onWrongLyrics: () => openPicker(),
    onShare: (ln, e) => shareLine(ln, e),
    onSearchManually: () => openPicker(),
  });
  const card = SGL.createCard({
    onOpenView: () => openView(),
    onFullscreen: () => {
      openView({ overlay: true });
      view.toggleFullscreen();
    },
    onSettings: () => {
      openView();
      view.toggleSettings(true);
    },
    onSeek: seek,
    onShare: (ln, e) => shareLine(ln, e),
  });
  const picker = SGL.createPicker({ mount: view.root, onSearch, onChoose, onReset });
  const ambient = SGL.createAmbient();
  const share = SGL.createShare({
    getInfo: () =>
      current && { title: current.title, artists: current.artists, cover: current.cover, theme: current.color, source: current.result?.source },
  });

  const found = () => current?.result?.status === "found";
  // Lyrics to show (sidebar card, synced effects).
  const hasLyrics = () => !!current?.missing && found();
  // The mic / tab also work when nothing was found, to offer a manual search.
  const canOpen = () => !!current?.missing && (found() || current.result?.status === "notFound");
  const trackMsg = (t) => ({ title: t.title, artists: t.artists, duration: t.duration, cover: t.cover });
  const label = (t) => `"${t.artists.join(", ")} - ${t.title}"`;
  const lists = () => [view.isOpen() && view.list, card.isPlaced() && card.list].filter(Boolean);

  // ---------- theme & settings ----------

  function applyTheme(theme) {
    const bg = theme?.bg || "rgb(53, 53, 53)";
    const tint = theme?.tint || "rgb(200, 200, 200)";
    for (const node of [view.root, card.root]) {
      node.style.setProperty("--sgl-bg", bg);
      node.style.setProperty("--sgl-tint", tint);
    }
  }
  applyTheme(null);

  function applySettings(next) {
    const prev = S;
    S = next;
    const opts = { karaoke: S.karaoke, align: S.align, scale: SCALES[S.textSize] || 1 };
    view.list.setOptions(opts);
    card.list.setOptions(opts);
    ambient.setOptions({ glows: S.ambient, spotifyLyrics: S.ambientSpotify, pulse: S.pulse, strength: S.glow / 100 });
    view.setAmbient({ enabled: S.background === "cover", cover: current?.cover });
    if (prev === next) return;
    if (prev.breakDots !== S.breakDots) render();
    else if (["translate", "translateTo", "romanize"].some((k) => prev[k] !== S[k])) updateExtras();
    if (prev.source !== S.source && current) {
      log.info("settings", `preferred source → ${S.source}`, undefined, { forward: false });
      resetTrackData(current);
      current.attempts = 0;
      render(); // the main loop looks the song up again
    }
  }
  settings.onChange(guard("settings", applySettings));
  applySettings(S);

  function resetTrackData(track) {
    track.result = null;
    track.lang = undefined;
    track.trans = {};
    track.romaji = undefined;
  }

  // ---------- rendering ----------

  function render() {
    const result = current?.result;
    view.render({ title: current?.title, result, loading: current?.loading, breakDots: S.breakDots });
    view.setAmbient({ enabled: S.background === "cover", cover: current?.cover });
    card.list.render(found() ? result : null, { breakDots: S.breakDots });
    updateExtras();
    syncNow(true);
  }

  // Romanization and translation under each line (both optional, both async).
  let extrasToken = 0;
  async function updateExtras() {
    const token = ++extrasToken;
    const track = current;
    const stale = () => token !== extrasToken || track !== current;
    view.setNote(null);
    if (!track || !found() || (!S.romanize && !S.translate)) {
      view.list.setExtras({});
      card.list.setExtras({});
      return;
    }
    const data = view.list.data;
    const texts = data.map((l) => l.text);
    if (track.lang === undefined) track.lang = SGL.lang.detect(texts.filter(Boolean));
    const lang = track.lang;
    let roma = null;
    let trans = null;
    let note = null;

    if (S.romanize) {
      if (lang === "ja") roma = await romajiFor(track, data);
      else if (SGL.lang.ROMANIZABLE.has(lang)) roma = texts.map((t) => (t ? SGL.lang.romanize(t) : null));
      if (!roma && lang === "ja") note = { text: "No romanization found for this song." };
      if (lang === "zh") note = { text: "Romanization isn't available for Chinese yet." };
      if (stale()) return;
    }

    if (S.translate) {
      const to = S.translateTo;
      if (!lang) note = { text: "Couldn't tell which language this song is in, so it can't be translated." };
      else if (lang !== to) {
        const key = `${lang}>${to}`;
        track.trans ??= {};
        if (track.trans[key]) trans = track.trans[key];
        else {
          const status = await SGL.lang.translatorStatus(lang, to);
          if (stale()) return;
          const ready = status === "available" || ((status === "downloadable" || status === "downloading") && navigator.userActivation?.isActive);
          if (ready) {
            view.setNote({ text: `Translating from ${langName(lang)}…` });
            try {
              trans = await SGL.lang.translateLines(texts, lang, to, (p) => {
                if (!stale()) view.setNote({ text: `Downloading Chrome's ${langName(lang)} translator… ${Math.round(p * 100)}%` });
              });
              track.trans[key] = trans;
            } catch (err) {
              note = { text: `Translation failed: ${err.message}` };
              log.warn("translate", `${lang}→${to}: ${err.message}`);
            }
          } else if (status === "downloadable" || status === "downloading") {
            note = {
              text: `Translating from ${langName(lang)} needs a one-time download by Chrome (it then works offline).`,
              button: "Download and translate",
              onClick: () => updateExtras(), // a click: Chrome allows the download
            };
          } else if (status === "unsupported") note = { text: "This version of Chrome has no built-in translator." };
          else note = { text: `Chrome can't translate ${langName(lang)} to ${langName(to)}.` };
        }
      }
    }

    if (stale()) return;
    view.list.setExtras({ roma, trans });
    card.list.setExtras({ roma, trans });
    view.setNote(note);
  }

  // NetEase romaji, matched to our lines by time (synced) or by order (plain).
  async function romajiFor(track, data) {
    if (track.romaji === undefined) {
      const res = await SGL.send({ type: "romaji", track: trackMsg(track) });
      track.romaji = res?.lines || null;
    }
    const roma = track.romaji;
    if (!roma) return null;
    const out = data.map(() => null);
    const textIdx = data.map((l, i) => (l.text ? i : -1)).filter((i) => i >= 0);
    if (track.result?.synced) {
      for (const i of textIdx) {
        let best = null;
        let bestDiff = 0.8;
        for (const r of roma) {
          const d = Math.abs(r.t - data[i].t);
          if (d < bestDiff) {
            bestDiff = d;
            best = r;
          }
        }
        if (best) out[i] = best.text;
      }
    } else if (roma.length === textIdx.length) textIdx.forEach((i, k) => (out[i] = roma[k].text));
    else return null;
    return out.some(Boolean) ? out : null;
  }

  // ---------- view ----------

  function openView({ overlay = false } = {}) {
    if (!canOpen()) return;
    const container = overlay ? null : spotify.expandedContainer();
    if (container && !html.classList.contains("sgl-tab-open")) {
      // Unchecked tabs use Spotify's tint color; reuse it for the tab we "uncheck".
      html.style.setProperty("--sgl-tab-off", getComputedStyle(spotify.lyricsTab()).color);
    }
    view.open(container);
    html.classList.toggle("sgl-tab-open", !!container);
    html.classList.add("sgl-view-open");
    syncNow(true);
  }

  function closeView() {
    picker.close();
    share.close();
    view.close();
    html.classList.remove("sgl-view-open", "sgl-tab-open");
  }

  function seek(t) {
    if (t == null || !spotify.seekTo(t)) return;
    clock.jump(t);
    syncNow(true);
  }

  function shareLine(ln, e) {
    const i = view.list.data.indexOf(ln);
    const line = (i >= 0 ? view.list.lines[i] : null) || e.target.closest(".sgl-line");
    const sub = line?.querySelector(".sgl-trans")?.textContent || line?.querySelector(".sgl-roma")?.textContent;
    share.open(ln, e, sub);
  }

  // ---------- following the song ----------

  let pulsedLine = -1;
  let wasPaused = false;

  function syncNow(force = false) {
    const r = current?.result;
    if (r?.status !== "found" || !r.synced) return;
    const jumped = clock.update(spotify.positionText());
    const pos = clock.position() + sync.LEAD;
    const data = view.list.data;
    const idx = sync.activeIndex(data, pos);
    const paused = clock.isStalled();
    for (const list of lists()) {
      list.setPaused(paused);
      list.setActive(idx, pos);
      if (force || jumped || (wasPaused && !paused)) list.resync(pos);
    }
    wasPaused = paused;

    // A new line is being sung: pulse the ambient light (not for instrumental breaks).
    if (idx !== pulsedLine) {
      const fresh = idx > pulsedLine && idx - pulsedLine <= 2; // not after a seek
      pulsedLine = idx;
      if (fresh && hasLyrics() && data[idx]?.text && ambient.pulseEnabled()) {
        ambient.pulse();
        if (view.isOpen() && S.background === "cover") view.pulse();
      }
    }
  }

  // ---------- "Wrong lyrics?" / manual search ----------

  // The song the picker was opened for. Searches and choices apply to it, even if the
  // next song starts meanwhile (picking must never save lyrics under the wrong song).
  let pickerTrack = null;

  function openPicker() {
    if (!current) return;
    if (!view.isOpen()) openView();
    pickerTrack = current;
    view.toggleSettings(false);
    const title = current.title.replace(/\s*[(\[][^)\]]*[)\]]/g, "").replace(/\s+-\s+.*$/, "");
    picker.open({ query: `${current.artists[0]} ${title}`, manual: !!current.result?.manual });
  }

  async function onSearch(query) {
    if (!pickerTrack) return { error: "no song" };
    return SGL.send({ type: "search", query, track: trackMsg(pickerTrack) });
  }

  function adopt(track, res) {
    if (track !== current || res?.error || !res?.result) return;
    resetTrackData(track);
    track.result = res.result;
    if (res.color) track.color = res.color;
    applyTheme(track.color);
    render();
  }

  async function onChoose(candidate) {
    const track = pickerTrack;
    if (!track) return { error: "the song changed" };
    const res = await SGL.send({ type: "choose", track: trackMsg(track), candidate });
    if (res?.result?.status === "found") {
      adopt(track, res);
      log.info("choose", `${label(track)} → ${candidate.source} "${candidate.artist} - ${candidate.title}"`, undefined, { forward: false });
    }
    return res;
  }

  async function onReset() {
    const track = pickerTrack;
    if (!track) return { error: "the song changed" };
    const res = await SGL.send({ type: "reset", track: trackMsg(track), prefer: S.source });
    adopt(track, res);
    return res;
  }

  // ---------- loading ----------

  async function load(track) {
    track.loading = true;
    track.attempts++;
    if (track === current) render();
    const res = await SGL.send({ type: "lookup", track: trackMsg(track), prefer: S.source });
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
    current = { ...t, since: Date.now(), missing: false, loading: false, result: null, color: null, attempts: 0, retryAt: null, duration: null, trans: {} };
    card.collapse();
    card.remove();
    picker.close();
    share.close();
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

    html.classList.toggle("sgl-has-lyrics", canOpen());
    card.place(hasLyrics() ? spotify.sidebarColumn() : null);

    // Mark the expanded view's lyrics tab so CSS can make it look enabled.
    const tab = spotify.lyricsTab();
    if (tab) {
      if (tab.disabled && canOpen()) tab.dataset.sglTab = "";
      else delete tab.dataset.sglTab;
    }

    if (view.isOpen()) {
      const container = spotify.expandedContainer();
      if (!(current.missing && (current.loading || canOpen()))) closeView();
      else if (view.isEmbedded() && !container) closeView(); // expanded view minimized
      else if (!view.isEmbedded() && container && canOpen()) openView(); // expanded view opened: move inside it
      else view.place();
    }
  }

  // ---------- clicks on Spotify's disabled controls ----------

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
      if (e.button !== 0 || !canOpen()) return;
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
      if (view.isOpen() && view.isEmbedded() && spotify.isSpotifyTab(e.target)) closeView();
    }),
    true
  );

  // ---------- keyboard ----------

  // Anything you type into (Spotify's search box, our picker, settings...) is left alone.
  const TYPING =
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"], [role="combobox"], .sgl-picker, .sgl-settings, .sgl-menu';
  function isTyping(e) {
    const target = e.composedPath?.()[0] || e.target;
    const active = document.activeElement;
    return !!(target?.closest?.(TYPING) || active?.closest?.(TYPING) || active?.isContentEditable);
  }

  // Shortcuts: L = lyrics (ours, or Spotify's own when it has them), F = full screen.
  // Plain keys only (no Ctrl/Alt/Cmd), never while typing, never on key repeat.
  addEventListener(
    "keydown",
    guard("keys", (e) => {
      if (!S.shortcuts || e.defaultPrevented || e.repeat || e.isComposing) return;
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return;
      const key = e.key.toLowerCase();
      if (key === "l") {
        if (canOpen()) {
          if (view.isOpen()) closeView();
          else openView();
        } else {
          const mic = spotify.micButton();
          if (!mic || mic.disabled) return;
          mic.click();
        }
      } else if (key === "f" && view.isOpen()) view.toggleFullscreen();
      else return;
      e.preventDefault();
      e.stopPropagation();
    }),
    true
  );

  addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented || !view.isOpen() || document.fullscreenElement) return;
    if (picker.isOpen() || view.settingsOpen() || isTyping(e)) return;
    closeView();
  });

  addEventListener("resize", () => {
    view.place();
    view.list.recenter();
    card.list.recenter();
  });

  setInterval(guard("tick", tick), POLL_MS);
  setInterval(guard("sync", syncNow), SYNC_MS);
  setInterval(guard("ambient", () => ambient.update(current?.cover)), POLL_MS);
  setTimeout(guard("startup", spotify.checkSelectors), 6000);
  log.info("content", `v${chrome.runtime.getManifest().version} running`, undefined, { forward: false });
  guard("tick", tick)();
})();
