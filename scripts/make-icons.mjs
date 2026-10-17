// Draws the toolbar/store icons (icons/icon{16,32,48,128}.png) without any dependency:
// shapes are signed-distance functions on a 128-unit canvas, supersampled per pixel.
// Run: npm run icons
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const roundRect = (x, y, cx, cy, hw, hh, r) => {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const capsule = (x, y, cx, y1, y2, r) => Math.hypot(x - cx, y - clamp(y, y1, y2)) - r;

// White glyph: a microphone with its stand, and a "+".
function glyph(x, y) {
  const mic = capsule(x, y, 56, 36, 60, 16);
  const ring = Math.abs(Math.hypot(x - 56, y - 60) - 27) - 4;
  const arc = y < 60 ? Math.max(ring, 60 - y) : ring; // lower half of the ring only
  const stem = roundRect(x, y, 56, 94, 4, 8, 1);
  const base = roundRect(x, y, 56, 102, 16, 4, 4);
  const plus = Math.min(roundRect(x, y, 99, 33, 14, 4.5, 2), roundRect(x, y, 99, 33, 4.5, 14, 2));
  return Math.min(mic, arc, stem, base, plus);
}

// Background: rounded square, violet → pink diagonal gradient.
const A = [124, 58, 237];
const B = [236, 72, 153];
function pixel(x, y) {
  if (roundRect(x, y, 64, 64, 60, 60, 26) > 0) return null;
  if (glyph(x, y) <= 0) return [255, 255, 255];
  const t = clamp((x + y) / 256, 0, 1);
  return A.map((a, i) => a + (B[i] - a) * t);
}

// pad: transparent margin in pixels (the store wants 96×96 art inside the 128×128 icon).
function render(size, pad = 0, ss = 6) {
  const inner = size - 2 * pad;
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = pixel(((px - pad + (sx + 0.5) / ss) * 128) / inner, ((py - pad + (sy + 0.5) / ss) * 128) / inner);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; a++;
        }
      }
      const i = (py * size + px) * 4;
      if (a) [out[i], out[i + 1], out[i + 2]] = [r / a, g / a, b / a].map(Math.round);
      out[i + 3] = Math.round((a / (ss * ss)) * 255);
    }
  }
  return png(size, out);
}

function png(size, rgba) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
  });
  const crc = (buf) => {
    let c = ~0;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return ~c >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const dir = new URL("../icons/", import.meta.url);
mkdirSync(dir, { recursive: true });
for (const size of [16, 32, 48, 128]) writeFileSync(new URL(`icon${size}.png`, dir), render(size, size === 128 ? 16 : 0));
console.log("icons written");
