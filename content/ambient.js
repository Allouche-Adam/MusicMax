// Ambient light, like YouTube's ambient mode: behind every large video (Canvas, music
// videos, video podcasts) and large cover art, a tiny copy of the picture is blown up
// and blurred so its colors spill around it. Videos are redrawn every frame (blended
// with the previous frame, so the light drifts instead of flickering).
//
// We only ever *draw* the picture; we never read its pixels, so cross-origin media is
// fine (the canvas just becomes "tainted", which doesn't matter for display).

(() => {
  const SGL = globalThis.SGL;
  const { spotify, log } = SGL;

  const SIZE = 32; // canvas resolution: it gets blurred anyway
  const MIN_PX = 150; // ignore thumbnails
  const VIDEO_BLEND = 0.25; // share of each new video frame (lower = smoother light)
  const SHRINK = 8; // glow is laid out 8x smaller, then scaled up (see Glow.place)

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

  // Big media on the page right now: videos, the sidebar cover, the expanded view's cover.
  function findTargets() {
    const ours = (el) => el.closest(".sgl-view, .sgl-card");
    const big = (el) => {
      const r = el.getBoundingClientRect();
      return r.width >= MIN_PX && r.height >= MIN_PX;
    };
    const targets = [...document.querySelectorAll("video")].filter((v) => big(v) && !ours(v));
    targets.push(...[...document.querySelectorAll('img[data-testid="cover-art-image"]')].filter(big));
    const expanded = spotify.expandedContainer();
    if (expanded) {
      const largest = [...expanded.querySelectorAll("img")]
        .filter((i) => big(i) && !ours(i))
        .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
      if (largest && !targets.includes(largest)) targets.push(largest);
    }
    // A video sitting on top of a cover (Canvas) wins: drop covers that share its box.
    return targets.filter(
      (t) => t.tagName === "VIDEO" || !targets.some((v) => v.tagName === "VIDEO" && overlaps(v, t))
    );
  }

  function overlaps(a, b) {
    const r = a.getBoundingClientRect();
    const s = b.getBoundingClientRect();
    return Math.abs(r.left - s.left) < 40 && Math.abs(r.top - s.top) < 40;
  }

  // The outermost wrapper with the same box as the media (rounded corners, shadow...):
  // the glow goes right behind it, as its previous sibling.
  function frameOf(el) {
    const r = el.getBoundingClientRect();
    let frame = el;
    for (let p = el.parentElement, i = 0; p && p !== document.body && i < 6; p = p.parentElement, i++) {
      const q = p.getBoundingClientRect();
      if (Math.abs(q.width - r.width) > 2 || Math.abs(q.height - r.height) > 2) break;
      frame = p;
    }
    return frame;
  }

  class Glow {
    constructor(target) {
      this.target = target;
      this.isVideo = target.tagName === "VIDEO";
      this.frame = frameOf(target);
      this.host = this.frame.parentElement;
      this.canvas = document.createElement("canvas");
      this.canvas.className = "sgl-glow";
      this.canvas.width = SIZE;
      this.canvas.height = SIZE;
      this.ctx = this.canvas.getContext("2d");
      this.drawnSrc = null;
      this.host.dataset.sglGlowHost = "";
      this.frame.dataset.sglGlowFrame = "";
      this.host.insertBefore(this.canvas, this.frame);
      this.place();
    }

    alive() {
      return this.target.isConnected && this.frame.isConnected && this.canvas.isConnected && this.target.getBoundingClientRect().width >= MIN_PX;
    }

    // Cheap on the GPU: the canvas is laid out SHRINK times smaller than the media (so
    // the blur runs on a few thousand pixels), centered on it, then scaled up with a
    // transform, which only stretches the already-blurred texture.
    place() {
      const s = this.canvas.style;
      const w = this.frame.offsetWidth;
      const h = this.frame.offsetHeight;
      s.width = `${w / SHRINK}px`;
      s.height = `${h / SHRINK}px`;
      s.left = `${this.frame.offsetLeft + (w - w / SHRINK) / 2}px`;
      s.top = `${this.frame.offsetTop + (h - h / SHRINK) / 2}px`;
      s.setProperty("--sgl-k", SHRINK);
    }

    // Still images: draw once per new picture. Videos: called every animation frame.
    draw() {
      const t = this.target;
      try {
        if (this.isVideo) {
          if (t.readyState < 2 || !t.videoWidth) return;
          this.ctx.globalAlpha = this.drawnSrc ? VIDEO_BLEND : 1;
          this.ctx.drawImage(t, 0, 0, SIZE, SIZE);
          this.drawnSrc = t.currentSrc || "video";
        } else {
          const src = t.currentSrc || t.src;
          if (!t.complete || !t.naturalWidth || src === this.drawnSrc) return;
          this.ctx.globalAlpha = 1;
          this.ctx.drawImage(t, 0, 0, SIZE, SIZE);
          this.drawnSrc = src;
        }
        this.canvas.classList.add("is-lit");
      } catch (err) {
        log.debug("ambient", `can't draw ${t.tagName.toLowerCase()}: ${err.message}`);
      }
    }

    pulse() {
      this.canvas.classList.remove("is-pulse");
      void this.canvas.offsetWidth; // restart the animation
      this.canvas.classList.add("is-pulse");
    }

    remove() {
      this.canvas.remove();
      if (this.frame.isConnected) delete this.frame.dataset.sglGlowFrame;
      if (this.host.isConnected && !this.host.querySelector(":scope > .sgl-glow")) delete this.host.dataset.sglGlowHost;
    }
  }

  // ---------- Spotify's own lyrics (expanded view / cinema mode) ----------
  // For songs Spotify has lyrics for, we slip the same turning, blurred cover behind its
  // lines: a layer just behind Spotify's lyrics scroller, painted in Spotify's lyrics
  // background color, with Spotify's own colored background made see-through. We also
  // watch which line Spotify highlights and pulse the light when it moves on.

  const LINE = '[data-testid="lyrics-line"]';

  function spotifyLyricsScroller() {
    const container = spotify.expandedContainer();
    if (!container) return null;
    const line = container.querySelector(LINE);
    if (!line || line.closest(".sgl-view")) return null;
    let p = line.parentElement;
    while (p && p !== container && !/(auto|scroll)/.test(getComputedStyle(p).overflowY)) p = p.parentElement;
    return p && p !== container ? p : null;
  }

  class SpotifyLyricsAmbient {
    constructor(scroller, cover) {
      this.scroller = scroller;
      this.host = scroller.parentElement;
      this.cleared = [];
      this.activeIdx = -1;

      this.layer = document.createElement("div");
      this.layer.className = "sgl-lyrics-ambient";
      this.glow = document.createElement("div");
      this.glow.className = "sgl-view-ambient";
      this.img = document.createElement("img");
      this.img.alt = "";
      this.glow.append(this.img);
      this.layer.append(this.glow);
      this.host.dataset.sglGlowHost = "";
      this.host.insertBefore(this.layer, this.host.firstChild);

      this.observer = new MutationObserver(() => this.scheduleCheck());
      this.observer.observe(scroller, { attributes: true, subtree: true, attributeFilter: ["class"] });
      this.update(cover);
    }

    alive() {
      return this.scroller.isConnected && this.layer.isConnected && !!this.scroller.querySelector(LINE);
    }

    // Keep the layer in step with Spotify (new song = new color, re-rendered backgrounds).
    update(cover) {
      const line = this.scroller.querySelector(LINE);
      const bg = line && getComputedStyle(line).getPropertyValue("--lyrics-color-background").trim();
      if (bg) this.layer.style.backgroundColor = bg;
      if (cover && this.img.getAttribute("src") !== cover) this.img.src = cover;
      const r = this.host.getBoundingClientRect();
      this.img.style.setProperty("--sgl-k", Math.ceil(Math.hypot(r.width, r.height) / 64) + 2);

      // Spotify paints its colored background on a full-size layer inside the scroller
      // (beside the lines, not around them): find whatever is big and opaque under the
      // middle of the scroller and make it clear, so our layer (same color + light) shows.
      const s = this.scroller.getBoundingClientRect();
      if (!s.width) return;
      for (const e of document.elementsFromPoint(s.left + s.width / 2, s.top + s.height / 2)) {
        if (e === this.scroller || !this.scroller.contains(e) || e.dataset.sglClearBg !== undefined) continue;
        if (opaque(getComputedStyle(e).backgroundColor) && e.getBoundingClientRect().width >= s.width * 0.8) {
          e.dataset.sglClearBg = "";
          this.cleared.push(e);
        }
      }
    }

    scheduleCheck() {
      if (this.pending) return;
      this.pending = requestAnimationFrame(() => {
        this.pending = 0;
        this.checkActive();
      });
    }

    // Spotify's current line is the one in its "active" color at full opacity.
    checkActive() {
      const lines = [...this.scroller.querySelectorAll(LINE)];
      if (!lines.length) return;
      const active = getComputedStyle(lines[0]).getPropertyValue("--lyrics-color-active").trim();
      const idx = lines.findIndex((l) => {
        const s = getComputedStyle(l);
        return sameColor(s.color, active) && s.opacity === "1";
      });
      if (idx < 0 || idx === this.activeIdx) return;
      const fresh = idx > this.activeIdx && idx - this.activeIdx <= 2; // not after a seek
      this.activeIdx = idx;
      if (fresh && lines[idx].textContent.trim() && !reducedMotion.matches) this.pulse();
    }

    pulse() {
      this.glow.classList.remove("is-pulse");
      void this.glow.offsetWidth;
      this.glow.classList.add("is-pulse");
    }

    remove() {
      this.observer.disconnect();
      cancelAnimationFrame(this.pending);
      this.layer.remove();
      for (const p of this.cleared) delete p.dataset.sglClearBg;
      if (this.host.isConnected && !this.host.querySelector(":scope > .sgl-glow")) delete this.host.dataset.sglGlowHost;
    }
  }

  function opaque(color) {
    const m = color.match(/[\d.]+/g);
    return !!m && (m.length < 4 || Number(m[3]) > 0.5);
  }

  // "rgba(255, 255, 255, 1)" vs "rgb(255, 255, 255)"
  function sameColor(a, b) {
    const nums = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).join(",");
    return !!a && !!b && nums(a) === nums(b);
  }

  SGL.createAmbient = () => {
    let enabled = true;
    const glows = new Map(); // target element -> Glow
    let raf = 0;
    let lyricsAmbient = null; // SpotifyLyricsAmbient while Spotify's own lyrics are on screen

    function updateSpotifyLyrics(cover) {
      const scroller = spotifyLyricsScroller();
      if (lyricsAmbient && (!lyricsAmbient.alive() || lyricsAmbient.scroller !== scroller)) {
        lyricsAmbient.remove();
        lyricsAmbient = null;
      }
      if (!scroller) return;
      if (!lyricsAmbient) {
        lyricsAmbient = new SpotifyLyricsAmbient(scroller, cover);
        log.debug("ambient", "light added behind Spotify's lyrics");
      } else lyricsAmbient.update(cover);
    }

    function videoLoop() {
      raf = 0;
      let playing = false;
      for (const g of glows.values()) {
        if (!g.isVideo) continue;
        if (!g.target.paused && !document.hidden) {
          g.draw();
          playing = true;
        }
      }
      if (playing) raf = requestAnimationFrame(videoLoop);
    }

    function clear() {
      for (const g of glows.values()) g.remove();
      glows.clear();
      lyricsAmbient?.remove();
      lyricsAmbient = null;
      cancelAnimationFrame(raf);
      raf = 0;
    }

    // Called from the main loop (twice a second) with the playing song's cover.
    function update(cover) {
      if (!enabled) return;
      updateSpotifyLyrics(cover);
      const targets = new Set(findTargets());
      for (const [t, g] of glows) {
        if (!targets.has(t) || !g.alive()) {
          g.remove();
          glows.delete(t);
        }
      }
      for (const t of targets) {
        if (!glows.has(t)) {
          glows.set(t, new Glow(t));
          log.debug("ambient", `glow added behind ${t.tagName.toLowerCase()} (${Math.round(t.getBoundingClientRect().width)}px)`);
        }
        const g = glows.get(t);
        g.place();
        if (!g.isVideo) g.draw();
      }
      if (!raf && [...glows.values()].some((g) => g.isVideo && !g.target.paused)) raf = requestAnimationFrame(videoLoop);
    }

    return {
      update,
      // A new lyric line started.
      pulse() {
        if (!enabled || reducedMotion.matches) return;
        for (const g of glows.values()) g.pulse();
      },
      setEnabled(on) {
        enabled = !!on;
        if (!enabled) clear();
      },
      count: () => glows.size,
    };
  };
})();
