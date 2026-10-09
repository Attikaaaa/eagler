/* keep.js: keeps game saves safe.
   - asks the browser to never evict this site's storage
   - backs up every IndexedDB + localStorage of this origin into real files
     in a folder the user picks (File System Access API), keeps the last 3
   - falls back to download / upload of one file where that API does not exist
   Loaded by the launcher AND by every game page (same origin = same saves). */
(() => {
  const META = "keep-meta", KEEP = 3, PREFIX = "save-", SKIP = new Set([META]);
  const hasFS = "showDirectoryPicker" in window;

  const open = (name, ver, up) => new Promise((ok, no) => {
    const r = ver === undefined ? indexedDB.open(name) : indexedDB.open(name, ver);
    if (up) r.onupgradeneeded = () => up(r.result);
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  });
  const req = (r) => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  const meta = async () => open(META, 1, (d) => d.createObjectStore("h"));
  const getMeta = async (k) => { const d = await meta(); const v = await req(d.transaction("h").objectStore("h").get(k)); d.close(); return v; };
  const setMeta = async (k, v) => { const d = await meta(); const t = d.transaction("h", "readwrite"); t.objectStore("h").put(v, k); await new Promise((ok) => (t.oncomplete = ok)); d.close(); };

  // ---- value <-> JSON (binary as base64)
  const b64 = (buf) => { let s = ""; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
  const enc = async (v) => {
    if (v instanceof ArrayBuffer) return { $ab: b64(v) };
    if (ArrayBuffer.isView(v)) return { $ta: v.constructor.name, b: b64(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)) };
    if (v instanceof Blob) return { $blob: b64(await v.arrayBuffer()), t: v.type };
    if (v instanceof Date) return { $date: v.getTime() };
    if (Array.isArray(v)) return Promise.all(v.map(enc));
    if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v)) o[k] = await enc(v[k]); return o; }
    return v;
  };
  const dec = (v) => {
    if (Array.isArray(v)) return v.map(dec);
    if (v && typeof v === "object") {
      if ("$ab" in v) return unb64(v.$ab).buffer;
      if ("$ta" in v) { const u = unb64(v.b); return new (self[v.$ta] || Uint8Array)(u.buffer); }
      if ("$blob" in v) return new Blob([unb64(v.$blob)], { type: v.t });
      if ("$date" in v) return new Date(v.$date);
      const o = {}; for (const k of Object.keys(v)) o[k] = dec(v[k]); return o;
    }
    return v;
  };

  // ---- dump / load
  async function dump() {
    const out = { v: 1, at: Date.now(), ls: {}, idb: [] };
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); out.ls[k] = localStorage.getItem(k); }
    for (const { name } of await indexedDB.databases()) {
      if (!name || SKIP.has(name)) continue;
      const db = await open(name);
      const stores = [];
      for (const sn of Array.from(db.objectStoreNames)) {
        const st = db.transaction(sn).objectStore(sn);
        const entries = [];
        await new Promise((ok, no) => {
          const c = st.openCursor();
          c.onerror = () => no(c.error);
          c.onsuccess = async () => { const cur = c.result; if (!cur) return ok(); entries.push([cur.key, cur.value]); cur.continue(); };
        });
        stores.push({ name: sn, keyPath: st.keyPath, auto: st.autoIncrement, entries: await Promise.all(entries.map(async ([k, v]) => [await enc(k), await enc(v)])) });
      }
      out.idb.push({ name, version: db.version, stores });
      db.close();
    }
    return out;
  }
  const size = (d) => d.idb.reduce((n, x) => n + x.stores.reduce((m, s) => m + s.entries.length, 0), 0);

  async function load(d) {
    for (const [k, v] of Object.entries(d.ls || {})) if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
    for (const x of d.idb) {
      const db = await open(x.name, x.version, (db) => {
        for (const s of x.stores) if (!db.objectStoreNames.contains(s.name)) db.createObjectStore(s.name, s.keyPath != null ? { keyPath: s.keyPath, autoIncrement: s.auto } : { autoIncrement: s.auto });
      });
      for (const s of x.stores) {
        if (!db.objectStoreNames.contains(s.name)) continue;
        const t = db.transaction(s.name, "readwrite"), st = t.objectStore(s.name);
        for (const [k, v] of s.entries) { if (st.keyPath != null) st.put(dec(v)); else st.put(dec(v), dec(k)); }
        await new Promise((ok, no) => { t.oncomplete = ok; t.onerror = () => no(t.error); });
      }
      db.close();
    }
  }

  // ---- folder handling
  const stamp = () => new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  async function perm(h, ask) {
    const o = { mode: "readwrite" };
    if ((await h.queryPermission(o)) === "granted") return true;
    return ask ? (await h.requestPermission(o)) === "granted" : false;
  }
  async function folder() { const h = await getMeta("dir"); return h || null; }
  async function chooseFolder() {
    const h = await showDirectoryPicker({ id: "keep", mode: "readwrite" });
    await setMeta("dir", h); return h;
  }
  async function list(h) {
    const a = []; for await (const [n, e] of h.entries()) if (e.kind === "file" && n.startsWith(PREFIX)) a.push(n);
    return a.sort();
  }

  async function backup(ask) {
    const d = await dump(), n = size(d), last = (await getMeta("last")) || { n: 0 };
    // never let an empty/shrunken state overwrite a good backup
    if (n === 0 || n < last.n * 0.5) return { ok: false, reason: "shrunk", n, prev: last.n };
    const h = await folder();
    if (!h || !(await perm(h, ask))) return { ok: false, reason: "no-folder" };
    const name = PREFIX + stamp() + ".json";
    const w = await (await h.getFileHandle(name, { create: true })).createWritable();
    await w.write(JSON.stringify(d)); await w.close();
    const all = await list(h);
    for (const old of all.slice(0, Math.max(0, all.length - KEEP))) await h.removeEntry(old);
    await setMeta("last", { n, at: Date.now(), name });
    return { ok: true, n, name };
  }

  async function restore(ask) {
    const h = await folder();
    if (!h || !(await perm(h, ask))) return { ok: false, reason: "no-folder" };
    const all = await list(h);
    if (!all.length) return { ok: false, reason: "empty" };
    const f = await (await h.getFileHandle(all[all.length - 1])).getFile();
    await load(JSON.parse(await f.text()));
    return { ok: true, name: all[all.length - 1] };
  }

  // ---- manual file fallback
  async function download() {
    const d = await dump();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(d)], { type: "application/json" }));
    a.download = PREFIX + stamp() + ".json"; a.click();
    return { ok: true, n: size(d) };
  }
  async function upload(file) { await load(JSON.parse(await file.text())); return { ok: true }; }

  // ---- automatic: persist + periodic/leave backup (only when permission already granted)
  async function persist() { try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch { return false; } }
  async function status() {
    const h = await folder(); const last = await getMeta("last");
    return { fs: hasFS, persisted: navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false, folder: h ? h.name : null, granted: h ? await perm(h, false) : false, last: last || null };
  }
  let busy = false;
  const quiet = async () => { if (busy) return; busy = true; try { await backup(false); } catch (e) { console.warn("keep:", e); } busy = false; };
  function auto() {
    persist();
    setInterval(quiet, 3 * 60 * 1000);
    document.addEventListener("visibilitychange", () => { if (document.hidden) quiet(); });
    addEventListener("pagehide", quiet);
  }

  window.Keep = { hasFS, persist, status, chooseFolder, backup, restore, download, upload, auto };
  auto();
})();
