// Builds dist/musicmax-<version>.zip for the Chrome Web Store: only the files the
// extension loads (manifest, background/, content/, popup/, icons/, top-level *.css).
// No dependencies: the zip is written by hand (deflate from node:zlib).
// Run: npm run package
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { deflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const INCLUDE_DIRS = ["background", "content", "popup", "icons"];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export function listFiles() {
  const top = readdirSync(root).filter((f) => f === "manifest.json" || f.endsWith(".css")).map((f) => join(root, f));
  const files = [...top, ...INCLUDE_DIRS.flatMap((d) => walk(join(root, d)))];
  return files.map((f) => relative(root, f).split(sep).join("/")).filter((f) => !/(^|\/)\./.test(f)).sort();
}

// Every file the manifest and popup point at must be in the zip.
function checkReferences(files) {
  const m = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  const refs = [
    m.background.service_worker,
    m.action.default_popup,
    ...Object.values(m.icons),
    ...Object.values(m.action.default_icon),
    ...m.content_scripts.flatMap((c) => [...c.js, ...c.css]),
  ];
  const missing = refs.filter((r) => !files.includes(r));
  if (missing.length) throw new Error(`missing from the package: ${missing.join(", ")}`);
  return m;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(buf) {
  let c = ~0;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const DOS_TIME = 0;
  const DOS_DATE = (2026 - 1980) << 9 | 1 << 5 | 1; // fixed date: same files → same zip
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = listFiles();
  const { version } = checkReferences(files);
  const out = join(root, "dist", `musicmax-${version}.zip`);
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(out, zip(files.map((name) => ({ name, data: readFileSync(join(root, name)) }))));
  console.log(`${relative(root, out)}: ${files.length} files, ${(statSync(out).size / 1024).toFixed(1)} KB`);
}
