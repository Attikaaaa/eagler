import { useCallback, useEffect, useState } from "react";
import { TK, dispatch, getServer, listServers, saveServer, token, type Srv } from "./gh";
import ServerPanel from "./ServerPanel";

export const LABEL: Record<string, string> = { starting: "Starting", running: "Online", stopping: "Stopping", stopped: "Offline" };

export default function Servers({ sel }: { sel: string | null }) {
  const [tok, setTok] = useState(token());
  const [draft, setDraft] = useState("");
  const [name, setName] = useState("");
  const [items, setItems] = useState<Srv[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!tok) return;
    try { setItems(await listServers()); setErr(""); } catch (e) { setErr(String(e)); }
  }, [tok]);
  useEffect(() => { refresh(); const i = setInterval(refresh, 8000); return () => clearInterval(i); }, [refresh]);

  // the open server is fetched directly, so a freshly created one shows up without waiting for the list
  const [direct, setDirect] = useState<Srv | null>(null);
  const loadOne = useCallback(async () => {
    if (!sel || !tok) { setDirect(null); return; }
    try { setDirect(await getServer(sel)); } catch { /* keep last */ }
  }, [sel, tok]);
  useEffect(() => { setDirect(null); loadOne(); const i = setInterval(loadOne, 4000); return () => clearInterval(i); }, [loadOne]);

  const create = async () => {
    setBusy(true);
    try {
      const n = name.trim() || "My server";
      const id = n.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 10) + Math.random().toString(36).slice(2, 6);
      await saveServer({ id, name: n, version: "1.12.2", want: "run", status: "starting", always: true, created: Date.now() } as never, "create");
      await dispatch(id); setName(""); location.hash = `#/servers/${id}`;
    } catch (e) { setErr(String(e)); }
    setBusy(false);
  };

  if (!tok) return (
    <div className="page narrow">
      <div className="hero2">
        <h1 className="font-pixel">Your own server</h1>
        <p className="text-muted-foreground">A real multiplayer server that runs on GitHub, not on your computer. Always on, world saved automatically, join from any device.</p>
      </div>
      <div className="box">
        <ol className="steps">
          <li><b>Create a token</b> (one click, tick nothing else, then press <i>Generate token</i> at the bottom of the page).<br />
            <a className="btn" target="_blank" rel="noreferrer" href="https://github.com/settings/tokens/new?scopes=repo,workflow&description=eagler-servers">Open GitHub token page</a></li>
          <li><b>Paste it here.</b> It stays only in this browser.
            <input className="field" placeholder="ghp_..." value={draft} onChange={(e) => setDraft(e.target.value.trim())} />
            <button className="btn primary" disabled={!draft} onClick={() => { localStorage.setItem(TK, draft); setTok(draft); }}>Connect</button></li>
        </ol>
      </div>
    </div>
  );

  if (sel) return direct ? <ServerPanel srv={direct} reload={() => { loadOne(); refresh(); }} /> : <div className="page"><p className="text-muted-foreground">Loading server... <a className="link" href="#/servers">Back</a></p></div>;

  return (
    <div className="page">
      <div className="hero2">
        <h1 className="font-pixel">Servers</h1>
        <button className="link" onClick={() => { localStorage.removeItem(TK); setTok(""); }}>Disconnect GitHub</button>
      </div>
      <div className="box row">
        <input className="field" style={{ margin: 0, flex: 1 }} placeholder="Name your new server" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
        <button className="btn primary" disabled={busy} onClick={create}>Create server</button>
      </div>
      {err && <p className="err">{err}</p>}
      {items && items.length > 0 && (() => {
        const on = items.filter((x) => x.status === "running");
        const players = on.reduce((n, x) => n + (x.players ?? 0), 0);
        const ram = on.reduce((n, x) => n + (x.settings?.ramGb ?? 5), 0);
        const cpu = on.length ? Math.round(on.reduce((n, x) => n + (x.metrics?.cpu ?? 0), 0) / on.length) : 0;
        const disk = on.reduce((n, x) => n + (x.metrics?.diskUsedGb ?? 0), 0);
        return (<div className="dashstats">
          <div className="stat"><span>Servers online</span><b>{on.length}<small> / {items.length}</small></b></div>
          <div className="stat"><span>Players online</span><b>{players}</b></div>
          <div className="stat"><span>RAM allocated</span><b>{ram} GB</b></div>
          <div className="stat"><span>Avg CPU</span><b>{cpu}%</b></div>
          <div className="stat"><span>Disk in use</span><b>{disk.toFixed(1)} GB</b></div>
        </div>);
      })()}
      <div className="srvgrid">
        {items === null && !err && <p className="text-muted-foreground">Loading...</p>}
        {items?.length === 0 && <p className="text-muted-foreground">No servers yet. Create one above, it is online in about a minute.</p>}
        {items?.map((s) => (
          <a key={s.id} className="scard" href={`#/servers/${s.id}`}>
            <div className="sicon"><span className={"dot " + s.status} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b className="ell">{s.name}</b>
              <div className="meta"><span className="chip">Minecraft {s.version}</span><span className="chip">{s.settings?.ramGb ?? 5} GB RAM</span>{s.status === "running" && <><span className="chip">{s.players ?? 0} players</span>{s.metrics && <span className="chip">CPU {s.metrics.cpu}%</span>}</>}</div>
            </div>
            <span className={"badge " + s.status}>{LABEL[s.status] ?? s.status}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
