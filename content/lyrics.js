// A list of lyric lines, used by both the big view and the sidebar card.
// Synced lyrics: past lines fade, the current line is white, upcoming lines use the
// cover tint, the list scrolls to keep the current line in view, and clicking a line
// jumps the song there. Plain lyrics: every line the same color, nothing moves.

(() => {
  const SGL = globalThis.SGL;
  const { el } = SGL;

  class LyricsList {
    // anchor: where the current line sits in the scroller (0 = top, 1 = bottom).
    constructor({ className = "", anchor = 0.35, onSeek } = {}) {
      this.root = el("div", `sgl-lines ${className}`);
      this.anchor = anchor;
      this.onSeek = onSeek;
      this.lines = [];
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

    render(result) {
      this.result = result;
      this.active = -2;
      const synced = !!result?.synced;
      this.root.classList.toggle("is-synced", synced);
      this.lines = (result?.lines || []).map((ln) => {
        const d = el("div", "sgl-line", ln.text || "♪");
        if (!ln.text) d.classList.add("is-break");
        if (synced) {
          d.classList.add("is-future");
          d.addEventListener("click", () => this.onSeek?.(ln.t));
        }
        return d;
      });
      this.root.replaceChildren(...this.lines);
    }

    setActive(idx) {
      if (!this.result?.synced || idx === this.active) return;
      const first = this.active === -2;
      this.active = idx;
      this.lines.forEach((d, i) => {
        d.classList.toggle("is-past", i < idx);
        d.classList.toggle("is-active", i === idx);
        d.classList.toggle("is-future", i > idx);
      });
      if (Date.now() > this.userScrollUntil) this.scrollToLine(Math.max(idx, 0), first ? "auto" : "smooth");
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
