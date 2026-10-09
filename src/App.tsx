import { useState } from "react";
import { VERSIONS, type Version } from "./versions";
import Saves from "./Saves";
import Servers from "./Servers";

function Panel({ v }: { v: Version }) {
  const runs = Object.keys(v.runs);
  const [pick, setPick] = useState(runs[0]);
  const href = v.runs[runs.includes(pick) ? pick : runs[0]];
  return (
    <aside className="panel">
      <img className="big" src={v.art ?? "dirt.png"} alt="" />
      <h2 className="font-pixel ptitle">Minecraft {v.label}</h2>
      <p className="text-muted-foreground pdesc">{v.desc}</p>
      {runs.length > 1 && (
        <select className="opt" value={pick} onChange={(e) => setPick(e.target.value)}>
          {runs.map((r) => <option key={r}>{r}</option>)}
        </select>
      )}
      <a className="pbtn font-pixel" href={href ?? "#"} style={{ opacity: href ? 1 : 0.4 }} title={href ? "" : "Not available"}>PLAY</a>
    </aside>
  );
}

export default function App() {
  const [q, setQ] = useState("");
  const [cur, setCur] = useState(VERSIONS[0]);
  const list = VERSIONS.filter((v) => v.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="relative isolate flow-root">
      <div className="site-wash -z-10" aria-hidden="true" />
      <header className="sticky top-3 z-50 mx-auto mt-3 w-full max-w-7xl px-3 sm:px-4">
        <div className="glass-bar flex h-14 items-center gap-4 rounded-2xl px-3 sm:h-16 sm:px-4">
          <span className="font-brand brand">eagler</span>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-10">
        <div className="wrap">
          <section>
            <input className="opt search" type="search" placeholder="Search versions..." aria-label="Search versions" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="cards">
              {list.map((v) => (
                <button key={v.id} className={"card" + (v.id === cur.id ? " sel" : "")} onClick={() => setCur(v)} onDoubleClick={() => { const h = Object.values(v.runs)[0]; if (h) location.href = h; }}>
                  <div className="art">
                    {v.art ? <img src={v.art} alt="" /> : <span className="font-pixel artname">{v.label}</span>}
                  </div>
                  <div className="row"><span>{v.label}</span><span className="playdot" onClick={(e) => { e.stopPropagation(); const h = Object.values(v.runs)[0]; if (h) location.href = h; }}>&#9654;</span></div>
                </button>
              ))}
            </div>
          </section>
          <div><Panel key={cur.id} v={cur} /><Saves /></div>
        </div>
        <Servers />
        <h1 className="font-pixel hero">Minecraft in your browser</h1>
        <p className="text-muted-foreground">Everything runs from local files, no internet needed.</p>
      </main>
    </div>
  );
}
