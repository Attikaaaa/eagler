import { useCallback, useEffect, useState } from "react";

const REPO = "Attikaaaa/eagler";
const TK = "eagler-gh-token";
type Srv = { id: string; name: string; version: string; want: string; status: string; address?: string | null; addresses?: Record<string, string>; players?: number; playerNames?: string[]; note?: string; error?: string; updated?: number; sha: string };

const gh = (t: string, p: string, o: RequestInit = {}) =>
  fetch(`https://api.github.com/repos/${REPO}/${p}`, { ...o, headers: { Authorization: `Bearer ${t}`, Accept: "application/vnd.github+json" } });
const b64 = (o: unknown) => btoa(unescape(encodeURIComponent(JSON.stringify(o, null, 1))));
const unb64 = (s: string) => JSON.parse(decodeURIComponent(escape(atob(s.replace(/\n/g, "")))));

async function list(t: string): Promise<Srv[]> {
  const r = await gh(t, "contents/servers?ref=data");
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(r.status === 401 ? "Token rejected" : `GitHub ${r.status}`);
  const files = (await r.json()) as { path: string; name: string }[];
  const out = await Promise.all(files.filter((f) => f.name.endsWith(".json")).map(async (f) => {
    const j = await (await gh(t, `contents/${f.path}?ref=data`)).json();
    return { ...unb64(j.content), sha: j.sha } as Srv;
  }));
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
const save = (t: string, s: Omit<Srv, "sha"> & { sha?: string }, msg: string) => {
  const { sha, ...body } = s;
  return gh(t, `contents/servers/${s.id}.json`, { method: "PUT", body: JSON.stringify({ message: msg, branch: "data", content: b64({ ...body, updated: Date.now() }), ...(sha ? { sha } : {}) }) });
};
const dispatch = (t: string, id: string, action = "run") =>
  gh(t, "actions/workflows/server.yml/dispatches", { method: "POST", body: JSON.stringify({ ref: "main", inputs: { id, action } }) });

const LABEL: Record<string, string> = { starting: "Starting...", running: "Online", stopping: "Saving & stopping...", stopped: "Offline" };

export default function Servers() {
  const [tok, setTok] = useState(localStorage.getItem(TK) || "");
  const [draft, setDraft] = useState("");
  const [name, setName] = useState("");
  const [items, setItems] = useState<Srv[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!tok) return;
    try { setItems(await list(tok)); setErr(""); } catch (e) { setErr(String(e)); }
  }, [tok]);
  useEffect(() => { refresh(); const i = setInterval(refresh, 8000); return () => clearInterval(i); }, [refresh]);

  const act = async (f: () => Promise<unknown>) => { setBusy(true); try { await f(); } catch (e) { setErr(String(e)); } setBusy(false); setTimeout(refresh, 800); };

  const create = () => act(async () => {
    const n = name.trim() || "My server";
    const id = n.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 12) + Math.random().toString(36).slice(2, 6);
    await save(tok, { id, name: n, version: "1.12.2", want: "run", status: "starting", always: true } as never, `create ${id}`);
    await dispatch(tok, id); setName("");
  });
  const start = (s: Srv) => act(async () => { await save(tok, { ...s, want: "run", status: "starting", error: undefined, note: undefined }, `start ${s.id}`); await dispatch(tok, s.id); });
  const stop = (s: Srv) => act(async () => { await save(tok, { ...s, want: "stop" }, `stop ${s.id}`); });
  const del = (s: Srv) => act(async () => {
    if (!confirm(`Delete "${s.name}" and its world permanently?`)) return;
    await gh(tok, `contents/servers/${s.id}.json`, { method: "DELETE", body: JSON.stringify({ message: `delete ${s.id}`, branch: "data", sha: s.sha }) });
    await dispatch(tok, s.id, "delete");
  });

  if (!tok) return (
    <section className="srv">
      <h2 className="font-pixel srvh">Servers</h2>
      <p className="text-muted-foreground small">Create your own multiplayer server that runs on GitHub, not on your computer. One-time setup: make a token and paste it here (it stays only in this browser).</p>
      <a className="pbtn font-pixel" style={{ display: "inline-block", width: "auto", padding: ".6rem 1.2rem" }} target="_blank" rel="noreferrer"
         href="https://github.com/settings/tokens/new?scopes=repo,workflow&description=eagler-servers">1. Create token</a>
      <input className="opt" placeholder="2. Paste token here (ghp_...)" value={draft} onChange={(e) => setDraft(e.target.value.trim())} />
      <button className="opt" onClick={() => { localStorage.setItem(TK, draft); setTok(draft); }} disabled={!draft}>Save token</button>
    </section>
  );

  return (
    <section className="srv">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 className="font-pixel srvh">Servers</h2>
        <button className="link" onClick={() => { localStorage.removeItem(TK); setTok(""); }}>Remove token</button>
      </div>
      <div style={{ display: "flex", gap: ".5rem" }}>
        <input className="opt" style={{ margin: 0 }} placeholder="New server name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
        <button className="pbtn font-pixel" style={{ margin: 0, width: "auto", padding: ".6rem 1.2rem" }} disabled={busy} onClick={create}>CREATE</button>
      </div>
      {err && <p className="small" style={{ color: "#fa3439" }}>{err}</p>}
      {items.length === 0 && !err && <p className="text-muted-foreground small">No servers yet. Create one, it starts in about a minute and stays online 24/7.</p>}
      {items.map((s) => (
        <div className="srvcard" key={s.id}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".5rem" }}>
            <b>{s.name}</b>
            <span className={"badge " + s.status}>{LABEL[s.status] ?? s.status}{s.status === "running" ? ` · ${s.players ?? 0} online` : ""}</span>
          </div>
          {s.address ? (
            <div className="addr"><code>{s.address}</code>
              <button className="link" onClick={() => navigator.clipboard.writeText(s.address!)}>Copy</button></div>
          ) : s.status === "stopped" ? null : <p className="small text-muted-foreground">Getting address...</p>}
          {s.addresses && Object.entries(s.addresses).filter(([, v]) => v !== s.address).map(([k, v]) => (
            <div className="addr" key={k}><code>{v}</code><button className="link" onClick={() => navigator.clipboard.writeText(v)}>Copy ({k})</button></div>
          ))}
          {s.playerNames && s.playerNames.length > 0 && <p className="small">Players: {s.playerNames.join(", ")}</p>}
          {s.note && <p className="small text-muted-foreground">{s.note}</p>}
          {s.error && s.status === "stopped" && <pre className="small errlog">{s.error}</pre>}
          <div style={{ display: "flex", gap: ".5rem", marginTop: ".5rem" }}>
            {s.status === "stopped" ? <button className="opt" style={{ margin: 0 }} disabled={busy} onClick={() => start(s)}>Start</button>
              : <button className="opt" style={{ margin: 0 }} disabled={busy || s.want === "stop"} onClick={() => stop(s)}>Stop</button>}
            <button className="opt" style={{ margin: 0 }} disabled={busy || s.status !== "stopped"} onClick={() => del(s)}>Delete</button>
          </div>
        </div>
      ))}
      <p className="small text-muted-foreground">Join: open Minecraft 1.12.2 → Multiplayer → Direct Connect → paste the address. The world is saved to GitHub every 10 minutes and on stop. The address can change after a restart (every ~6 h), copy the new one from here.</p>
    </section>
  );
}
