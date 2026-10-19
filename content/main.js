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
    // Permissions can only be granted from the popup: open it on that switch.
    onAllowExtras: () => SGL.send({ type: "openPopup", focus: "extraSources" }),
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
  const sparkles = SGL.createSparkles();
  const share = SGL.createShare({
    getInfo: () =>
      current && { title: current.title, artists: current.artists, cover: current.cover, theme: current.color, source: current.result?.source },
  });

  // Translation, romanization and the karaoke fill on Spotify's own lyrics.
  const spLyrics = SGL.createSpotifyLyrics({
    getExtras: async (texts) => {
      const track = current;
      return track && (await computeExtras(track, texts, { kind: "spotify", stale: () => track !== current }));
    },
    // LRCLIB's synced lyrics for the song give each Spotify line its timing.
    getTiming: () => (current?.result?.status === "found" && current.result.synced ? current.result.lines : null),
    onLine: (lineEl) => sparkles.burst(lineEl),
  });

  const found = () => current?.result?.status === "found";
  // Lyrics to show (sidebar card, synced effects).
  const on = () => S.enabled !== false; // the popup's "Turn off MusicMax" button
  const hasLyrics = () => on() && !!current?.missing && found();
  // The mic / tab also work when nothing was found, to offer a manual search.
  const canOpen = () => on() && !!current?.missing && (found() || current.result?.status === "notFound");
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
    ambient.setOptions({ glows: on() && S.ambient, spotifyLyrics: on() && S.ambientSpotify && !S.alwaysOurs, pulse: S.pulse, strength: S.glow / 100 });
    sparkles.setOptions({ stars: on() && S.secretStars, cursor: on() && S.secretCursor });
    if (!on()) shutDown();
    view.setAmbient({ enabled: S.background === "cover", cover: current?.cover });
    if (prev === next) return;
    if (prev.breakDots !== S.breakDots) render();
    else if (["translate", "translateTo", "romanize"].some((k) => prev[k] !== S[k])) updateExtras();
    if (prev.extraSources !== S.extraSources && current?.lang === "ja") {
      current.romaji = undefined;
      updateExtras();
    }
    // Genius & NetEase just allowed: look again for the song LRCLIB didn't have.
    if (!prev.extraSources && S.extraSources && current?.result?.status === "notFound" && !current.loading) {
      resetTrackData(current);
      load(current);
    } else if (prev.extraSources !== S.extraSources) render();
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
    view.render({ title: current?.title, result, loading: current?.loading, breakDots: S.breakDots, extrasOff: !S.extraSources });
    view.setAmbient({ enabled: S.background === "cover", cover: current?.cover });
    card.list.render(found() ? result : null, { breakDots: S.breakDots });
    updateExtras();
    syncNow(true);
  }

  // Romanization and translation, for our lyrics (`timed`: our lines with timing) or for
  // Spotify's own (plain texts). Returns { roma, trans, note }, arrays aligned with texts.
  async function computeExtras(track, texts, { timed = null, kind = "ours", stale = () => false, onNote = () => {} } = {}) {
    const langKey = kind === "ours" ? "lang" : "spLang";
    if (track[langKey] === undefined) track[langKey] = SGL.lang.detect(texts.filter(Boolean));
    const lang = track[langKey];
    let roma = null;
    let trans = null;
    let note = null;

    if (S.romanize) {
      if (lang === "ja") roma = timed ? await romajiFor(track, timed) : await romajiByText(track, texts);
      else if (SGL.lang.ROMANIZABLE.has(lang)) roma = texts.map((t) => (t ? SGL.lang.romanize(t) : null));
      if (!roma && lang === "ja") {
        note = { text: S.extraSources ? "No romanization found for this song." : "Japanese romanization needs “Also search Genius & NetEase” in settings." };
      }
      if (lang === "zh") note = { text: "Romanization isn't available for Chinese yet." };
      if (stale()) return null;
    }

    if (S.translate) {
      const to = S.translateTo;
      if (!lang) note = { text: "Couldn't tell which language this song is in, so it can't be translated." };
      else if (lang !== to) {
        const key = `${kind}:${lang}>${to}`;
        track.trans ??= {};
        if (track.trans[key]) trans = track.trans[key];
        else {
          const status = await SGL.lang.translatorStatus(lang, to);
          if (stale()) return null;
          const ready = status === "available" || ((status === "downloadable" || status === "downloading") && navigator.userActivation?.isActive);
          if (ready) {
            onNote({ text: `Translating from ${langName(lang)}…` });
            try {
              trans = await SGL.lang.translateLines(texts, lang, to, (p) => {
                if (!stale()) onNote({ text: `Downloading Chrome's ${langName(lang)} translator… ${Math.round(p * 100)}%` });
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
            };
          } else if (status === "unsupported") note = { text: SGL.firefox ? "Firefox has no built-in translator that extensions can use." : "This version of Chrome has no built-in translator." };
          else note = { text: `Chrome can't translate ${langName(lang)} to ${langName(to)}.` };
        }
      }
    }
    return stale() ? null : { roma, trans, note };
  }

  // Our view and sidebar card.
  let extrasToken = 0;
  async function updateExtras() {
    const token = ++extrasToken;
    const track = current;
    const stale = () => token !== extrasToken || track !== current;
    view.setNote(null);
    if (!track || !hasLyrics() || (!S.romanize && !S.translate)) {
      view.list.setExtras({});
      card.list.setExtras({});
      return;
    }
    const data = view.list.data;
    const res = await computeExtras(
      track,
      data.map((l) => l.text),
      { timed: data, stale, onNote: (n) => view.setNote(n) }
    );
    if (!res || stale()) return;
    view.list.setExtras(res);
    card.list.setExtras(res);
    if (res.note?.button) res.note.onClick = () => updateExtras(); // a click: Chrome allows the download
    view.setNote(res.note);
  }

  async function loadRomaji(track) {
    if (track.romaji === undefined) {
      const res = await SGL.send({ type: "romaji", track: trackMsg(track) });
      track.romaji = res?.lines || null;
    }
    return track.romaji;
  }

  // NetEase romaji, matched to our lines by time (synced) or by order (plain).
  async function romajiFor(track, data) {
    const roma = await loadRomaji(track);
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

  // NetEase romaji matched to Spotify's lines by their Japanese text (Spotify has no timing).
  async function romajiByText(track, texts) {
    const roma = await loadRomaji(track);
    if (!roma) return null;
    const key = (s) => String(s || "").replace(/[\s\p{P}\p{S}]+/gu, "").toLowerCase();
    const byText = new Map(roma.filter((r) => r.orig).map((r) => [key(r.orig), r.text]));
    const out = texts.map((t) => (t ? byText.get(key(t)) || null : null));
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

  // Spotify's own lyrics (songs it has lyrics for) can be shared too: right-click a line
  // in its lyrics page, expanded view or sidebar card. Our own lines handle this above.
  const SPOTIFY_LINE = '[data-testid="lyrics-line"]';
  addEventListener(
    "contextmenu",
    guard("share", (e) => {
      const line = e.target.closest?.(SPOTIFY_LINE);
      if (!on() || !line || line.closest(".sgl-view, .sgl-card") || !current) return;
      const main = line.firstElementChild && !line.firstElementChild.classList.contains("sgl-sub") ? line.firstElementChild : line;
      const text = main.textContent.trim();
      const sub = line.querySelector(":scope > .sgl-trans, :scope > .sgl-roma")?.textContent;
      if (!text || text === "♪") return;
      e.preventDefault();
      // Spotify's own lyrics color as the card's background (its line colors can be dark).
      const bg = getComputedStyle(line).getPropertyValue("--lyrics-color-background").trim();
      share.open({ text }, e, sub || null, { source: "Spotify", theme: bg ? { bg } : current.color });
    }),
    true,
  );

  // ---------- following the song ----------

  let pulsedLine = -1;
  let wasPaused = false;

  function syncNow(force = false) {
    const jumped = clock.update(spotify.positionText());
    const pos = clock.position() + sync.LEAD;
    const paused = clock.isStalled();
    if (spLyrics.isActive()) spLyrics.sync(S, { pos, paused, jumped: jumped || force });
    const r = current?.result;
    if (r?.status !== "found" || !r.synced) return;
    const data = view.list.data;
    const idx = sync.activeIndex(data, pos);
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
      if (fresh && hasLyrics() && data[idx]?.text) {
        if (ambient.pulseEnabled()) {
          ambient.pulse();
          if (view.isOpen() && S.background === "cover") view.pulse();
        }
        sparkles.burst(lists()[0]?.lines[idx]); // nothing unless the secret stars are on
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
    const res = await SGL.send({ type: "reset", track: trackMsg(track) });
    adopt(track, res);
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
      spLyrics.refresh(clock.position() + sync.LEAD);
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
    if (view.isOpen() && mic && !mic.disabled && !S.alwaysOurs) closeView();
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

    const mic = spotify.micButton();
    const spotifyHas = !!mic && !mic.disabled;
    // Look the song up when we'll show it, and when the karaoke fill on Spotify's own
    // lyrics needs LRCLIB's timing.
    if (!spotifyHas || S.alwaysOurs || S.karaoke) {
      current.duration ??= spotify.duration();
      const due = !current.result || (current.result.status === "error" && Date.now() >= (current.retryAt ?? Infinity));
      if (due && !current.loading) load(current);
    }
    // "missing" = we show the lyrics. Spotify's own stay when we found nothing.
    current.missing = !spotifyHas || (S.alwaysOurs && found());
    current.override = spotifyHas && current.missing;
    html.classList.toggle("sgl-override", current.override);
    // We just started showing this song (e.g. "Always use MusicMax lyrics" kicked in):
    // its translation / romanization weren't computed while Spotify showed it.
    if (hasLyrics() !== !!current.shown) {
      current.shown = hasLyrics();
      if (current.shown) updateExtras();
    }

    html.classList.toggle("sgl-has-lyrics", canOpen());
    card.place(hasLyrics() ? spotify.sidebarColumn() : null);

    // Mark the expanded view's lyrics tab so CSS can make it look enabled.
    const tab = spotify.lyricsTab();
    if (tab) {
      if ((tab.disabled || current.override) && canOpen()) tab.dataset.sglTab = "";
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
      const ours = (b) => b && (b.disabled || current.override); // controls we answer for
      const onMic = ours(mic) && hit(e, mic);
      const onTab = ours(tab) && hit(e, tab);
      if (!onMic && !onTab) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      toggleFrom(onTab);
    }),
    true
  );

  function toggleFrom(tab) {
    if (tab) openView(); // a tab only selects; clicking it again keeps lyrics shown
    else if (view.isOpen()) closeView();
    else openView();
  }

  // "Always use MusicMax lyrics": Spotify's mic and lyrics tab are enabled, so their own
  // click must not also open Spotify's lyrics. A keyboard press (Enter/Space) arrives as
  // a click with no pointer: handle it here.
  addEventListener(
    "click",
    guard("click", (e) => {
      if (!current?.override || !canOpen()) return;
      const mic = spotify.micButton();
      const tab = spotify.lyricsTab();
      const onMic = mic?.contains(e.target);
      const onTab = tab?.contains(e.target);
      if (!onMic && !onTab) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.detail === 0) toggleFrom(onTab);
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
      if (!on() || !S.shortcuts || e.defaultPrevented || e.repeat || e.isComposing) return;
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

  // MusicMax turned off in the popup: put Spotify back exactly as it was.
  function shutDown() {
    closeView();
    card.remove();
    spLyrics.reset();
    html.classList.remove("sgl-has-lyrics", "sgl-override", "sgl-view-open", "sgl-tab-open");
    document.querySelectorAll("[data-sgl-tab]").forEach((t) => delete t.dataset.sglTab);
  }

  setInterval(guard("tick", () => on() && tick()), POLL_MS);
  setInterval(guard("sync", () => on() && syncNow()), SYNC_MS);
  setInterval(guard("ambient", () => on() && ambient.update(current?.cover)), POLL_MS);
  setInterval(guard("spotify-lyrics", () => on() && spLyrics.update(S, current?.id)), POLL_MS);
  setTimeout(guard("startup", spotify.checkSelectors), 6000);
  log.info("content", `v${chrome.runtime.getManifest().version} running`, undefined, { forward: false });
  if (on()) guard("tick", tick)();
})();
