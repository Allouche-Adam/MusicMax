// Secret effects, unlocked by clicking the version in the popup 5 times: stars flying off
// each new lyric line, and a sparkle trail behind the cursor.
//
// Off by default, and off really means nothing runs: the canvas, the mouse listener and
// the animation loop only exist while an effect is on, and the loop stops as soon as the
// last star has faded.

(() => {
  const SGL = globalThis.SGL;

  const MAX = 160; // stars on screen at once
  const COLORS = ["#fff6c4", "#ffe066", "#ffffff", "#9ff3c5", "#ffc8f0", "#b9d8ff"];
  const TRAIL_STEP = 14; // px the cursor moves between two trail stars
  const GRAVITY = 60; // px/s²

  const rand = (a, b) => a + Math.random() * (b - a);
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

  SGL.createSparkles = () => {
    let opts = { stars: false, cursor: false };
    let canvas = null;
    let ctx = null;
    let raf = 0;
    let last = 0;
    let parts = [];
    let trailX = 0;
    let trailY = 0;

    // ---------- canvas (only while an effect is on) ----------

    // In full screen only the full-screen element is visible: the canvas goes inside it.
    const parent = () => document.fullscreenElement || document.body;

    function resize() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = innerWidth * dpr;
      canvas.height = innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function follow() {
      if (canvas && canvas.parentElement !== parent()) parent().append(canvas);
    }

    function createCanvas() {
      if (canvas) return;
      canvas = document.createElement("canvas");
      canvas.className = "sgl-sparkles";
      canvas.setAttribute("aria-hidden", "true");
      ctx = canvas.getContext("2d");
      parent().append(canvas);
      resize();
      addEventListener("resize", resize);
      document.addEventListener("fullscreenchange", follow);
    }

    function removeCanvas() {
      cancelAnimationFrame(raf);
      raf = 0;
      parts = [];
      canvas?.remove();
      canvas = ctx = null;
      removeEventListener("resize", resize);
      document.removeEventListener("fullscreenchange", follow);
    }

    // ---------- stars ----------

    function spawn(x, y, p) {
      if (parts.length >= MAX) parts.shift();
      parts.push({
        x,
        y,
        age: 0,
        rot: rand(0, Math.PI),
        spin: rand(-3, 3),
        color: COLORS[(Math.random() * COLORS.length) | 0],
        ...p,
      });
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    }

    // A four-pointed sparkle.
    function drawStar(p, alpha) {
      const r = p.size * (0.4 + 0.6 * alpha);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        const d = i % 2 ? r * 0.32 : r;
        ctx.lineTo(Math.cos(a) * d, Math.sin(a) * d);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    function frame(now) {
      raf = 0;
      if (!ctx) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      parts = parts.filter((p) => (p.age += dt) < p.life);
      for (const p of parts) {
        p.vy += GRAVITY * p.fall * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.spin * dt;
        drawStar(p, 1 - p.age / p.life);
      }
      if (parts.length) raf = requestAnimationFrame(frame); // otherwise: idle, nothing runs
    }

    // ---------- the two effects ----------

    // Stars rising off a lyric line that just started.
    function burst(lineEl) {
      if (!opts.stars || !canvas || !lineEl?.isConnected || reducedMotion.matches) return;
      const range = document.createRange();
      range.selectNodeContents(lineEl.firstElementChild || lineEl);
      const r = range.getBoundingClientRect(); // the words, not the whole (wide) line
      if (!r.width || r.bottom < 0 || r.top > innerHeight) return;
      for (let i = 0; i < 18; i++) {
        spawn(rand(r.left, r.right), rand(r.top, r.bottom), {
          vx: rand(-45, 45),
          vy: rand(-110, -35),
          fall: 0.6,
          size: rand(3, 7),
          life: rand(0.9, 1.6),
        });
      }
    }

    function onMove(e) {
      if (reducedMotion.matches || Math.hypot(e.clientX - trailX, e.clientY - trailY) < TRAIL_STEP) return;
      trailX = e.clientX;
      trailY = e.clientY;
      spawn(e.clientX, e.clientY, {
        vx: rand(-20, 20),
        vy: rand(-10, 30),
        fall: 1,
        size: rand(2.5, 5.5),
        life: rand(0.5, 0.9),
      });
    }

    return {
      // { stars, cursor }: the canvas and the listener exist only while one of them is on.
      setOptions(next) {
        if (next.stars === opts.stars && next.cursor === opts.cursor) return;
        if (next.cursor && !opts.cursor) addEventListener("pointermove", onMove, { passive: true });
        if (!next.cursor && opts.cursor) removeEventListener("pointermove", onMove);
        opts = { ...next };
        if (opts.stars || opts.cursor) createCanvas();
        else removeCanvas();
      },
      burst,
    };
  };
})();
