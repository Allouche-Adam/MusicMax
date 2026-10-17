// Everything that reads (or pokes) Spotify's own page lives here, so when Spotify
// changes its markup this is the one file to fix. Selectors were checked against
// open.spotify.com in October 2026.

(() => {
  const SGL = globalThis.SGL;
  const $ = (sel, root = document) => root.querySelector(sel);

  const SEL = {
    widget: '[data-testid="now-playing-widget"]',
    title: '[data-testid="context-item-info-title"]',
    artist: '[data-testid="context-item-info-artist"]',
    mic: '[data-testid="lyrics-button"]',
    position: '[data-testid="playback-position"]',
    duration: '[data-testid="playback-duration"]',
    progress: '[data-testid="progress-bar"]',
    nav: '[data-testid="global-nav-bar"]',
    bar: '[data-testid="now-playing-bar"]',
    spotifyLyricsCard: '[data-testid="lyrics-npv-section"]',
    tabs: '[role="radiogroup"] [role="radio"]',
  };

  function readTrack() {
    const widget = $(SEL.widget);
    const domTitle = widget && $(SEL.title, widget)?.textContent;
    const domArtists = widget ? [...widget.querySelectorAll(SEL.artist)].map((a) => a.textContent.trim()) : [];

    const md = navigator.mediaSession?.metadata;
    const title = (md?.title || domTitle || "").trim();
    let artists = domArtists.filter(Boolean);
    if (!artists.length && md?.artist) artists = md.artist.split(/,\s*/);
    if (!title || !artists.length) return null;

    const art = md?.artwork || [];
    const cover =
      art.find((a) => a.sizes === "300x300")?.src || art[art.length - 1]?.src || widget?.querySelector("img")?.src || null;

    return { id: `${artists.join(",")}|${title}`, title, artists, cover };
  }

  function positionText() {
    return $(SEL.position)?.textContent ?? null;
  }

  // Song length in seconds. Handles the "remaining time" display ("-1:23").
  function duration() {
    const d = SGL.sync.parseClock($(SEL.duration)?.textContent);
    if (d == null) return null;
    if (d >= 0) return d;
    const p = SGL.sync.parseClock(positionText());
    return p == null ? null : p - d;
  }

  const micButton = () => $(SEL.mic);

  // The expanded Now Playing view's tabs (artwork / Canvas / artist / lyrics): lyrics is last.
  function lyricsTab() {
    const tabs = document.querySelectorAll(SEL.tabs);
    return tabs.length >= 2 ? tabs[tabs.length - 1] : null;
  }

  // The expanded view's container: the parent of its absolutely positioned header.
  function expandedContainer(tab = lyricsTab()) {
    if (!tab) return null;
    let p = tab.parentElement;
    while (p && getComputedStyle(p).position !== "absolute") p = p.parentElement;
    const c = p?.parentElement;
    return c && c.getBoundingClientRect().width > 600 ? c : null;
  }

  // The column of cards (lyrics / About the artist / Credits) in the right sidebar.
  function sidebarColumn() {
    const aside = [...document.querySelectorAll("aside")].find((a) => {
      const r = a.getBoundingClientRect();
      return r.width > 0 && r.width < 700 && r.left > innerWidth / 2;
    });
    if (!aside) return null;
    for (const s of aside.querySelectorAll("section")) {
      const p = s.parentElement;
      if (p && getComputedStyle(p).flexDirection === "column") return p;
    }
    return null;
  }

  // Free area between the top bar and the player bar (where cinema mode sits).
  function contentArea() {
    const nav = $(SEL.nav);
    const bar = $(SEL.bar);
    return {
      top: nav ? nav.getBoundingClientRect().bottom : 64,
      bottom: bar ? innerHeight - bar.getBoundingClientRect().top + 8 : 104,
    };
  }

  // Jumps playback by "clicking" Spotify's progress bar at the right spot.
  function seekTo(sec) {
    const bar = $(SEL.progress);
    const len = duration();
    if (!bar || !len) {
      SGL.log.warn("seek", `can't seek: ${!bar ? "progress bar not found" : "unknown duration"}`);
      return false;
    }
    const r = bar.getBoundingClientRect();
    if (!r.width) return false;
    const frac = Math.min(1, Math.max(0, sec / len));
    const x = r.left + r.width * frac;
    const y = r.top + r.height / 2;
    // elementFromPoint fails in full screen (another element covers the bar): fall back to the bar.
    const hit = document.elementFromPoint(x, y);
    const target = hit && bar.contains(hit) ? hit : bar;
    const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, pointerId: 1, pointerType: "mouse", isPrimary: true };
    target.dispatchEvent(new PointerEvent("pointerdown", { ...base, buttons: 1 }));
    target.dispatchEvent(new MouseEvent("mousedown", { ...base, buttons: 1 }));
    target.dispatchEvent(new PointerEvent("pointermove", { ...base, buttons: 1 }));
    target.dispatchEvent(new PointerEvent("pointerup", { ...base, buttons: 0 }));
    target.dispatchEvent(new MouseEvent("mouseup", { ...base, buttons: 0 }));
    target.dispatchEvent(new MouseEvent("click", { ...base, buttons: 0 }));
    SGL.log.debug("seek", `to ${sec.toFixed(1)}s of ${len}s`);
    return true;
  }

  // Sanity check at startup: tells the log which selectors stopped matching. Spotify can
  // take a while to draw its player, so only warn if something is still missing after
  // a few tries.
  function checkSelectors(triesLeft = 3) {
    const missing = ["widget", "mic", "position", "duration", "progress", "nav", "bar"].filter((k) => !$(SEL[k]));
    if (!missing.length) SGL.log.debug("spotify", "all page elements found");
    else if (triesLeft > 1) setTimeout(() => checkSelectors(triesLeft - 1), 10000);
    else SGL.log.warn("spotify", `page elements not found: ${missing.join(", ")}`);
    return missing;
  }

  SGL.spotify = {
    SEL,
    readTrack,
    positionText,
    duration,
    micButton,
    lyricsTab,
    expandedContainer,
    sidebarColumn,
    contentArea,
    seekTo,
    checkSelectors,
    hasOwnLyricsCard: () => !!$(SEL.spotifyLyricsCard),
  };
})();
