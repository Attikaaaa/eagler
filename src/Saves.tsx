import { useEffect, useState } from "react";

export default function Saves() {
  const [st, setSt] = useState<KeepStatus | null>(null);
  const [msg, setMsg] = useState("");
  const [cl, setCl] = useState<{ token: boolean; last: { at: number } | null } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const cloud = () => window.Keep.cloud.status().then(setCl);
  useEffect(() => { cloud(); }, []);
  const sync = async () => {
    setSyncing(true);
    try {
      const a = await window.Keep.cloud.pull(), b = await window.Keep.cloud.push();
      setMsg(b.reason === "too-big" ? "Saves are over 70 MB, too big for cloud sync." : b.reason === "shrunk" ? "Not synced: storage looks emptier than before." : b.ok ? (a.changed ? "Pulled newer saves from the cloud (reload the game page to see them). " : "") + (b.same ? "Already up to date." : b.merged ? `Merged with the other device and uploaded (${b.mb} MB).` : `Uploaded (${b.mb} MB).`) : "Sync failed.");
    } catch (e) { setMsg(String(e)); }
    setSyncing(false); cloud();
  };
  const refresh = () => window.Keep.status().then(setSt);
  useEffect(() => { refresh(); }, []);

  const run = (f: () => Promise<KeepResult>, ok: string) => async () => {
    try {
      const r = await f();
      setMsg(r.ok ? ok : r.reason === "shrunk" ? `Not saved: storage has ${r.n} entries, last backup had ${r.prev}. Possible data loss, restore first.` : r.reason === "empty" ? "No backup found in the folder." : "Pick a backup folder first.");
    } catch (e) { setMsg(String(e)); }
    refresh();
  };
  const pick = async () => { try { await window.Keep.chooseFolder(); setMsg("Folder set."); } catch { /* cancelled */ } refresh(); };

  return (
    <div className="saves">
      <h3 className="font-pixel">World backup</h3>
      <p className="text-muted-foreground small">
        Worlds live in browser storage, which the browser can wipe. Backups go to real files in a folder you pick (last 3 kept, auto every 3 min while playing).
      </p>
      <p className="small">
        Protected storage: <b>{st ? (st.persisted ? "yes" : "not granted") : "..."}</b>
        {st?.last && <> · Last backup: <b>{new Date(st.last.at).toLocaleString()}</b> ({st.last.n} entries)</>}
      </p>
      {window.Keep.hasFS ? (
        <>
          <button className="opt" onClick={pick}>{st?.folder ? `Folder: ${st.folder} (change)` : "Choose backup folder"}</button>
          <button className="opt" onClick={run(() => window.Keep.backup(true), "Backup saved.")}>Back up now</button>
          <button className="opt" onClick={run(() => window.Keep.restore(true), "Restored from the newest backup.")}>Restore newest backup</button>
        </>
      ) : (
        <>
          <button className="opt" onClick={run(() => window.Keep.download(), "Backup file downloaded.")}>Download backup file</button>
          <label className="opt" style={{ display: "block", cursor: "pointer" }}>
            Load backup file
            <input type="file" accept=".json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) run(() => window.Keep.upload(f), "Backup loaded.")(); }} />
          </label>
        </>
      )}
      <h3 className="font-pixel" style={{ marginTop: "1rem" }}>Cloud sync</h3>
      <p className="text-muted-foreground small">Singleplayer worlds follow you to every device: synced automatically (on start, then every 3 min while playing). Needs the GitHub token from the Servers page. Saves are stored in the public repo, so anyone could download them.</p>
      {cl?.token ? <><button className="opt" disabled={syncing} onClick={sync}>{syncing ? "Syncing..." : "Sync now"}</button><span className="small"> Last sync: <b>{cl.last ? new Date(cl.last.at).toLocaleString() : "never"}</b></span></> : <p className="small">Worlds from the cloud load by themselves, no login. To also upload what you play on this device, connect GitHub once on the <a className="link" href="#/servers">Servers</a> page.</p>}
      {msg && <p className="small" style={{ marginTop: ".5rem" }}>{msg}</p>}
    </div>
  );
}
