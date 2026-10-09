// Turns an uploaded world (.epk from Eaglercraft 1.8.8, or a vanilla world .zip) into Paper world folders.
// usage: node importworld.mjs <file> <epk|zip> <serverDir>
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import os from "node:os";
import { execFileSync } from "node:child_process";

const MAX_DATA_VERSION = 1343; // Minecraft 1.12.2

// ---- minimal NBT reader (only what we need: ints inside Level / DataVersion)
export function readNbt(buf) {
  let p = 0;
  const str = () => { const n = buf.readUInt16BE(p); p += 2; const s = buf.toString("utf8", p, p + n); p += n; return s; };
  const payload = (t) => {
    switch (t) {
      case 1: return buf.readInt8(p++);
      case 2: { const v = buf.readInt16BE(p); p += 2; return v; }
      case 3: { const v = buf.readInt32BE(p); p += 4; return v; }
      case 4: { const v = buf.readBigInt64BE(p); p += 8; return v; }
      case 5: { p += 4; return 0; }
      case 6: { p += 8; return 0; }
      case 7: { const n = buf.readInt32BE(p); p += 4 + n; return null; }
      case 8: return str();
      case 9: { const it = buf.readInt8(p++); const n = buf.readInt32BE(p); p += 4; const a = []; for (let i = 0; i < n; i++) a.push(payload(it)); return a; }
      case 10: { const o = {}; for (;;) { const tt = buf.readInt8(p++); if (!tt) break; const k = str(); o[k] = payload(tt); } return o; }
      case 11: { const n = buf.readInt32BE(p); p += 4 + n * 4; return null; }
      case 12: { const n = buf.readInt32BE(p); p += 4 + n * 8; return null; }
      default: throw new Error("bad NBT tag " + t);
    }
  };
  const t = buf.readInt8(p++); if (t !== 10) throw new Error("NBT root is not a compound");
  str(); return payload(10);
}
const gunzipMaybe = (b) => (b[0] === 0x1f && b[1] === 0x8b ? zlib.gunzipSync(b) : b);

// ---- EPK container
export function readEpk(buf) {
  if (buf.subarray(0, 8).toString("latin1") === "EAGPKG!!") throw new Error("This EPK is an old unsupported format.");
  if (buf.subarray(0, 8).toString("latin1") !== "EAGPKG$$") throw new Error("This is not an EPK file.");
  if (buf.subarray(buf.length - 8).toString("latin1") !== ":::YEE:>") throw new Error("EPK file is incomplete (missing end marker).");
  let b = buf.subarray(8, buf.length - 8), p = 0;
  const ascii = () => { const n = b[p++]; const s = b.toString("latin1", p, p + n); p += n; return s; };
  const ver = ascii(); if (!ver.startsWith("ver2.")) throw new Error("Unknown EPK version " + ver);
  p += b[p] + 1; p += b.readUInt16BE(p) + 2; p += 8;
  let numFiles = b.readInt32BE(p); p += 4;
  const comp = String.fromCharCode(b[p++]);
  let body = b.subarray(p);
  if (comp === "G") body = zlib.gunzipSync(body); else if (comp === "Z") body = zlib.inflateSync(body); else if (comp !== "0") throw new Error("Unsupported EPK compression " + comp);
  const files = []; p = 0;
  const u32 = () => { const v = body.readInt32BE(p); p += 4; return v; };
  while (numFiles > 0) {
    const type = body.toString("latin1", p, p + 4); p += 4;
    const name = (() => { const n = body[p++]; const s = body.toString("latin1", p, p + n); p += n; return s; })();
    const len = u32();
    let data;
    if (type === "FILE") { p += 4; data = body.subarray(p, p + len - 5); p += len - 4; } // skip crc, data, ':'
    else { data = body.subarray(p, p + len); p += len; }
    if (body[p++] !== 0x3e) throw new Error(`EPK entry '${name}' is damaged`);
    files.push({ type, name, data }); numFiles--;
  }
  return files;
}

// ---- Anvil region writer
function writeRegions(chunks, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const regions = new Map();
  for (const c of chunks) { const k = `${c.x >> 5},${c.z >> 5}`; (regions.get(k) ?? regions.set(k, []).get(k)).push(c); }
  for (const [k, list] of regions) {
    const [rx, rz] = k.split(",").map(Number);
    const header = Buffer.alloc(8192), parts = []; let sector = 2;
    for (const c of list) {
      const z = zlib.deflateSync(c.nbt);
      const rec = Buffer.alloc(5 + z.length); rec.writeInt32BE(z.length + 1, 0); rec[4] = 2; z.copy(rec, 5);
      const sectors = Math.ceil(rec.length / 4096), idx = 4 * ((c.x & 31) + (c.z & 31) * 32);
      header.writeUInt32BE((sector << 8) | sectors, idx); header.writeUInt32BE(Math.floor(Date.now() / 1000), 4096 + idx);
      const padded = Buffer.alloc(sectors * 4096); rec.copy(padded); parts.push(padded); sector += sectors;
    }
    fs.writeFileSync(path.join(outDir, `r.${rx}.${rz}.mca`), Buffer.concat([header, ...parts]));
  }
  return chunks.length;
}

function check(levelDat) {
  const d = readNbt(gunzipMaybe(levelDat)).Data;
  if (d?.DataVersion > MAX_DATA_VERSION) throw new Error(`This world is from a newer Minecraft (data version ${d.DataVersion}). The server runs 1.12.2, worlds from newer versions cannot be loaded.`);
}

function resetWorld(dir) { for (const w of ["world", "world_nether", "world_the_end"]) fs.rmSync(path.join(dir, w), { recursive: true, force: true }); }

const DIMS = { minecraft_overworld: "overworld", minecraft_the_nether: "the_nether", minecraft_the_end: "the_end" };
// 26.x EPK: chunk files are named <x+1900000><z+1900000> in hex (6+6 digits); dimension folders become world/dimensions/minecraft/<dim>
function importEpk262(files, dir) {
  const level = files.find((f) => f.type === "FILE" && f.name === "level.dat");
  if (!level) throw new Error("The world has no level.dat.");
  resetWorld(dir);
  const w = path.join(dir, "world"), put = (rel, data) => { const f = path.join(w, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };
  const regions = {}; let n = 0, other = 0;
  for (const f of files) {
    if (f.type !== "FILE") continue;
    let m;
    if ((m = f.name.match(/^(minecraft_\w+)\/(chunk|entities|poi)\/([0-9a-f]{12})$/)) && DIMS[m[1]]) {
      const x = parseInt(m[3].slice(0, 6), 16) - 1900000, z = parseInt(m[3].slice(6), 16) - 1900000;
      const kind = m[2] === "chunk" ? "region" : m[2], key = `dimensions/minecraft/${DIMS[m[1]]}/${kind}`;
      (regions[key] ??= []).push({ x, z, nbt: gunzipMaybe(f.data) }); if (kind === "region") n++;
    } else if ((m = f.name.match(/^(minecraft_\w+)\/data\/(.+)$/)) && DIMS[m[1]]) { put(`dimensions/minecraft/${DIMS[m[1]]}/data/${m[2]}`, f.data); other++; }
    else if (/^(data|players)\//.test(f.name) || f.name === "level.dat") { put(f.name, f.data); other++; }
  }
  if (!n) throw new Error("The world contains no chunks.");
  for (const [rel, list] of Object.entries(regions)) writeRegions(list, path.join(w, rel));
  return `Imported ${n} chunks and ${other} data files from the 26.2 EPK. Join with the same player name as in singleplayer to get your inventory and position.`;
}

export function importEpk(file, dir, modern = false) {
  const files = readEpk(fs.readFileSync(file));
  const head = files.find((f) => f.type === "HEAD" && f.name === "file-type")?.data.toString("latin1");
  if (head === "epk/world152") throw new Error("This is a 1.5.2 world. Only 1.8.8 and 1.12 worlds are supported.");
  if (head === "epk/world262") { if (!modern) throw new Error("This is a 26.2 world. Create a Minecraft 26.2 server to use it."); return importEpk262(files, dir); }
  if (head !== "epk/world188") throw new Error("This EPK is not a singleplayer world export.");
  if (modern) throw new Error("This is a 1.12.2/1.8 world. Create a 1.12.2 server to use it.");
  const level = files.find((f) => f.type === "FILE" && f.name === "level.dat");
  if (!level) throw new Error("The world has no level.dat.");
  check(level.data);
  const dims = { "level0": [], "level1": [], "level-1": [] };
  for (const f of files) {
    const m = f.type === "FILE" && f.name.match(/^(level-?\d+)\/.*\.dat$/);
    if (!m || !dims[m[1]]) continue;
    try { const raw = gunzipMaybe(f.data); const lv = readNbt(raw).Level; dims[m[1]].push({ x: lv.xPos, z: lv.zPos, nbt: raw }); } catch { /* skip damaged chunk */ }
  }
  if (!dims.level0.length) throw new Error("The world contains no chunks.");
  resetWorld(dir);
  fs.mkdirSync(path.join(dir, "world"), { recursive: true });
  fs.writeFileSync(path.join(dir, "world/level.dat"), level.data);
  const n = writeRegions(dims.level0, path.join(dir, "world/region"))
    + writeRegions(dims["level-1"], path.join(dir, "world_nether/DIM-1/region"))
    + writeRegions(dims.level1, path.join(dir, "world_the_end/DIM1/region"));
  return `Imported ${n} chunks from the EPK.`;
}

export function importZip(file, dir, modern = false) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "w-"));
  execFileSync("unzip", ["-q", "-o", file, "-d", tmp]);
  let root = null; const stack = [[tmp, 0]];
  while (stack.length) { const [d, depth] = stack.shift(); if (fs.existsSync(path.join(d, "level.dat"))) { root = d; break; } if (depth < 4) for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) stack.push([path.join(d, e.name), depth + 1]); }
  if (!root) throw new Error("No level.dat found in the zip. Zip the world folder (the one that contains level.dat).");
  if (modern && !fs.existsSync(path.join(root, "dimensions"))) throw new Error("This world uses the old folder layout. Open it once in Minecraft 26.2, export it again (.epk or zip) and upload that.");
  if (!modern) check(fs.readFileSync(path.join(root, "level.dat")));
  resetWorld(dir);
  const w = path.join(dir, "world"); fs.mkdirSync(w, { recursive: true });
  for (const e of fs.readdirSync(root)) {
    const src = path.join(root, e);
    if (e === "DIM-1") { fs.mkdirSync(path.join(dir, "world_nether"), { recursive: true }); fs.cpSync(src, path.join(dir, "world_nether/DIM-1"), { recursive: true }); }
    else if (e === "DIM1") { fs.mkdirSync(path.join(dir, "world_the_end"), { recursive: true }); fs.cpSync(src, path.join(dir, "world_the_end/DIM1"), { recursive: true }); }
    else if (e !== "session.lock") fs.cpSync(src, path.join(w, e), { recursive: true });
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  return "Imported the vanilla world.";
}

if (process.argv[1]?.endsWith("importworld.mjs")) {
  const [, , file, kind, dir] = process.argv;
  console.log(kind === "epk" ? importEpk(file, dir, process.argv[5] === "26") : importZip(file, dir, process.argv[5] === "26"));
}
