export const REPO = "Attikaaaa/eagler";
export const TK = "eagler-gh-token";

export type Settings = Partial<{ motd: string; maxPlayers: number; difficulty: string; gamemode: string; pvp: boolean; viewDistance: number; whitelist: boolean; allowNether: boolean; monsters: boolean; animals: boolean; spawnProtection: number; seed: string; forceGamemode: boolean; commandBlocks: boolean; ramGb: number; plugins: string[] }>;
export type Metrics = { cpu: number; memUsedMb: number; memTotalMb: number; jvmMb: number; diskUsedGb: number; diskTotalGb: number; load1: number; hist: { cpu: number; mem: number }[]; ts: number };
export type Srv = {
  id: string; name: string; version: string; want: string; status: string; sha: string;
  address?: string | null; addresses?: Record<string, string>; players?: number; playerNames?: string[];
  note?: string; error?: string; updated?: number; startedAt?: number; settings?: Settings; always?: boolean; host?: { cpus: number; totalGb: number; ramGb: number };
  metrics?: Metrics;
  liveUrl?: string | null;
  importPending?: { name: string; kind: string; size: number } | null;
  importResult?: { ok: boolean; msg: string; name: string; at: number };
};

export const token = () => localStorage.getItem(TK) || "";
// With a token the site talks to GitHub directly; without one it goes through the gateway (an allow-listed proxy running in Actions).
let gw: { url: string; at: number } | null = null;
export async function apiBase(): Promise<string> {
  if (token()) return "https://api.github.com";
  if (gw && Date.now() - gw.at < 30e3) return gw.url;
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/data/gateway.json?t=${Math.floor(Date.now() / 20e3)}`, { cache: "no-store" });
    const j = await r.json() as { url: string; ts: number };
    if (j.url && Date.now() - j.ts < 5 * 60e3) { const ok = await fetch(`${j.url}/ping`, { cache: "no-store" }).then((x) => x.ok).catch(() => false); if (ok) { gw = { url: `${j.url}/gh`, at: Date.now() }; return gw.url; } }
  } catch { /* fall through */ }
  gw = null;
  throw new Error("The control service is starting up (it takes about a minute). Try again shortly.");
}
export const gh = async (p: string, o: RequestInit = {}) => {
  for (let i = 0; ; i++) {
    try {
      const base = await apiBase();
      return await fetch(`${base}/repos/${REPO}/${p}`, { cache: "no-store", ...o, headers: { ...(token() ? { Authorization: `Bearer ${token()}` } : {}), Accept: "application/vnd.github+json" } });
    } catch (e) { if (i >= 3) throw e; gw = null; await new Promise((ok) => setTimeout(ok, 800 * (i + 1))); } // network blip or the gateway moved: look it up again
  }
};
const b64 = (o: unknown) => btoa(unescape(encodeURIComponent(JSON.stringify(o, null, 1))));
const unb64 = (s: string) => JSON.parse(decodeURIComponent(escape(atob(s.replace(/\n/g, "")))));

export async function getJson<T>(path: string): Promise<{ data: T; sha: string } | null> {
  const r = await gh(`contents/${path}?ref=data`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(r.status === 401 ? "Token rejected by GitHub" : `GitHub error ${r.status}`);
  const j = await r.json();
  return { data: unb64(j.content) as T, sha: j.sha };
}
export async function listServers(): Promise<Srv[]> {
  const r = await gh("contents/servers?ref=data");
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(r.status === 401 ? "Token rejected by GitHub" : `GitHub error ${r.status}`);
  const files = ((await r.json()) as { path: string; name: string }[]).filter((f) => f.name.endsWith(".json"));
  const out = await Promise.all(files.map(async (f) => { const x = await getJson<Srv>(f.path); return x ? { ...x.data, sha: x.sha } : null; }));
  return (out.filter(Boolean) as Srv[]).sort((a, b) => a.name.localeCompare(b.name));
}
export const getServer = async (id: string) => { const x = await getJson<Srv>(`servers/${id}.json`); return x ? ({ ...x.data, sha: x.sha } as Srv) : null; };
export async function saveServer(s: Partial<Srv> & { id: string }, msg = "update") {
  // merge onto the newest copy; the runner writes the same file, so retry on sha conflicts
  const { sha: _a, ...patch } = s as Srv; void _a;
  for (let i = 0; i < 8; i++) {
    const cur = await getJson<Srv>(`servers/${s.id}.json`);
    const next = { ...(cur?.data ?? {}), ...patch, updated: Date.now() };
    const r = await gh(`contents/servers/${s.id}.json`, { method: "PUT", body: JSON.stringify({ message: `${msg} ${s.id}`, branch: "data", content: b64(next), ...(cur ? { sha: cur.sha } : {}) }) });
    if (r.ok) return;
    if (r.status !== 409 && r.status !== 422) throw new Error(`Save failed (${r.status})`);
    await new Promise((ok) => setTimeout(ok, 300 + Math.random() * 700));
  }
  throw new Error("Save failed: the server is busy, try again in a moment");
}
export const dispatch = (id: string, action = "run") =>
  gh("actions/workflows/server.yml/dispatches", { method: "POST", body: JSON.stringify({ ref: "main", inputs: { id, action } }) });

export async function sendCommand(id: string, cmd: string) {
  const path = `cmd/${id}.json`;
  for (let i = 0; i < 4; i++) {
    const cur = await getJson<{ n: number; items: { n: number; cmd: string }[] }>(path);
    const n = (cur?.data.n ?? 0) + 1;
    const items = [...(cur?.data.items ?? []), { n, cmd }].slice(-30);
    const r = await gh(`contents/${path}`, { method: "PUT", body: JSON.stringify({ message: `cmd ${id}`, branch: "data", content: b64({ n, items }), ...(cur ? { sha: cur.sha } : {}) }) });
    if (r.ok) return;
  }
  throw new Error("Could not send command");
}
export const getConsole = (id: string) => getJson<{ lines: string[]; updated: number }>(`console/${id}.json`);

export async function worldBackups(id: string) {
  const r = await gh("releases/tags/data");
  if (!r.ok) return [];
  const j = await r.json();
  return (j.assets as { name: string; size: number; updated_at: string; browser_download_url: string }[]).filter((a) => a.name.startsWith(`world-${id}-`)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function deleteServerFile(id: string) {
  for (let i = 0; i < 6; i++) {
    const cur = await getJson<Srv>(`servers/${id}.json`);
    if (!cur) return;
    const r = await gh(`contents/servers/${id}.json`, { method: "DELETE", body: JSON.stringify({ message: `delete ${id}`, branch: "data", sha: cur.sha }) });
    if (r.ok) return;
    await new Promise((ok) => setTimeout(ok, 400));
  }
  throw new Error("Delete failed, try again");
}

const readB64 = (f: File) => new Promise<string>((ok, no) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(",")[1] ?? "");
  r.onerror = () => no(r.error);
  r.readAsDataURL(f);
});
/** POST with real upload progress (fetch cannot report it). Resolves with status and parsed body. */
async function postWithProgress(path: string, body: string, onPct: (p: number) => void, signal: { abort?: () => void }) {
  const base = await apiBase();
  return new Promise<{ status: number; json: { sha?: string } }>((ok, no) => {
    const x = new XMLHttpRequest();
    x.open("POST", `${base}/repos/${REPO}/${path}`);
    if (token()) x.setRequestHeader("Authorization", `Bearer ${token()}`);
    x.setRequestHeader("Accept", "application/vnd.github+json");
    x.timeout = 10 * 60e3;
    x.upload.onprogress = (e) => e.lengthComputable && onPct(Math.round((e.loaded / e.total) * 100));
    x.onload = () => { let json = {}; try { json = JSON.parse(x.responseText); } catch { /* ignore */ } ok({ status: x.status, json }); };
    x.onerror = () => no(new Error("Network error during upload")); x.ontimeout = () => no(new Error("Upload timed out"));
    x.onabort = () => no(new Error("Upload cancelled"));
    signal.abort = () => x.abort();
    x.send(body);
  });
}
/** Puts an already uploaded blob into the data branch. Only this short step touches the busy branch, so a collision just retries. */
async function commitBlob(path: string, blob: string, message: string) {
  for (let i = 0; i < 12; i++) {
    const head = ((await (await gh("git/ref/heads/data")).json()) as { object: { sha: string } }).object.sha;
    const cm = (await (await gh(`git/commits/${head}`)).json()) as { tree: { sha: string } };
    const tr = await gh("git/trees", { method: "POST", body: JSON.stringify({ base_tree: cm.tree.sha, tree: [{ path, mode: "100644", type: "blob", sha: blob }] }) });
    if (!tr.ok) throw new Error(`Upload failed (${tr.status})`);
    const cr = await gh("git/commits", { method: "POST", body: JSON.stringify({ message, tree: ((await tr.json()) as { sha: string }).sha, parents: [head] }) });
    if (!cr.ok) throw new Error(`Upload failed (${cr.status})`);
    const up = await gh("git/refs/heads/data", { method: "PATCH", body: JSON.stringify({ sha: ((await cr.json()) as { sha: string }).sha, force: false }) });
    if (up.ok) return;
    if (up.status !== 422 && up.status !== 409) throw new Error(`Upload failed (${up.status})`);
    await new Promise((res) => setTimeout(res, 150 + Math.random() * 400));
  }
  throw new Error("The server was busy writing, please try again.");
}
export async function uploadWorld(id: string, file: File, onStep: (s: string, pct?: number) => void, signal: { abort?: () => void } = {}) {
  const kind = /\.epk$/i.test(file.name) ? "epk" : /\.zip$/i.test(file.name) ? "zip" : "";
  if (!kind) throw new Error("Choose an .epk (singleplayer world export) or a .zip (vanilla world folder).");
  if (file.size > 70e6) throw new Error(`The file is ${(file.size / 1e6).toFixed(0)} MB, the limit is about 70 MB.`);
  onStep(`Reading ${(file.size / 1e6).toFixed(1)} MB...`);
  const content = await readB64(file);
  const path = `uploads/${id}.bin`;
  let blob = "";
  for (let attempt = 1; attempt <= 4 && !blob; attempt++) {
    onStep(attempt > 1 ? `Uploading (try ${attempt})...` : "Uploading...", 0);
    const r = await postWithProgress("git/blobs", JSON.stringify({ content, encoding: "base64" }), (p) => onStep("Uploading...", p), signal);
    if (r.status === 201 && r.json.sha) blob = r.json.sha;
    else if (r.status === 401 || r.status === 403 || r.status === 404) throw new Error(`The upload was refused (${r.status}).`);
    else await new Promise((res) => setTimeout(res, 800 * attempt));
  }
  if (!blob) throw new Error("The upload failed, please try again.");
  onStep("Saving...", 100);
  await commitBlob(path, blob, `upload ${id}`);
  await saveServer({ id, importPending: { name: file.name, kind, size: file.size }, importResult: undefined }, "import");
}
