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
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (!k.startsWith("eagler-gh")) out.ls[k] = localStorage.getItem(k); }
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
        for (const [k, v] of s.entries) {
          if (st.keyPath == null) { st.put(dec(v), dec(k)); continue; }
          const val = dec(v);
          if (val && val.path === "options.txt") continue; // per-device settings stay as they are
          if (val && val.path === "worlds_list.txt") { // world list: union of both devices
            const old = await req(st.get([val.path])), dc = new TextDecoder();
            if (old) { const names = [...new Set((dc.decode(old.data) + "\n" + dc.decode(val.data)).split("\n").map((x) => x.trim()).filter(Boolean))]; val.data = new TextEncoder().encode(names.join("\n")).buffer; }
          }
          st.put(val);
        }
        await new Promise((ok, no) => { t.oncomplete = ok; t.onerror = () => no(t.error); });
      }
      db.close();
    }
  }


  // ---- cloud sync: the whole save set as one gzip file on the repo's `data` branch (needs the GitHub token from the Servers page)
  const REPO = "Attikaaaa/eagler", CF = "sync/saves.json.gz";
  const tk = () => localStorage.getItem("eagler-gh-token");
  let gwc = null; // the gateway (token-free access), found through gateway.json on the data branch
  async function apiBase() {
    if (tk()) return "https://api.github.com";
    if (gwc && Date.now() - gwc.at < 30000) return gwc.url;
    try {
      const j = await (await fetch(`https://raw.githubusercontent.com/${REPO}/data/gateway.json?t=${Math.floor(Date.now() / 20000)}`, { cache: "no-store" })).json();
      if (j.url && Date.now() - j.ts < 300000 && (await fetch(j.url + "/ping", { cache: "no-store" })).ok) { gwc = { url: j.url + "/gh", at: Date.now() }; return gwc.url; }
    } catch {}
    gwc = null; return "https://api.github.com";
  }
  const canWrite = async () => !!tk() || (await apiBase()).endsWith("/gh");
  // union of two snapshots; on shared keys `local` wins. The world list is merged line by line.
  function mergeSnap(remote, local) {
    const out = { v: 1, at: Date.now(), ls: { ...(remote.ls || {}), ...(local.ls || {}) }, idb: [] }, dbs = new Map(), td = new TextDecoder();
    const lines = (v) => td.decode(unb64(v.data.$ab)).split("\n").map((x) => x.trim()).filter((x) => x && x !== "synctest");
    for (const src of [remote, local]) for (const x of src.idb) {
      let db = dbs.get(x.name); if (!db) dbs.set(x.name, (db = { name: x.name, version: x.version, stores: new Map() }));
      db.version = Math.max(db.version, x.version);
      for (const s of x.stores) {
        let st = db.stores.get(s.name); if (!st) db.stores.set(s.name, (st = { name: s.name, keyPath: s.keyPath, auto: s.auto, entries: new Map() }));
        for (const [k, v] of s.entries) {
          const id = JSON.stringify(k), path = v && v.path;
          if (typeof path === "string" && path.startsWith("worlds/synctest/")) continue; // leftovers of a sync test
          let val = v;
          if (path === "worlds_list.txt" && v.data && v.data.$ab) { const old = st.entries.get(id); const all = [...new Set([...(old ? lines(old[1]) : []), ...lines(v)])]; val = { ...v, data: { $ab: b64(new TextEncoder().encode(all.join("\n")).buffer) } }; }
          st.entries.set(id, [k, val]);
        }
      }
    }
    for (const db of dbs.values()) out.idb.push({ name: db.name, version: db.version, stores: [...db.stores.values()].map((st) => ({ name: st.name, keyPath: st.keyPath, auto: st.auto, entries: [...st.entries.values()] })) });
    return out;
  }
  const ghx = async (p, o = {}) => { for (let i = 0; ; i++) { try { return await fetch(`${await apiBase()}/repos/${REPO}/${p}`, { cache: "no-store", ...o, headers: { ...(tk() ? { Authorization: "Bearer " + tk() } : {}), Accept: "application/vnd.github+json", ...o.headers } }); } catch (e) { if (i >= 3) throw e; gwc = null; await new Promise((ok) => setTimeout(ok, 800 * (i + 1))); } } };
  const gz = async (str) => new Uint8Array(await new Response(new Blob([str]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
  const gunz = (buf) => new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
  const hashOf = async (d) => { const { at, ...rest } = d; const h = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(JSON.stringify(rest))); return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, "0")).join(""); };
  async function remoteSha(path = CF) { const r = await ghx(`contents/${path}?ref=data`); if (r.status === 404) return null; if (!r.ok) throw new Error("cloud " + r.status); return (await r.json()).sha; }
  async function putFile(path, bytes, sha) {
    for (let i = 0; i < 4; i++) {
      const r = await ghx(`contents/${path}`, { method: "PUT", body: JSON.stringify({ message: "sync saves", branch: "data", content: b64(bytes), ...(sha ? { sha } : {}) }) });
      if (r.ok) return (await r.json()).content.sha;
      if (r.status !== 409 && r.status !== 422) throw new Error("cloud upload " + r.status);
      await new Promise((ok) => setTimeout(ok, 600 + Math.random() * 900)); sha = await remoteSha(path);
    }
    throw new Error("cloud busy");
  }
  // startup pull: remote snapshot is newer than what this browser last saw -> merge it in (before the game opens its storage)
  async function cloudPull() { // reading needs no token (public repo); only uploading does
    const sha = await remoteSha(), c = (await getMeta("cloud")) || {};
    if (!sha || (sha === c.sha && !c.needPull)) return { ok: true, changed: false };
    const here = await dump();
    const unsynced = size(here) > 0 && !!c.sha && c.hash !== (await hashOf(here)); // this browser has changes the cloud has not seen
    const r = await ghx(`contents/${CF}?ref=data`, { headers: { Accept: "application/vnd.github.raw+json" } });
    if (!r.ok) throw new Error("cloud download " + r.status);
    const d = JSON.parse(await gunz(await r.arrayBuffer()));
    const use = unsynced ? mergeSnap(d, here) : d; // local changes win, everything else is added
    loading = true; try { await load(use); } finally { loading = false; }
    await setMeta("cloud", { sha, hash: unsynced ? undefined : await hashOf(await dump()), at: Date.now() });
    return { ok: true, changed: true, n: size(d) };
  }
  async function cloudPush() {
    if (!(await canWrite())) return { ok: false, reason: "no-token" };
    const d = await dump(), n = size(d), last = (await getMeta("last")) || { n: 0 }, c = (await getMeta("cloud")) || {};
    if (n === 0 || n < last.n * 0.5) return { ok: false, reason: "shrunk", n, prev: last.n };
    const hash = await hashOf(d);
    if (c.hash === hash) return { ok: true, same: true };
    const bytes = await gz(JSON.stringify(d));
    if (bytes.length > 70e6) return { ok: false, reason: "too-big" };
    const sha = await remoteSha();
    if (sha && c.sha && sha !== c.sha) { // another device saved in between: merge its saves with ours instead of overwriting
      const r = await ghx(`contents/${CF}?ref=data`, { headers: { Accept: "application/vnd.github.raw+json" } });
      if (!r.ok) throw new Error("cloud download " + r.status);
      const mb = await gz(JSON.stringify(mergeSnap(JSON.parse(await gunz(await r.arrayBuffer())), d)));
      if (mb.length > 70e6) return { ok: false, reason: "too-big" };
      const ns = await putFile(CF, mb, sha);
      await setMeta("cloud", { sha: ns, hash, at: Date.now(), needPull: true });
      return { ok: true, n, mb: +(mb.length / 1e6).toFixed(1), merged: true };
    }
    const nsha = await putFile(CF, bytes, sha);
    await setMeta("cloud", { sha: nsha, hash, at: Date.now() });
    return { ok: true, n, mb: +(bytes.length / 1e6).toFixed(1) };
  }
  const cloudStatus = async () => ({ token: true, last: (await getMeta("cloud")) || null });

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
  const quiet = async () => { if (busy) return; busy = true; try { await backup(false); } catch (e) { console.warn("keep:", e); } try { if (cloudReady) await cloudPush(); } catch (e) { console.warn("keep cloud:", e); } busy = false; };
  let cloudReady = false, loading = false;
  // small status line so you can see whether this device uploads
  const note = (t) => { try { let e = document.getElementById("keep-note"); if (!e) { e = document.createElement("div"); e.id = "keep-note"; e.style.cssText = "position:fixed;left:6px;bottom:4px;z-index:99999;font:11px monospace;color:#fff;background:#0008;padding:1px 5px;pointer-events:none;opacity:.7"; (document.body || document.documentElement).appendChild(e); } e.textContent = "cloud: " + t; } catch {} };
  // push shortly after the game stops writing its world (saving / leaving a world), not only every few minutes
  let pushTimer = 0, pushing = false;
  async function pushNow() {
    if (pushing) { pushTimer = setTimeout(pushNow, 2000); return; }
    if (!(await canWrite())) { note("cloud service is starting, will retry"); pushTimer = setTimeout(pushNow, 15000); return; }
    if (!cloudReady) { pushTimer = setTimeout(pushNow, 3000); return; }
    pushing = true; note("uploading...");
    try { const r = await cloudPush(); note(r.ok ? (r.merged ? "merged with other device " : "saved ") + new Date().toLocaleTimeString() : "not uploaded (" + r.reason + ")"); } catch (e) { note("upload failed"); console.warn("keep cloud:", e); }
    pushing = false;
  }
  const IOS = IDBObjectStore.prototype;
  for (const m of ["put", "add", "delete", "clear"]) {
    const orig = IOS[m];
    IOS[m] = function (...a) {
      const k = m === "delete" ? (Array.isArray(a[0]) ? a[0][0] : a[0]) : m === "clear" ? "worlds/" : a[0] && a[0].path; // only world files count
      if (!loading && this.transaction && /PlatformFilesystem/.test(this.transaction.db.name) && typeof k === "string" && k.startsWith("worlds/")) { clearTimeout(pushTimer); pushTimer = setTimeout(pushNow, 1200); }
      return orig.apply(this, a);
    };
  }
  function auto() {
    persist();
    // pull first; the game page reloads once if it merged something new, so the game starts on the merged saves
    cloudPull().then((r) => {
      cloudReady = true; note("synced " + new Date().toLocaleTimeString());
      if (r.changed && location.pathname.includes("/play/") && Date.now() - Number(sessionStorage.getItem("keep-reload") || 0) > 60000) { sessionStorage.setItem("keep-reload", Date.now()); location.reload(); }
    }).catch((e) => { console.warn("keep cloud:", e); cloudReady = false; });
    setInterval(quiet, 3 * 60 * 1000);
    document.addEventListener("visibilitychange", () => { if (document.hidden) { quiet(); pushNow(); } });
    addEventListener("pagehide", quiet);
  }

  window.Keep = { hasFS, persist, status, chooseFolder, backup, restore, download, upload, auto, cloud: { dump, publish: async (d) => { const bytes = await gz(JSON.stringify(d)); const sha = await remoteSha(); const nsha = await putFile(CF, bytes, sha); await setMeta("cloud", { sha: nsha, hash: await hashOf(await dump()), at: Date.now() }); return { ok: true, mb: +(bytes.length / 1e6).toFixed(1) }; }, pull: cloudPull, push: async () => { const r = await cloudPush(); return r; }, status: cloudStatus } };
  auto();
})();
