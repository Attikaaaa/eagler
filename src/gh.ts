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
export const gh = (p: string, o: RequestInit = {}) =>
  fetch(`https://api.github.com/repos/${REPO}/${p}`, { cache: "no-store", ...o, headers: { Authorization: `Bearer ${token()}`, Accept: "application/vnd.github+json" } });
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
/** PUT with real upload progress (fetch cannot report it). Resolves with the HTTP status. */
function putWithProgress(path: string, body: string, onPct: (p: number) => void, signal: { abort?: () => void }) {
  return new Promise<number>((ok, no) => {
    const x = new XMLHttpRequest();
    x.open("PUT", `https://api.github.com/repos/${REPO}/contents/${path}`);
    x.setRequestHeader("Authorization", `Bearer ${token()}`); x.setRequestHeader("Accept", "application/vnd.github+json");
    x.timeout = 10 * 60e3;
    x.upload.onprogress = (e) => e.lengthComputable && onPct(Math.round((e.loaded / e.total) * 100));
    x.onload = () => ok(x.status); x.onerror = () => no(new Error("Network error during upload")); x.ontimeout = () => no(new Error("Upload timed out"));
    x.onabort = () => no(new Error("Upload cancelled"));
    signal.abort = () => x.abort();
    x.send(body);
  });
}
export async function uploadWorld(id: string, file: File, onStep: (s: string, pct?: number) => void, signal: { abort?: () => void } = {}) {
  const kind = /\.epk$/i.test(file.name) ? "epk" : /\.zip$/i.test(file.name) ? "zip" : "";
  if (!kind) throw new Error("Choose an .epk (Eaglercraft world export) or a .zip (vanilla world folder).");
  if (file.size > 70e6) throw new Error(`The file is ${(file.size / 1e6).toFixed(0)} MB, the limit is about 70 MB.`);
  onStep(`Reading ${(file.size / 1e6).toFixed(1)} MB...`);
  const content = await readB64(file);
  const path = `uploads/${id}.bin`;
  for (let attempt = 1; attempt <= 6; attempt++) {
    onStep(attempt > 1 ? `Uploading (try ${attempt})...` : "Uploading...", 0);
    // sha of an already uploaded file, from the directory listing (the single-file read cannot return big files)
    let sha: string | undefined;
    const ls = await gh("contents/uploads?ref=data");
    if (ls.ok) sha = ((await ls.json()) as { name: string; sha: string }[]).find((f) => f.name === `${id}.bin`)?.sha;
    const body = JSON.stringify({ message: `upload ${id}`, branch: "data", content, ...(sha ? { sha } : {}) });
    const status = await putWithProgress(path, body, (p) => onStep("Uploading...", p), signal);
    if (status === 200 || status === 201) {
      onStep("Saving...", 100);
      await saveServer({ id, importPending: { name: file.name, kind, size: file.size }, importResult: undefined }, "import");
      return;
    }
    if (status === 401 || status === 403 || status === 404) throw new Error(`GitHub refused the upload (${status}). Check the token permissions.`);
    if (status === 413 || status === 422 && attempt === 6) throw new Error("GitHub rejected the file (too large).");
    await new Promise((res) => setTimeout(res, 800 + Math.random() * 1200)); // branch busy, retry
  }
  throw new Error("The server was busy writing, please try again.");
}

