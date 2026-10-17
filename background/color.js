// Spotify tints its lyrics with colors derived from the cover: a dark, saturated
// background (rgb(101,0,0) for a red cover, rgb(48,54,60) for a black & white one) and a
// light tint of the same hue for lines that aren't being sung. We approximate that:
// find the dominant hue among colorful pixels, then fix the lightness.

// data: RGBA bytes (ImageData.data). Returns { h: 0..360, s: 0..1 }.
export function dominantHueSat(data) {
  const buckets = Array.from({ length: 12 }, () => ({ w: 0, x: 0, y: 0, s: 0 }));
  let greyX = 0;
  let greyY = 0;
  let colorful = 0;
  const total = data.length / 4;

  for (let i = 0; i < data.length; i += 4) {
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    const rad = (h * Math.PI) / 180;
    greyX += Math.cos(rad) * s;
    greyY += Math.sin(rad) * s;
    if (s < 0.25 || l < 0.12 || l > 0.9) continue;
    colorful++;
    const b = buckets[Math.floor(h / 30) % 12];
    const w = s * (1 - Math.abs(l - 0.5)); // favour vivid mid-tones
    b.w += w;
    b.x += Math.cos(rad) * w;
    b.y += Math.sin(rad) * w;
    b.s += s * w;
  }

  let h;
  let s;
  if (total && colorful / total > 0.08) {
    const best = buckets.reduce((a, b) => (b.w > a.w ? b : a));
    h = (Math.atan2(best.y, best.x) * 180) / Math.PI;
    s = Math.min(1, (best.s / best.w) * 1.4); // Spotify's tints are more saturated than the raw average
  } else {
    // Mostly black/white/grey cover: a slightly tinted grey.
    h = greyX || greyY ? (Math.atan2(greyY, greyX) * 180) / Math.PI : 210;
    s = 0.11;
  }
  return { h: (h + 360) % 360, s };
}

export function themeFrom({ h, s }) {
  return { bg: hslToRgb(h, s, 0.2), tint: hslToRgb(h, s, 0.84) };
}

export function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

export function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return `rgb(${f(0)}, ${f(8)}, ${f(4)})`;
}

// Browser-only part: decode the cover and sample it small.
export async function coverTheme(http, url) {
  const blob = await http.blob(url);
  const bitmap = await createImageBitmap(blob);
  const size = 32;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, size, size);
  return themeFrom(dominantHueSat(ctx.getImageData(0, 0, size, size).data));
}
