import { DEFAULT_PLUGINS, PLUGINS } from "./plugins";
import { useCallback, useEffect, useState } from "react";
import { TK, dispatch, getServer, listServers, saveServer, token, type Srv } from "./gh";
import ServerPanel from "./ServerPanel";

export const LABEL: Record<string, string> = { starting: "Starting", running: "Online", stopping: "Stopping", stopped: "Offline" };

export default function Servers({ sel }: { sel: string | null }) {
  const [tok, setTok] = useState(token());
  const [draft, setDraft] = useState("");
  const [name, setName] = useState("");
  const [ver, setVer] = useState("1.12.2");
  const [ram, setRam] = useState(5);
  const [diff, setDiff] = useState("easy");
  const [mode, setMode] = useState("survival");
  const [max, setMax] = useState(30);
  const [plug, setPlug] = useState<string[]>(DEFAULT_PLUGINS);
  const [items, setItems] = useState<Srv[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try { setItems(await listServers()); setErr(""); } catch (e) { setErr(String(e)); }
  }, [tok]);
  useEffect(() => { refresh(); if (!tok) return; const i = setInterval(refresh, 8000); return () => clearInterval(i); }, [refresh, tok]); // guests load once (GitHub rate limit)

  // the open server is fetched directly, so a freshly created one shows up without waiting for the list
  const [direct, setDirect] = useState<Srv | null>(null);
  const loadOne = useCallback(async () => {
    if (!sel) { setDirect(null); return; }
    try { setDirect(await getServer(sel)); } catch { /* keep last */ }
  }, [sel, tok]);
  useEffect(() => { setDirect(null); loadOne(); const i = setInterval(loadOne, tok ? 4000 : 20000); return () => clearInterval(i); }, [loadOne, tok]);

  const create = async () => {
    setBusy(true);
    try {
      const n = name.trim() || "My server";
      const id = n.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 10) + Math.random().toString(36).slice(2, 6);
      await saveServer({ id, name: n, version: ver, settings: { motd: n, maxPlayers: max, difficulty: diff, gamemode: mode, ramGb: ram, plugins: plug }, want: "run", status: "starting", always: true, created: Date.now() } as never, "create");
      await dispatch(id); setName(""); location.hash = `#/servers/${id}`;
    } catch (e) { setErr(String(e)); }
    setBusy(false);
  };

  if (sel) return direct ? <ServerPanel guest={!tok} srv={direct} reload={() => { loadOne(); refresh(); }} /> : <div className="page"><p className="text-muted-foreground">Loading server... <a className="link" href="#/servers">Back</a></p></div>;

  return (
    <div className="page">
      <div className="hero2">
        <h1 className="font-pixel">Servers</h1>
        {tok && <button className="link" onClick={() => { localStorage.removeItem(TK); setTok(""); }}>Disconnect GitHub</button>}
      </div>
      {!tok && <div className="box"><h3>Guest mode</h3><p className="small text-muted-foreground">You can see the servers and join them without anything. To create, start or stop servers, connect GitHub once:</p><ol className="steps">
          <li><b>Create a token</b> (one click, tick nothing else, then press <i>Generate token</i> at the bottom of the page).<br />
            <a className="btn" target="_blank" rel="noreferrer" href="https://github.com/settings/tokens/new?scopes=repo,workflow&description=eagler-servers">Open GitHub token page</a></li>
          <li><b>Paste it here.</b> It stays only in this browser.
            <input className="field" placeholder="ghp_..." value={draft} onChange={(e) => setDraft(e.target.value.trim())} />
            <button className="btn primary" disabled={!draft} onClick={() => { localStorage.setItem(TK, draft); setTok(draft); }}>Connect</button></li>
        </ol></div>}
      {tok && <div className="box">
        <h3>New server</h3>
        <div className="row" style={{ marginBottom: ".7rem" }}>
          <input className="field" style={{ margin: 0, flex: 1 }} placeholder="Server name" value={name} onChange={(e) => setName(e.target.value)} />
          <select className="field" style={{ margin: 0, width: "auto" }} value={ver} onChange={(e) => setVer(e.target.value)}><option value="1.12.2">Minecraft 1.12.2</option><option value="26.2">Minecraft 26.2</option></select>
        </div>
        <div className="row" style={{ marginBottom: ".7rem" }}>
          <span>RAM</span><input type="range" min={1} max={12} value={ram} onChange={(e) => setRam(+e.target.value)} style={{ flex: 1, maxWidth: "20rem" }} /><b>{ram} GB</b>
        </div>
        <div className="row" style={{ marginBottom: ".7rem" }}>
          <select className="field" style={{ margin: 0, width: "auto" }} value={mode} onChange={(e) => setMode(e.target.value)}><option value="survival">Survival</option><option value="creative">Creative</option><option value="adventure">Adventure</option></select>
          <select className="field" style={{ margin: 0, width: "auto" }} value={diff} onChange={(e) => setDiff(e.target.value)}><option value="peaceful">Peaceful</option><option value="easy">Easy</option><option value="normal">Normal</option><option value="hard">Hard</option></select>
          <span>Max players</span><input className="field" type="number" min={1} max={200} style={{ margin: 0, width: "5rem" }} value={max} onChange={(e) => setMax(Math.max(1, +e.target.value || 1))} />
        </div>
        <div className="plist" style={{ marginBottom: ".7rem" }}>{PLUGINS.map((p) => (
          <label key={p.id} className="pl"><input type="checkbox" checked={plug.includes(p.id)} onChange={(e) => setPlug(e.target.checked ? [...plug, p.id] : plug.filter((x) => x !== p.id))} /> <b>{p.name}</b> <span className="small text-muted-foreground">{p.desc}</span></label>
        ))}</div>
        <button className="btn primary" disabled={busy} onClick={create}>Create server</button>
      </div>}
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
