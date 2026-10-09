export const REPO = "Attikaaaa/eagler";
export const TK = "eagler-gh-token";

export type Settings = Partial<{ motd: string; maxPlayers: number; difficulty: string; gamemode: string; pvp: boolean; viewDistance: number; whitelist: boolean; allowNether: boolean; monsters: boolean; animals: boolean; spawnProtection: number; seed: string; forceGamemode: boolean; commandBlocks: boolean; ramGb: number; plugins: string[] }>;
export type Srv = {
  id: string; name: string; version: string; want: string; status: string; sha: string;
  address?: string | null; addresses?: Record<string, string>; players?: number; playerNames?: string[];
  note?: string; error?: string; updated?: number; startedAt?: number; settings?: Settings; always?: boolean; host?: { cpus: number; totalGb: number; ramGb: number };
};

export const token = () => localStorage.getItem(TK) || "";
export const gh = (p: string, o: RequestInit = {}) =>
  fetch(`https://api.github.com/repos/${REPO}/${p}`, { ...o, headers: { Authorization: `Bearer ${token()}`, Accept: "application/vnd.github+json" } });
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
  // always merge onto the newest copy so we never overwrite runner updates with stale data
  const cur = await getJson<Srv>(`servers/${s.id}.json`);
  const { sha: _a, ...patch } = s as Srv; void _a;
  const next = { ...(cur?.data ?? {}), ...patch, updated: Date.now() };
  const r = await gh(`contents/servers/${s.id}.json`, { method: "PUT", body: JSON.stringify({ message: `${msg} ${s.id}`, branch: "data", content: b64(next), ...(cur ? { sha: cur.sha } : {}) }) });
  if (!r.ok) throw new Error(`Save failed (${r.status})`);
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
