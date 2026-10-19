// Share a lyric: right-click a line → a small menu → an image card (the line in big
// type over the blurred cover, with the song and artist), copied or saved as a PNG.

(() => {
  const SGL = globalThis.SGL;
  const { el } = SGL;

  const W = 1080;
  const H = 1350;
  const PAD = 90;

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("cover didn't load"));
      img.src = src;
    });
  }

  // Splits text into lines that fit `maxWidth` with the context's current font.
  function wrap(ctx, text, maxWidth) {
    const out = [];
    let line = "";
    for (const word of text.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        out.push(line);
        line = word;
      } else line = test;
    }
    if (line) out.push(line);
    return out;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // { line, sub, title, artists, cover, theme, source } → PNG Blob
  async function makeImage({ line, sub, title, artists, cover, theme, source }) {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    const bg = theme?.bg || "rgb(40, 40, 40)";
    const tint = theme?.tint || "rgb(200, 200, 200)";

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // The cover comes through the background worker as a data: URL, so the canvas
    // stays exportable (a cross-origin image would block toBlob()).
    let img = null;
    if (cover) {
      const res = await SGL.send({ type: "coverData", url: cover });
      if (res?.dataUrl) img = await loadImage(res.dataUrl).catch(() => null);
    }
    if (img) {
      ctx.save();
      ctx.filter = "blur(70px) saturate(1.4)";
      ctx.globalAlpha = 0.55;
      const s = Math.max(W, H) * 1.5;
      ctx.drawImage(img, (W - s) / 2, (H - s) / 2, s, s);
      ctx.restore();
    }
    const shade = ctx.createLinearGradient(0, 0, 0, H);
    shade.addColorStop(0, "rgba(0,0,0,0.15)");
    shade.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, W, H);

    await Promise.all([
      document.fonts.load("700 80px SpotifyMixUITitle").catch(() => {}),
      document.fonts.load("700 40px SpotifyMixUI").catch(() => {}),
    ]);
    const titleFont = "SpotifyMixUITitle, SpotifyMixUI, 'Helvetica Neue', Arial, sans-serif";
    const uiFont = "SpotifyMixUI, 'Helvetica Neue', Arial, sans-serif";

    // Header: cover thumbnail, title, artist.
    const thumb = 150;
    if (img) {
      ctx.save();
      roundRect(ctx, PAD, PAD, thumb, thumb, 16);
      ctx.clip();
      ctx.drawImage(img, PAD, PAD, thumb, thumb);
      ctx.restore();
    }
    const tx = img ? PAD + thumb + 36 : PAD;
    ctx.fillStyle = "#fff";
    ctx.font = `700 46px ${uiFont}`;
    ctx.textBaseline = "top";
    ctx.fillText(wrap(ctx, title, W - tx - PAD)[0] || "", tx, PAD + 30);
    ctx.fillStyle = tint;
    ctx.font = `400 34px ${uiFont}`;
    ctx.fillText(wrap(ctx, artists.join(", "), W - tx - PAD)[0] || "", tx, PAD + 90);

    // The lyric, as big as it fits.
    let size = 92;
    let lines;
    do {
      ctx.font = `700 ${size}px ${titleFont}`;
      lines = wrap(ctx, line, W - PAD * 2);
      size -= 6;
    } while (lines.length * size * 1.2 > H * 0.5 && size > 40);
    size += 6;
    const lh = size * 1.18;
    const subSize = Math.round(size * 0.42);
    const subLines = sub ? (ctx.font = `400 ${subSize}px ${uiFont}`, wrap(ctx, sub, W - PAD * 2)) : [];
    const block = lines.length * lh + (subLines.length ? 30 + subLines.length * subSize * 1.3 : 0);
    let y = (H - block) / 2 + 40;
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${size}px ${titleFont}`;
    for (const l of lines) {
      ctx.fillText(l, PAD, y);
      y += lh;
    }
    if (subLines.length) {
      y += 30;
      ctx.fillStyle = tint;
      ctx.font = `400 ${subSize}px ${uiFont}`;
      for (const l of subLines) {
        ctx.fillText(l, PAD, y);
        y += subSize * 1.3;
      }
    }

    ctx.fillStyle = tint;
    ctx.globalAlpha = 0.85;
    ctx.font = `700 26px ${uiFont}`;
    ctx.textBaseline = "bottom";
    ctx.fillText(`Lyrics: ${source || "unknown"}`, PAD, H - PAD + 20);

    // A quiet credit in the bottom-right corner, so people who see the image can find us.
    ctx.textAlign = "right";
    ctx.fillStyle = "#fff";
    ctx.globalAlpha = 0.5;
    ctx.font = `700 26px ${uiFont}`;
    ctx.fillText("MusicMax", W - PAD, H - PAD - 10);
    ctx.globalAlpha = 0.35;
    ctx.font = `400 18px ${uiFont}`;
    ctx.fillText(SGL.firefox ? "Available on Firefox Add-ons" : "Available on the Chrome Web Store", W - PAD, H - PAD + 20);
    ctx.textAlign = "left";
    ctx.globalAlpha = 1;

    return new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("couldn't create the image"))), "image/png")
    );
  }

  SGL.createShare = ({ getInfo }) => {
    let menu = null;

    function close() {
      menu?.remove();
      menu = null;
    }
    addEventListener("pointerdown", (e) => menu && !menu.contains(e.target) && close(), true);
    addEventListener("keydown", (e) => e.key === "Escape" && close(), true);
    // Only your own scrolling closes it (the lyrics auto-scroll while a song plays).
    addEventListener("wheel", (e) => menu && !menu.contains(e.target) && close(), { capture: true, passive: true });

    function item(label, run) {
      const b = el("button", "sgl-menu-item", label);
      b.type = "button";
      b.addEventListener("click", async () => {
        b.textContent = "Creating image…";
        try {
          await run();
          close();
        } catch (err) {
          SGL.log.warn("share", err.message);
          b.textContent = `Failed: ${err.message}`;
        }
      });
      return b;
    }

    // ln: the lyric line { text }, e: the contextmenu event (for placement), sub: a
    // translation shown under it, over: replaces parts of getInfo() (theme, source)
    function open(ln, e, sub, over) {
      close();
      const base = getInfo();
      if (!base) return;
      const info = { ...base, ...over };
      const data = { ...info, line: ln.text, sub };
      const name = `${info.artists[0]} - ${info.title}`.replace(/[\\/:*?"<>|]+/g, " ").trim();
      menu = el("div", "sgl-menu");
      menu.setAttribute("role", "menu");
      menu.append(
        el("div", "sgl-menu-title", "Share this line"),
        item("Copy as image", async () => {
          const blob = makeImage(data);
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          SGL.log.info("share", `copied "${ln.text}" as an image`, undefined, { forward: false });
        }),
        item("Save as image", async () => {
          const url = URL.createObjectURL(await makeImage(data));
          const a = el("a");
          a.href = url;
          a.download = `${name} - lyric.png`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 10000);
        })
      );
      // Inside our view when it's full screen (or nothing would show), else on the page.
      (document.fullscreenElement || document.body).append(menu);
      const r = menu.getBoundingClientRect();
      menu.style.left = `${Math.min(e.clientX, innerWidth - r.width - 8)}px`;
      menu.style.top = `${Math.min(e.clientY, innerHeight - r.height - 8)}px`;
    }

    return { open, close, makeImage };
  };
})();
