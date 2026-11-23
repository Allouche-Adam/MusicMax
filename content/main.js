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
  const SUB_SCALES = { s: 0.8, m: 1, l: 1.3 };
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
  let mirrored = ""; // the Spotify lines the pop-out is showing
  let spotifyLight = null; // the light on Spotify's lyrics: on, off, or not set yet
  let lastPath = location.pathname;
  let S = settings.get();
  const clock = sync.createClock();
  // Permissions can only be granted from the popup: open it on the Genius & NetEase switch.
  const allowExtras = () => SGL.send({ type: "openPopup", focus: "extraSources" });

  const view = SGL.createView({
    onClose: () => closeView(),
    onSeek: seek,
    onWrongLyrics: () => openPicker(),
    onShare: (ln, e) => shareLine(ln, e),
    onSearchManually: () => openPicker(),
    onPopOut: () => popOut(),
    onAllowExtras: allowExtras,
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
  // Pop-out lyrics window. While it's open it drives the timing from its own timer: this tab's
  // timers slow down to once a second when you're in another tab or app.
  let pipTimer = 0;
  const pip = SGL.createPip({
    onSeek: seek,
    onAllowExtras: allowExtras,
    onOpen: (w) => {
      render();
      let n = 0;
      pipTimer = w.setInterval(
        guard("pip", () => {
          if (!on()) return;
          pip.syncControls();
          if (!document.hidden) return; // this tab's own timers are running normally
          if (++n % 5 === 0) tick();
          syncNow();
        }),
        SYNC_MS
      );
    },
    onClose: () => {
      pipTimer = 0;
      updateExtras();
    },
  });
  // Pop-out button in the player bar, next to Spotify's mic: there whether or not the
  // song's lyrics are ours. Spotify re-renders the bar, so it's put back when it goes.
  const barBtn = SGL.iconButton("popout", "Pop out lyrics (P)", () => (pip.isOpen() ? pip.close() : popOut()));
  barBtn.classList.add("sgl-bar-btn");
  function placeBarButton() {
    const mic = spotify.micButton();
    if (!pip.supported || !on() || !mic) return barBtn.remove();
    if (barBtn.nextElementSibling !== mic) mic.before(barBtn);
    barBtn.classList.toggle("is-on", pip.isOpen());
  }
  async function popOut() {
    if (!on() || !pip.supported) return;
    try {
      await pip.open();
    } catch (err) {
      log.warn("pip", `pop-out refused: ${err.message}`);
    }
  }
  const ambient = SGL.createAmbient();
  const sparkles = SGL.createSparkles();
  const share = SGL.createShare({
    getInfo: () =>
      current && { title: current.title, artists: current.artists, cover: current.cover, theme: current.color, source: current.result?.source },
  });

  // Translation, romanization and the karaoke fill on Spotify's own lyrics.
  const spLyrics = SGL.createSpotifyLyrics({
    getExtras: async (texts, onNote) => {
      const track = current;
      return track && (await computeExtras(track, texts, { kind: "spotify", stale: () => track !== current, onNote }));
    },
    // LRCLIB's synced lyrics for the song give each Spotify line its timing.
    getTiming: () => (current?.result?.status === "found" && current.result.synced ? current.result.lines : null),
    onLine: (lineEl) => sparkles.burst(lineEl, getComputedStyle(lineEl).getPropertyValue("--lyrics-color-background").trim()),
  });

  const found = () => current?.result?.status === "found";
  // Worth replacing Spotify's own lyrics for: timed lyrics, or the ones you picked. Plain
  // lyrics (usually from Genius) are not: Spotify's are official and usually timed.
  const beatsSpotify = () => found() && (current.result.synced || current.result.manual);
  // Full screen lyrics stay up from song to song, ours or not (closing would exit full screen).
  const fullscreen = () => view.isOpen() && view.isFullscreen();
  // "Always use MusicMax lyrics" and this song's first lookup hasn't answered yet: the song
  // counts as ours until then, so Spotify's own lyrics never flash in. Retries after a failed
  // lookup don't count: they run quietly behind Spotify's lyrics.
  const waitingForOurs = () => S.alwaysOurs && !current?.result;
  // Our view covers Spotify's lyrics: no point translating or filling them underneath.
  const covered = () => view.isOpen() && !!current?.override;
  // Lyrics to show (sidebar card, synced effects).
  const on = () => S.enabled !== false; // the popup's "Turn off MusicMax" button
  const hasLyrics = () => on() && !!current?.missing && found();
  // The mic / tab also work when nothing was found, to offer a manual search.
  const canOpen = () => on() && !!current?.missing && (found() || current.result?.status === "notFound" || waitingForOurs());
  // Always-use has nothing to show for this song, so Spotify's own lyrics stay: why, or null.
  const FALLBACK_NOTICES = {
    notFound: { text: "MusicMax has no lyrics for this song, so these are Spotify's." },
    error: { text: "MusicMax couldn't reach its lyrics right now, so these are Spotify's." },
    found: { text: "MusicMax only found lyrics without timing, so these are Spotify's." },
  };
  const fallbackNotice = () => (S.alwaysOurs && !current?.missing && FALLBACK_NOTICES[current?.result?.status]) || null;
  const trackMsg = (t) => ({ title: t.title, artists: t.artists, duration: t.duration, cover: t.cover });
  const label = (t) => `"${t.artists.join(", ")} - ${t.title}"`;
  const lists = () => [view.isOpen() && view.list, card.isPlaced() && card.list, pip.isOpen() && pip.list].filter(Boolean);

  // ---------- theme & settings ----------

  function applyTheme(theme) {
    const bg = theme?.bg || "rgb(53, 53, 53)";
    const tint = theme?.tint || "rgb(200, 200, 200)";
    for (const node of [view.root, card.root]) {
      node.style.setProperty("--sgl-bg", bg);
      node.style.setProperty("--sgl-tint", tint);
    }
    pip.setTheme({ bg, tint });
    sparkles.setColor(theme?.bg);
  }
  applyTheme(null);

  function applySettings(next) {
    const prev = S;
    S = next;
    const opts = { karaoke: S.karaoke, align: S.align, fade: S.fade, scale: SCALES[S.textSize] || 1, subScale: SUB_SCALES[S.translationSize] || 1 };
    // For Spotify's own lyrics.
    html.style.setProperty("--sgl-sub-scale", opts.subScale);
    html.style.setProperty("--sgl-text-scale", opts.scale);
    view.list.setOptions(opts);
    card.list.setOptions(opts);
    pip.list.setOptions(opts);
    pip.setAmbient(S.background === "cover");
    ambient.setOptions({ glows: on() && S.ambient, pulse: S.pulse, strength: S.glow / 100 });
    sparkles.setOptions({ stars: on() && S.secretStars, cursor: on() && S.secretCursor });
    hideSpotifyLyrics();
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

  // The light on Spotify's lyrics runs only when they're on screen: with Always-use they're
  // usually under our view (it'd cost performance for nothing), except when they're the fallback.
  function lightSpotifyLyrics() {
    const want = on() && S.ambientSpotify && (!S.alwaysOurs || !!fallbackNotice());
    if (want === spotifyLight) return;
    spotifyLight = want;
    ambient.setOptions({ spotifyLyrics: want });
  }

  // Always-use: Spotify's lyrics stay hidden unless we end up with nothing for the song. On
  // page load `current` isn't known yet: hide for a few seconds, never for good, so a change
  // on Spotify's side can't leave someone with no lyrics at all.
  function hideSpotifyLyrics() {
    lightSpotifyLyrics();
    const starting = !current && performance.now() < 8000;
    const ours = current && (waitingForOurs() || beatsSpotify());
    html.classList.toggle("sgl-hide-spotify", on() && S.alwaysOurs && (starting || !!ours));
  }

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
    if (current) pip.setTrack(current);
    pip.render({ result, loading: current?.loading, breakDots: S.breakDots, extrasOff: !S.extraSources });
    mirrored = "";
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
      const res = await translateSong(track, texts, lang, kind, stale, onNote);
      if (res === null) return null;
      trans = res.trans ?? null;
      note = res.note ?? note;
    }
    return stale() ? null : { roma, trans, note };
  }

  const TRANSLATION_FAILURES = {
    stalled: "Chrome's translator download stopped. Check your connection or VPN.",
    network: "Chrome couldn't download its translator. Check your connection or VPN.",
    blocked: "Chrome didn't allow the translator to start.",
    failed: "The translation didn't work this time.",
  };

  // Every outcome of a translation attempt says so: nothing ends in silence.
  async function translateSong(track, texts, lang, kind, stale, onNote) {
    const to = S.translateTo;
    const key = `${kind}:${lang}>${to}`;
    track.trans ??= {};
    if (track.trans[key]) return { trans: track.trans[key] };

    const status = lang && lang !== to ? await SGL.lang.translatorStatus(lang, to) : null;
    if (stale()) return null;
    // A click in the pop-out counts in the pop-out's window, not in this one.
    const clicked = [window, pip.window()].find((w) => w?.navigator.userActivation?.isActive);
    const step = SGL.lang.translationStep({ from: lang, to, status, activated: !!clicked });
    if (step === "unknown-language") return { note: { text: "Couldn't tell which language this song is in, so it can't be translated." } };
    if (step === "same-language") return { note: { text: `This song is already in ${langName(to)}.`, brief: true } };
    if (step === "no-translator") {
      return { note: { text: SGL.firefox ? "Firefox has no built-in translator that extensions can use." : "This browser has no built-in translator. Updating Chrome should add it." } };
    }
    if (step === "pair-unavailable") return { note: { text: `Chrome can't translate ${langName(lang)} to ${langName(to)}.` } };
    if (step === "needs-download") {
      return {
        note: {
          text: `Translating from ${langName(lang)} needs a one-time download by Chrome (it then works offline).`,
          button: "Download and translate",
        },
      };
    }

    onNote({ text: `Translating from ${langName(lang)}…` });
    try {
      const trans = await SGL.lang.translateLines(texts, lang, to, {
        api: clicked?.Translator,
        onProgress: (p) => {
          if (!stale()) onNote({ text: `Downloading Chrome's ${langName(lang)} translator… ${Math.round(p * 100)}%` });
        },
      });
      track.trans[key] = trans;
      return { trans };
    } catch (err) {
      log.warn("translate", `${lang}→${to} failed: ${err.name}: ${err.message}`);
      return { note: { text: TRANSLATION_FAILURES[SGL.lang.translationFailure(err)], button: "Try again" } };
    }
  }

  // Our view and sidebar card.
  let extrasToken = 0;
  const showNote = (note) => [view, card, pip].forEach((place) => place.setNote(note));
  async function updateExtras() {
    const token = ++extrasToken;
    const track = current;
    const stale = () => token !== extrasToken || track !== current;
    showNote(null);
    if (!track || !(hasLyrics() || (pip.isOpen() && found())) || (!S.romanize && !S.translate)) {
      view.list.setExtras({});
      card.list.setExtras({});
      pip.list.setExtras({});
      return;
    }
    const data = view.list.data;
    const res = await computeExtras(
      track,
      data.map((l) => l.text),
      { timed: data, stale, onNote: showNote }
    );
    if (!res || stale()) return;
    view.list.setExtras(res);
    card.list.setExtras(res);
    pip.list.setExtras(res);
    if (res.note?.button) res.note.onClick = () => updateExtras(); // a click: Chrome allows the download
    showNote(res.note);
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

  // The lyrics view (mic, L, the card's "Open lyrics view") lives inside Spotify's own Now
  // Playing view, under its header (artwork / Canvas / lyrics tabs, full screen, minimize),
  // the same as Spotify's lyrics. If that view can't be opened, ours covers the main area.
  let openingNowPlaying = false;
  function openView({ overlay = false } = {}) {
    if (!canOpen() || openingNowPlaying) return;
    if (overlay || spotify.expandedContainer()) return showView({ overlay });
    // Spotify flies the cover into its big view; when it opens for our lyrics, skip that
    // flight or the cover crosses over them (content.css, "sgl-opening").
    html.classList.add("sgl-opening");
    // Panel open: one press on its Expand. Closed: open the panel, then press Expand.
    let expanded = spotify.pressExpandNowPlaying();
    if (!expanded && !spotify.pressNowPlayingPanel()) {
      html.classList.remove("sgl-opening");
      return showView({ overlay: true });
    }
    openingNowPlaying = true;
    // Spotify draws its big view on the cover tab first. A MutationObserver runs right after
    // Spotify changes the page and before the browser paints, so our lyrics go in before the
    // cover shows. (A 40 ms timer let the cover show for up to a second while Spotify was busy.)
    const timer = setTimeout(guard("view", () => finish(!!spotify.expandedContainer())), 1500);
    const check = guard("view", () => {
      if (spotify.expandedContainer()) return finish(true);
      if (!expanded) expanded = spotify.pressExpandNowPlaying();
    });
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    check();
    function finish(ready) {
      observer.disconnect();
      clearTimeout(timer);
      openingNowPlaying = false;
      showView({ overlay: !ready });
      // Spotify's opening animation runs about half a second past this point.
      setTimeout(() => html.classList.remove("sgl-opening"), 1000);
    }
  }

  // Shows our view where it is asked: in the Now Playing view if it's open, else over the page.
  function showView({ overlay = false } = {}) {
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

  // Pop-out on a song where Spotify's lyrics are the better ones: show those. They only exist
  // while Spotify has them on the page, so otherwise it says how to get them.
  function mirrorSpotifyLyrics() {
    if (!pip.isOpen() || !current?.result || current.loading || beatsSpotify()) return;
    const { texts, active } = spLyrics.isActive() ? spLyrics.snapshot() : { texts: [] };
    if (texts.length) {
      const key = texts.join("\n");
      if (key !== mirrored) {
        mirrored = key;
        pip.showSpotifyLines(texts, (i) => spLyrics.pressLine(i));
      }
      pip.list.setActive(active, null);
    } else if (spotify.micButton()?.disabled === false && !found()) {
      pip.setStatus("Spotify has lyrics for this song. Open them in Spotify to see them here.");
    }
  }

  function syncNow(force = false) {
    const jumped = clock.update(spotify.positionText());
    const pos = clock.position() + sync.LEAD;
    const paused = clock.isStalled();
    if (spLyrics.isActive() && !covered()) spLyrics.sync(S, { pos, paused, jumped: jumped || force, follow: pip.isOpen() });
    mirrorSpotifyLyrics();
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
    const prevDuration = current?.duration ?? spotify.duration();
    const ours = on() && S.alwaysOurs; // until Spotify's mic settles, and the lookup answers
    current = { ...t, prevDuration, since: Date.now(), missing: ours, override: ours, loading: false, result: null, color: null, attempts: 0, retryAt: null, duration: null, trans: {} };
    card.collapse();
    card.remove();
    picker.close();
    share.close();
    pickerTrack = null;
    pulsedLine = -1;
    html.classList.remove("sgl-has-lyrics");
    hideSpotifyLyrics();
    // Spotify has lyrics for the new song: don't leave our view up while we settle.
    const mic = spotify.micButton();
    if (view.isOpen() && mic && !mic.disabled && !S.alwaysOurs && !fullscreen()) closeView();
    render();
    log.debug("track", `now playing ${label(t)}`);
  }

  // Spotify's own lyrics are up (mic, tab, song change) while ours should be shown: cover them.
  function coverSpotifyLyrics() {
    if (current.override && !view.isOpen() && canOpen() && spotify.ownLyricsOpen() && Date.now() - leftAt > 2000) showView();
  }

  function tick() {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      if (view.isOpen() && !view.isEmbedded()) closeView(); // user navigated somewhere in Spotify
    }

    hideSpotifyLyrics();
    const t = spotify.readTrack();
    if (!t) return;
    if (t.id !== current?.id) onTrackChange(t);
    // Look the new song up as soon as Spotify shows its length (it changes a moment after
    // the title), not after the settle delay: saved lyrics then show up right away.
    if (!current.result && !current.loading && !current.attempts) {
      const d = spotify.duration();
      if (d && d !== current.prevDuration) {
        current.duration = d;
        load(current);
      }
    }
    if (Date.now() - current.since < SETTLE_MS) return coverSpotifyLyrics();

    const mic = spotify.micButton();
    const spotifyHas = !!mic && !mic.disabled;
    // Look the song up when we'll show it, and when the karaoke fill on Spotify's own
    // lyrics needs LRCLIB's timing.
    if (!spotifyHas || S.alwaysOurs || S.karaoke || fullscreen() || pip.isOpen()) {
      current.duration ??= spotify.duration();
      const due = !current.result || (current.result.status === "error" && Date.now() >= (current.retryAt ?? Infinity));
      if (due && !current.loading) load(current);
    }
    // "missing" = we show the lyrics. Spotify's own stay when we found nothing.
    current.missing = !spotifyHas || (S.alwaysOurs && (beatsSpotify() || waitingForOurs())) || fullscreen();
    current.override = spotifyHas && current.missing;
    html.classList.toggle("sgl-override", current.override);
    // We just started showing this song (e.g. "Always use MusicMax lyrics" kicked in):
    // its translation / romanization weren't computed while Spotify showed it.
    if (hasLyrics() !== !!current.shown) {
      current.shown = hasLyrics();
      if (current.shown) updateExtras();
    }

    html.classList.toggle("sgl-has-lyrics", canOpen());
    placeBarButton();
    coverSpotifyLyrics();
    card.place(hasLyrics() ? spotify.sidebarColumn() : null);

    // Mark the expanded view's lyrics tab so CSS can make it look enabled.
    const tab = spotify.lyricsTab();
    if (tab) {
      if ((tab.disabled || current.override) && canOpen()) tab.dataset.sglTab = "";
      else delete tab.dataset.sglTab;
    }

    if (view.isOpen()) {
      const container = spotify.expandedContainer();
      if (fullscreen()) view.place();
      else if (!(current.missing && (current.loading || canOpen()))) {
        closeView();
        // We were asked for lyrics and have none: hand over to Spotify's.
        if (fallbackNotice() && mic.getAttribute("aria-pressed") !== "true") mic.click();
      }
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
    else if (view.isOpen()) {
      const inNowPlaying = view.isEmbedded();
      closeView();
      leaveSpotifyLyrics();
      // Lyrics off from the mic: back to where you were, not to the big view's artwork.
      if (inNowPlaying) spotify.pressMinimizeNowPlaying();
    } else openView();
  }

  // "Always use MusicMax lyrics": our view covers Spotify's lyrics. Closing ours must close
  // theirs too, or they'd be left showing underneath.
  let passThrough = false; // our own click on Spotify's mic, for Spotify to handle
  let leftAt = 0;
  function leaveSpotifyLyrics() {
    if (!current?.override || !spotify.ownLyricsOpen()) return;
    leftAt = Date.now();
    const tab = spotify.lyricsTab();
    if (tab?.getAttribute("aria-checked") === "true") return spotify.spotifyTabs()[0]?.click(); // back to the cover
    passThrough = true;
    try {
      spotify.micButton()?.click(); // Spotify's mic toggles its lyrics page off
    } finally {
      passThrough = false;
    }
  }

  // "Always use MusicMax lyrics": Spotify's mic and lyrics tab are enabled, so their own
  // click must not also open Spotify's lyrics. A keyboard press (Enter/Space) arrives as
  // a click with no pointer: handle it here.
  addEventListener(
    "click",
    guard("click", (e) => {
      if (passThrough || !current?.override || !canOpen()) return;
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

  // Shortcuts: L = lyrics (ours, or Spotify's own when it has them), F = full screen,
  // P = pop-out window.
  // Plain keys only (no Ctrl/Alt/Cmd), never while typing, never on key repeat.
  addEventListener(
    "keydown",
    guard("keys", (e) => {
      if (!on() || !S.shortcuts || e.defaultPrevented || e.repeat || e.isComposing) return;
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return;
      const key = e.key.toLowerCase();
      if (key === "l") {
        if (canOpen()) toggleFrom(false); // same as the mic
        else {
          const mic = spotify.micButton();
          if (!mic || mic.disabled) return;
          mic.click();
        }
      } else if (key === "f" && view.isOpen()) view.toggleFullscreen();
      else if (key === "p" && pip.supported) popOut();
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
    pip.close();
    barBtn.remove();
    card.remove();
    spLyrics.reset();
    html.classList.remove("sgl-has-lyrics", "sgl-override", "sgl-view-open", "sgl-tab-open", "sgl-hide-spotify");
    html.style.removeProperty("--sgl-sub-scale");
    html.style.removeProperty("--sgl-text-scale");
    document.querySelectorAll("[data-sgl-tab]").forEach((t) => delete t.dataset.sglTab);
  }

  setInterval(guard("tick", () => on() && tick()), POLL_MS);
  setInterval(guard("sync", () => on() && syncNow()), SYNC_MS);
  setInterval(guard("ambient", () => on() && ambient.update(current?.cover)), POLL_MS);
  setInterval(guard("spotify-lyrics", () => on() && !covered() && spLyrics.update(S, current?.id, fallbackNotice())), POLL_MS);
  setTimeout(guard("startup", spotify.checkSelectors), 6000);
  log.info("content", `v${chrome.runtime.getManifest().version} running`, undefined, { forward: false });
  if (on()) guard("tick", tick)();
})();
