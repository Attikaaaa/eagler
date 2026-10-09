import { useEffect, useRef, useState } from "react";
import { deleteServerFile, dispatch, getConsole, saveServer, sendCommand, worldBackups, type Settings, type Srv } from "./gh";
import { LABEL } from "./Servers";
import { DEFAULT_PLUGINS, PLUGINS } from "./plugins";

type Tab = "overview" | "console" | "players" | "settings" | "backups";
const TABS: [Tab, string][] = [["overview", "Overview"], ["console", "Console"], ["players", "Players"], ["settings", "Settings"], ["backups", "Backups"]];

const up = (ms: number) => { const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`; };
const mb = (n: number) => (n / 1e6).toFixed(1) + " MB";

function Copy({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return <button className="link" onClick={() => { navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1200); }}>{ok ? "Copied" : "Copy"}</button>;
}

function Console({ srv }: { srv: Srv }) {
  const [lines, setLines] = useState<string[]>([]);
  const [cmd, setCmd] = useState("");
  const hist = useRef<string[]>([]); const hi = useRef(-1);
  const box = useRef<HTMLDivElement>(null); const stick = useRef(true);
  const live = srv.status === "running";

  useEffect(() => {
    let dead = false;
    const tick = async () => { try { const c = await getConsole(srv.id); if (!dead && c) setLines(c.data.lines); } catch { /* ignore */ } };
    tick(); const i = setInterval(tick, 3000);
    return () => { dead = true; clearInterval(i); };
  }, [srv.id]);
  useEffect(() => { if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight; }, [lines]);

  const send = async () => {
    const c = cmd.trim(); if (!c) return;
    hist.current.unshift(c); hi.current = -1; setCmd("");
    setLines((l) => [...l, `> ${c}`]);
    try { await sendCommand(srv.id, c); } catch (e) { setLines((l) => [...l, `! ${e}`]); }
  };
  const cls = (l: string) => l.startsWith("> ") ? "cmd" : /\/ERROR\]|\bERROR\]/.test(l) || l.startsWith("!") ? "e" : /WARN\]/.test(l) ? "w" : /joined the game/.test(l) ? "j" : /left the game/.test(l) ? "x" : "";
  return (
    <div className="term">
      <div className="termbar"><span className="dot running" /> console {live ? "" : "(offline: start the server to send commands)"}<span style={{ flex: 1 }} /><span className="small">updates every few seconds</span></div>
      <div className="termbody" ref={box} onScroll={(e) => { const t = e.currentTarget; stick.current = t.scrollTop + t.clientHeight >= t.scrollHeight - 30; }}>
        {lines.length === 0 && <div className="tl">No output yet.</div>}
        {lines.map((l, i) => <div key={i} className={"tl " + cls(l)}>{l}</div>)}
      </div>
      <div className="terminput">
        <span>$</span>
        <input disabled={!live} placeholder={live ? "Type a command, e.g. say hello, op Steve, time set day" : "Server is offline"} value={cmd} onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
            if (e.key === "ArrowUp") { hi.current = Math.min(hi.current + 1, hist.current.length - 1); setCmd(hist.current[hi.current] ?? ""); e.preventDefault(); }
            if (e.key === "ArrowDown") { hi.current = Math.max(hi.current - 1, -1); setCmd(hist.current[hi.current] ?? ""); }
          }} />
        <button className="btn primary" disabled={!live || !cmd.trim()} onClick={send}>Send</button>
      </div>
    </div>
  );
}

function Players({ srv }: { srv: Srv }) {
  const [who, setWho] = useState("");
  const live = srv.status === "running";
  const run = (c: string) => sendCommand(srv.id, c);
  return (
    <div className="box">
      <h3>Online now ({srv.players ?? 0}/{srv.settings?.maxPlayers ?? 30})</h3>
      {(srv.playerNames ?? []).length === 0 && <p className="text-muted-foreground small">Nobody is online.</p>}
      {(srv.playerNames ?? []).map((p) => (
        <div className="prow" key={p}>
          <img alt="" src={`https://mc-heads.net/avatar/${p}/32`} width={32} height={32} style={{ imageRendering: "pixelated", borderRadius: 6 }} />
          <b style={{ flex: 1 }}>{p}</b>
          <button className="btn sm" disabled={!live} onClick={() => run(`op ${p}`)}>Op</button>
          <button className="btn sm" disabled={!live} onClick={() => run(`deop ${p}`)}>Deop</button>
          <button className="btn sm" disabled={!live} onClick={() => run(`kick ${p}`)}>Kick</button>
          <button className="btn sm danger" disabled={!live} onClick={() => confirm(`Ban ${p}?`) && run(`ban ${p}`)}>Ban</button>
        </div>
      ))}
      <h3 style={{ marginTop: "1.25rem" }}>Manage a player by name</h3>
      <div className="row"><input className="field" style={{ margin: 0, flex: 1 }} placeholder="Player name" value={who} onChange={(e) => setWho(e.target.value.trim())} />
        {[["Op", "op"], ["Deop", "deop"], ["Whitelist add", "whitelist add"], ["Whitelist remove", "whitelist remove"], ["Pardon", "pardon"]].map(([l, c]) => (
          <button key={c} className="btn sm" disabled={!live || !who} onClick={() => run(`${c} ${who}`)}>{l}</button>))}
      </div>
    </div>
  );
}

function SettingsTab({ srv, reload }: { srv: Srv; reload: () => void }) {
  const [s, setS] = useState<Settings>({ motd: srv.name, maxPlayers: 30, difficulty: "easy", gamemode: "survival", pvp: true, viewDistance: 8, whitelist: false, allowNether: true, monsters: true, animals: true, spawnProtection: 0, commandBlocks: true, ramGb: 5, plugins: DEFAULT_PLUGINS, ...srv.settings });
  const [saved, setSaved] = useState("");
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((o) => ({ ...o, [k]: v }));
  const Tog = ({ k, label }: { k: keyof Settings; label: string }) => (
    <label className="tog"><input type="checkbox" checked={!!s[k]} onChange={(e) => set(k, e.target.checked as never)} /><span>{label}</span></label>);
  const save = async (restart: boolean) => {
    await saveServer({ id: srv.id, settings: s, ...(restart && srv.status === "running" ? { want: "restart" } : {}) }, "settings");
    setSaved(restart && srv.status === "running" ? "Saved. Restarting to apply..." : "Saved. Applies on next start."); reload();
  };
  return (
    <div className="box">
      <div className="grid2">
        <label>Server name / MOTD<input className="field" value={s.motd ?? ""} onChange={(e) => set("motd", e.target.value)} /></label>
        <label>Max players<input className="field" type="number" min={1} max={100} value={s.maxPlayers} onChange={(e) => set("maxPlayers", +e.target.value)} /></label>
        <label>Difficulty<select className="field" value={s.difficulty} onChange={(e) => set("difficulty", e.target.value)}>{["peaceful", "easy", "normal", "hard"].map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>Game mode<select className="field" value={s.gamemode} onChange={(e) => set("gamemode", e.target.value)}>{["survival", "creative", "adventure", "spectator"].map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>View distance<input className="field" type="number" min={3} max={16} value={s.viewDistance} onChange={(e) => set("viewDistance", +e.target.value)} /></label>
        <label>Spawn protection (blocks)<input className="field" type="number" min={0} max={64} value={s.spawnProtection} onChange={(e) => set("spawnProtection", +e.target.value)} /></label>
        <label style={{ gridColumn: "1/-1" }}>World seed (only for a brand-new world)<input className="field" value={s.seed ?? ""} onChange={(e) => set("seed", e.target.value)} /></label>
      </div>
      <h3 style={{ marginTop: "1.25rem" }}>Memory (RAM)</h3>
      <div className="row"><input type="range" min={1} max={12} step={1} value={s.ramGb} onChange={(e) => set("ramGb", +e.target.value)} style={{ flex: 1, maxWidth: "24rem" }} /><b>{s.ramGb} GB</b></div>
      <p className="small text-muted-foreground">The GitHub machine has 16 GB in total (4 CPU cores, 14 GB disk). Up to 12 GB can go to the server, the rest is needed by the system and tunnels. 4-6 GB is plenty for most worlds.</p>
      <h3 style={{ marginTop: "1.25rem" }}>Plugins</h3>
      <p className="small text-muted-foreground">Server software: Paper 1.12.2 (fixed, it has to match the 1.12.2 game client). Plugin settings and data are kept in your world save. Changes apply on restart.</p>
      <div className="plist">{PLUGINS.map((p) => (
        <label key={p.id} className="pl"><input type="checkbox" checked={(s.plugins ?? []).includes(p.id)} onChange={(e) => set("plugins", e.target.checked ? [...(s.plugins ?? []), p.id] : (s.plugins ?? []).filter((x) => x !== p.id))} />
          <span><b>{p.name}</b><small>{p.desc}</small></span></label>))}</div>
      <div className="togs"><Tog k="pvp" label="PvP" /><Tog k="whitelist" label="Whitelist" /><Tog k="allowNether" label="Nether" /><Tog k="monsters" label="Monsters" /><Tog k="animals" label="Animals" /><Tog k="commandBlocks" label="Command blocks" /><Tog k="forceGamemode" label="Force game mode" /></div>
      <div className="row" style={{ marginTop: "1rem" }}>
        <button className="btn" onClick={() => save(false)}>Save</button>
        <button className="btn primary" onClick={() => save(true)}>Save and restart</button>
        <span className="small text-muted-foreground">{saved}</span>
      </div>
    </div>
  );
}

function Backups({ srv }: { srv: Srv }) {
  const [a, setA] = useState<Awaited<ReturnType<typeof worldBackups>> | null>(null);
  useEffect(() => { worldBackups(srv.id).then(setA); }, [srv.id, srv.status]);
  return (
    <div className="box">
      <h3>World backups</h3>
      <p className="text-muted-foreground small">The world is saved to GitHub every 10 minutes and every time the server stops. Two rolling copies are kept. Download them any time.</p>
      {a === null && <p className="small">Loading...</p>}
      {a?.length === 0 && <p className="small text-muted-foreground">No save yet. The first one appears a few minutes after the server starts.</p>}
      {a?.map((x) => (
        <div className="prow" key={x.name}><b style={{ flex: 1 }}>{x.name}</b><span className="small text-muted-foreground">{mb(x.size)} · {new Date(x.updated_at).toLocaleString()}</span>
          <a className="btn sm" href={x.browser_download_url}>Download</a></div>))}
      <div className="row" style={{ marginTop: "1rem" }}>
        <button className="btn" disabled={srv.status !== "running"} onClick={() => sendCommand(srv.id, "save-all")}>Flush world to disk now</button>
      </div>
    </div>
  );
}

export default function ServerPanel({ srv, reload }: { srv: Srv; reload: () => void }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);
  const act = async (f: () => Promise<unknown>) => { setBusy(true); try { await f(); } catch (e) { alert(String(e)); } setBusy(false); setTimeout(reload, 700); };
  const start = () => act(async () => { await saveServer({ id: srv.id, want: "run", status: "starting", error: undefined, note: undefined }, "start"); await dispatch(srv.id); });
  const stop = () => act(() => saveServer({ id: srv.id, want: "stop" }, "stop"));
  const restart = () => act(() => saveServer({ id: srv.id, want: "restart" }, "restart"));
  const del = () => act(async () => {
    if (!confirm(`Delete "${srv.name}" and its world permanently? This cannot be undone.`)) return;
    await deleteServerFile(srv.id);
    await dispatch(srv.id, "delete"); location.hash = "#/servers";
  });
  const st = srv.status, off = st === "stopped";
  const all = Object.entries(srv.addresses ?? {});

  return (
    <div className="page">
      <a className="link" href="#/servers">&larr; All servers</a>
      <div className="phead">
        <div className="sicon big"><span className={"dot " + st} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="ell">{srv.name}</h1>
          <div className="small text-muted-foreground">Minecraft {srv.version} · Paper + EaglerXServer · {srv.settings?.ramGb ?? 5} GB RAM</div>
        </div>
        <span className={"badge lg " + st}>{LABEL[st] ?? st}</span>
        <div className="row">
          {off ? <button className="btn primary" disabled={busy} onClick={start}>Start</button>
            : <><button className="btn" disabled={busy || srv.want === "stop"} onClick={restart}>Restart</button>
              <button className="btn danger" disabled={busy || srv.want === "stop"} onClick={stop}>Stop</button></>}
        </div>
      </div>

      <div className="tabs">{TABS.map(([k, l]) => <button key={k} className={"tab" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>{l}</button>)}</div>

      {tab === "overview" && (<>
        <div className="stats">
          <div className="stat"><span>Players</span><b>{srv.players ?? 0}<small> / {srv.settings?.maxPlayers ?? 30}</small></b></div>
          <div className="stat"><span>Uptime</span><b>{st === "running" && srv.startedAt ? up(now - srv.startedAt) : "-"}</b></div>
          <div className="stat"><span>Server RAM</span><b>{srv.settings?.ramGb ?? 5} GB<small> of {srv.host?.totalGb ?? 16}</small></b></div>
          <div className="stat"><span>Keep-alive</span><b>24/7</b></div>
        </div>
        <div className="box">
          <h3>Server address</h3>
          {srv.address ? (<>
            <div className="addr big"><code>{srv.address}</code><Copy text={srv.address} /></div>
            {all.filter(([, v]) => v !== srv.address).map(([k, v]) => <div className="addr" key={k}><code>{v}</code><Copy text={v} /><span className="small text-muted-foreground">backup address ({k})</span></div>)}
            <ol className="steps small"><li>Open Minecraft 1.12.2 from the Play page.</li><li>Multiplayer &rarr; Direct Connect.</li><li>Paste the address and join.</li></ol>
          </>) : <p className="text-muted-foreground small">{off ? "Offline. Press Start, it is online in about a minute." : "Getting a public address..."}</p>}
          {srv.note && <p className="small text-muted-foreground">{srv.note}</p>}
          {st === "running" && <p className="small text-muted-foreground">The address changes when the server restarts (about every 6 hours). Copy the new one from here.</p>}
        </div>
        {srv.error && off && <div className="box"><h3>Last output before it stopped</h3><pre className="errlog">{srv.error}</pre></div>}
        <div className="box row" style={{ justifyContent: "space-between" }}><span className="small text-muted-foreground">Deleting removes the server and its saved world for good.</span><button className="btn danger" disabled={busy || !off} onClick={del}>Delete server</button></div>
      </>)}
      {tab === "console" && <Console srv={srv} />}
      {tab === "players" && <Players srv={srv} />}
      {tab === "settings" && <SettingsTab srv={srv} reload={reload} />}
      {tab === "backups" && <Backups srv={srv} />}
    </div>
  );
}
