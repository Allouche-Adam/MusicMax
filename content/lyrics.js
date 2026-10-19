// A list of lyric lines, used by both the big view and the sidebar card.
//
// Synced lyrics: past lines fade, the current line is white (with an optional karaoke
// fill sweeping across it), upcoming lines use the cover tint, the list scrolls to keep
// the current line in view, clicking a line jumps the song there, and instrumental
// breaks show three dots that fill up over the break. Plain lyrics: every line the
// same color, nothing moves. Each line can carry a romanization and a translation.

(() => {
  const SGL = globalThis.SGL;
  const { el } = SGL;

  const INTRO_BREAK = 4; // seconds of silence before the first line that earn dots
  const MAX_LINE = 15; // cap for a line's karaoke duration (seconds)

  class LyricsList {
    // anchor: where the current line sits in the scroller (0 = top, 1 = bottom).
    constructor({ className = "", anchor = 0.35, onSeek, onShare } = {}) {
      this.root = el("div", `sgl-lines ${className}`);
      this.anchor = anchor;
      this.onSeek = onSeek;
      this.onShare = onShare;
      this.lines = []; // elements
      this.data = []; // displayed lines: [{ t?, text }]
      this.result = null;
      this.active = -2; // -2: never set (first update scrolls instantly)
      this.scroller = null;
      this.userScrollUntil = 0;
    }

    // The element that scrolls. Manual scrolling pauses auto-scroll for a few seconds.
    attachScroller(node) {
      this.scroller = node;
      const pause = () => (this.userScrollUntil = Date.now() + 4000);
      node.addEventListener("wheel", pause, { passive: true });
      node.addEventListener("touchmove", pause, { passive: true });
    }

    setOptions({ karaoke, align, scale }) {
      this.root.classList.toggle("is-karaoke", !!karaoke);
      this.root.classList.toggle("is-center", align === "center");
      if (scale) this.root.style.setProperty("--sgl-scale", scale);
    }

    render(result, { breakDots = true } = {}) {
      this.result = result;
      this.active = -2;
      const synced = !!result?.synced;
      let data = result?.lines || [];
      if (synced && breakDots && data.length && data[0].t > INTRO_BREAK) data = [{ t: 0, text: "" }, ...data];
      this.data = data;
      this.root.classList.toggle("is-synced", synced);

      this.lines = data.map((ln) => {
        const d = el("div", "sgl-line");
        const text = el("span", "sgl-text");
        if (ln.text) text.textContent = ln.text;
        else {
          d.classList.add("is-break");
          if (synced && breakDots) text.append(el("span", "sgl-dot"), el("span", "sgl-dot"), el("span", "sgl-dot"));
          else text.textContent = "♪";
        }
        d.append(text);
        if (synced) {
          d.classList.add("is-future");
          d.addEventListener("click", (e) => {
            if (!e.target.closest(".sgl-sub")) this.onSeek?.(ln.t);
          });
        }
        if (ln.text && this.onShare) {
          d.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            this.onShare(ln, e);
          });
        }
        return d;
      });
      this.root.replaceChildren(...this.lines);
    }

    // Romanization / translation under each line. Arrays align with this.data (or null).
    setExtras({ roma, trans }) {
      this.lines.forEach((d, i) => {
        d.querySelectorAll(".sgl-sub").forEach((s) => s.remove());
        const r = roma?.[i];
        const t = trans?.[i];
        if (r && r !== this.data[i].text) d.append(el("div", "sgl-sub sgl-roma", r));
        if (t && t !== this.data[i].text) d.append(el("div", "sgl-sub sgl-trans", t));
      });
      requestAnimationFrame(() => this.recenter());
    }

    // idx: index into this.data. pos: song position in seconds (for the karaoke fill).
    setActive(idx, pos) {
      if (!this.result?.synced || idx === this.active) return;
      const first = this.active === -2;
      const prev = this.lines[this.active];
      prev?.classList.remove("is-filling");
      this.active = idx;
      this.lines.forEach((d, i) => {
        d.classList.toggle("is-past", i < idx);
        d.classList.toggle("is-active", i === idx);
        d.classList.toggle("is-future", i > idx);
      });
      this.startFill(pos);
      if (Date.now() > this.userScrollUntil) this.scrollToLine(Math.max(idx, 0), first ? "auto" : "smooth");
    }

    // Karaoke fill (and break dots) for the current line, started `pos - line.t` seconds
    // in, so it lines up after opening the view or seeking.
    startFill(pos) {
      const d = this.lines[this.active];
      const ln = this.data[this.active];
      if (!d || !ln || pos == null) return;
      const next = this.data[this.active + 1];
      const gap = Math.min(MAX_LINE, Math.max(0.3, (next ? next.t : ln.t + 5) - ln.t));
      const dur = SGL.sync.fillDuration(ln.text, gap);
      const elapsed = Math.min(dur, Math.max(0, pos - ln.t));
      d.style.setProperty("--sgl-dur", `${dur}s`);
      d.style.setProperty("--sgl-delay", `${-elapsed}s`);
      d.querySelectorAll(".sgl-dot").forEach((dot, i) => {
        dot.style.animationDuration = `${dur / 3}s`;
        dot.style.animationDelay = `${(i * dur) / 3 - elapsed}s`;
      });
      d.classList.remove("is-filling");
      void d.offsetWidth; // restart the CSS animations
      d.classList.add("is-filling");
    }

    // The song jumped (seek) or resumed: line the fill up with the new position.
    resync(pos) {
      if (this.active >= 0) this.startFill(pos);
    }

    setPaused(paused) {
      this.root.classList.toggle("is-paused", !!paused);
    }

    // Re-center on the current line (after opening, resizing, "Show more"...).
    recenter() {
      if (this.result?.synced && this.active >= -1) this.scrollToLine(Math.max(this.active, 0), "auto");
    }

    scrollToLine(idx, behavior) {
      const s = this.scroller;
      const line = this.lines[idx];
      if (!s || !line || !s.isConnected || !s.clientHeight) return;
      const delta = line.getBoundingClientRect().top - s.getBoundingClientRect().top - s.clientHeight * this.anchor;
      if (Math.abs(delta) > 2) s.scrollBy({ top: delta, behavior });
    }
  }

  SGL.LyricsList = LyricsList;
})();
