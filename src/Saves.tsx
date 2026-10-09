import { useEffect, useState } from "react";

export default function Saves() {
  const [st, setSt] = useState<KeepStatus | null>(null);
  const [msg, setMsg] = useState("");
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
      {msg && <p className="small" style={{ marginTop: ".5rem" }}>{msg}</p>}
    </div>
  );
}
