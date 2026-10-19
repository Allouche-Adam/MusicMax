// MusicMax features on Spotify's *own* lyrics (songs Spotify has lyrics for):
//   - translation / romanization under each of Spotify's lines
//   - the karaoke fill on Spotify's current line, timed with LRCLIB's synced lyrics for
//     the same song (Spotify doesn't expose its timing on the page)
// Spotify keeps its line elements while the song plays, so we attach to them; a
// MutationObserver notices when it re-renders (new song, view reopened).

(() => {
  const SGL = globalThis.SGL;
  const { el, spotify } = SGL;

  const LINE = '[data-testid="lyrics-line"]';
  const MIN_LINES = 8; // the full lyrics view, not the sidebar's short preview
  const MAX_LINE = 15;

  const norm = (s) => String(s || "").replace(/[\s\p{P}\p{S}]+/gu, "").toLowerCase();
  const sameColor = (a, b) => {
    const nums = (c) => (String(c).match(/[\d.]+/g) || []).slice(0, 3).join(",");
    return !!a && !!b && nums(a) === nums(b);
  };
  const isOurSub = (n) => n.nodeType === 1 && n.classList.contains("sgl-sub");

  // getExtras(texts) → Promise<{ roma, trans, note }> (arrays aligned with texts)
  // getTiming() → synced lines [{ t, text }] for the playing song, or null
  // onLine(lineEl) → a new line started, in play order (not after a seek)
  SGL.createSpotifyLyrics = ({ getExtras, getTiming, onLine }) => {
    let container = null;
    let observer = null;
    let lines = [];
    let texts = [];
    let linesDirty = true;
    let activeDirty = true;
    let extrasKey = "";
    let extras = null;
    let token = 0;
    let active = -1;
    let fillEl = null;
    let lastCheck = 0;

    // Spotify's biggest list of lyric lines on screen (lyrics page / expanded view).
    function findContainer() {
      const counts = new Map();
      for (const l of document.querySelectorAll(LINE)) {
        if (spotify.isOurs(l)) continue;
        counts.set(l.parentElement, (counts.get(l.parentElement) || 0) + 1);
      }
      let best = null;
      let n = 0;
      for (const [p, c] of counts) if (c > n) [best, n] = [p, c];
      return n >= MIN_LINES ? best : null;
    }

    function attach(c) {
      detach();
      container = c;
      linesDirty = activeDirty = true;
      observer = new MutationObserver((records) => {
        for (const r of records) {
          if (r.type === "attributes") activeDirty = true;
          else if (![...r.addedNodes, ...r.removedNodes].every(isOurSub)) linesDirty = activeDirty = true;
        }
      });
      observer.observe(c, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "style"] });
    }

    function detach() {
      observer?.disconnect();
      observer = null;
      clearFill();
      clearSubs();
      container = null;
      lines = [];
      texts = [];
      extras = null;
      extrasKey = "";
      active = -1;
    }

    function clearSubs() {
      container?.querySelectorAll(".sgl-sub").forEach((s) => s.remove());
    }

    const lineText = (l) => (l.firstElementChild && !isOurSub(l.firstElementChild) ? l.firstElementChild : l).textContent.trim();

    function readLines() {
      if (!linesDirty) return;
      linesDirty = false;
      lines = [...container.children].filter((c) => c.matches(LINE));
      const next = lines.map(lineText);
      if (next.join("\n") !== texts.join("\n")) {
        texts = next;
        extras = null;
        extrasKey = "";
        active = -1;
        clearFill();
      }
    }

    // ---------- translation / romanization ----------

    async function loadExtras() {
      const t = ++token;
      const res = await getExtras(texts.map((x) => (x === "♪" ? "" : x)));
      if (t !== token || !container) return;
      extras = res || {};
      applySubs();
    }

    function applySubs() {
      lines.forEach((l, i) => {
        const r = extras?.roma?.[i];
        const tr = extras?.trans?.[i];
        const want = [];
        // Skip "translations" that are the same words ("Na-na" → "na-na").
        if (r && norm(r) !== norm(texts[i])) want.push(["sgl-roma", r]);
        if (tr && norm(tr) !== norm(texts[i])) want.push(["sgl-trans", tr]);
        const have = [...l.querySelectorAll(":scope > .sgl-sub:not(.sgl-sp-note)")];
        if (have.length === want.length && have.every((h, k) => h.textContent === want[k][1])) return;
        have.forEach((h) => h.remove());
        for (const [cls, txt] of want) l.append(el("div", `sgl-sub ${cls}`, txt));
      });

      // A note ("needs a one-time download") under the first line, with its button.
      container.querySelector(".sgl-sp-note")?.remove();
      const n = extras?.note;
      if (n && lines[0]) {
        const note = el("div", "sgl-sub sgl-sp-note", n.text);
        if (n.button) {
          const b = el("button", "sgl-link-btn", n.button);
          b.type = "button";
          b.addEventListener("click", (e) => {
            e.stopPropagation(); // don't let Spotify seek to the line
            loadExtras(); // a click: Chrome allows the model download
          });
          note.append(" ", b);
        }
        lines[0].append(note);
      }
    }

    // ---------- karaoke fill on Spotify's current line ----------

    function currentIndex() {
      if (!lines.length) return -1;
      const activeColor = getComputedStyle(lines[0]).getPropertyValue("--lyrics-color-active").trim();
      return lines.findIndex((l) => {
        const s = getComputedStyle(l);
        return s.opacity === "1" && sameColor(s.color, activeColor);
      });
    }

    function clearFill() {
      if (!fillEl) return;
      fillEl.classList.remove("sgl-sp-fill", "sgl-sp-paused");
      fillEl.style.removeProperty("--sgl-dur");
      fillEl.style.removeProperty("--sgl-delay");
      fillEl = null;
    }

    // Find the synced line Spotify is showing (same words, close in time) to learn how
    // long it lasts and how far into it the song is.
    function startFill(pos) {
      clearFill();
      const timing = getTiming();
      const text = texts[active];
      if (!timing || active < 0 || !text || text === "♪") return;
      const want = norm(text);
      let best = -1;
      let bestCost = Infinity;
      timing.forEach((ln, i) => {
        if (!ln.text) return;
        const cost = Math.abs(ln.t - pos) + (norm(ln.text) === want ? 0 : 3);
        if (cost < bestCost) [best, bestCost] = [i, cost];
      });
      if (best < 0 || bestCost > 3) return; // no confident match: leave Spotify's line as is
      const ln = timing[best];
      const next = timing[best + 1];
      const dur = Math.min(MAX_LINE, Math.max(0.3, (next ? next.t : ln.t + 5) - ln.t));
      const elapsed = Math.min(dur, Math.max(0, pos - ln.t));
      fillEl = lines[active].firstElementChild || lines[active];
      fillEl.style.setProperty("--sgl-dur", `${dur}s`);
      fillEl.style.setProperty("--sgl-delay", `${-elapsed}s`);
      void fillEl.offsetWidth; // restart the animation
      fillEl.classList.add("sgl-sp-fill");
    }

    return {
      // Twice a second, with the current settings.
      update(S, trackId) {
        const c = findContainer();
        if (c !== container) {
          if (c) attach(c);
          else detach();
        }
        if (!container) return;
        readLines();
        const key = S.translate || S.romanize ? `${trackId}|${S.translate}|${S.translateTo}|${S.romanize}` : "";
        if (key !== extrasKey) {
          extrasKey = key;
          extras = null;
          token++;
          clearSubs();
          if (key) loadExtras();
        } else if (extras) applySubs(); // Spotify re-rendered a line: put ours back
      },

      // Ten times a second: follow Spotify's current line with the karaoke fill.
      // Spotify moves its highlight without touching the lines' attributes (checked:
      // no mutations at all), so the current line is re-read four times a second too.
      sync(S, { pos, paused, jumped }) {
        const stars = S.secretStars;
        if (!S.karaoke) clearFill();
        if (!container || (!S.karaoke && !stars)) return;
        const now = performance.now();
        if (activeDirty || jumped || now - lastCheck > 250) {
          activeDirty = false;
          lastCheck = now;
          const idx = currentIndex();
          if (idx !== active || jumped) {
            const fresh = !jumped && idx > active && idx - active <= 2;
            active = idx;
            if (S.karaoke) startFill(pos);
            if (stars && fresh && texts[idx] && texts[idx] !== "♪") onLine?.(lines[idx]);
          }
        }
        fillEl?.classList.toggle("sgl-sp-paused", !!paused);
      },

      // Our own lyrics arrived (timing for the fill): try again on the current line.
      refresh(pos) {
        if (container && active >= 0) startFill(pos);
      },

      isActive: () => !!container,
      reset: () => detach(), // MusicMax turned off: take everything back out
    };
  };
})();
