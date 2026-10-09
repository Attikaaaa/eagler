import { useEffect, useState } from "react";
import { VERSIONS, type Version } from "./versions";
import Saves from "./Saves";
import Servers from "./Servers";
import Home from "./Home";

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

function Play() {
  const [q, setQ] = useState("");
  const [cur, setCur] = useState(VERSIONS[0]);
  const list = VERSIONS.filter((v) => v.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <main className="mx-auto max-w-7xl px-4 py-10 playmain">
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
        <h1 className="font-pixel hero">Minecraft in your browser</h1>
        <p className="text-muted-foreground">Everything runs from local files, no internet needed.</p>
      </main>
    </>
  );
}

const route = () => location.hash.replace(/^#\/?/, "").split("/");

export default function App() {
  const [r, setR] = useState(route());
  useEffect(() => { const f = () => { setR(route()); scrollTo(0, 0); }; addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  const page = r[0] === "servers" ? "servers" : r[0] === "play" ? "play" : "home";
  return (
    <div className="relative isolate flow-root shell">
      <div className="site-wash -z-10" aria-hidden="true" />
      <div className="aurora" aria-hidden="true" />
      <header className="topnav">
        <a href="#/" className="brandlink"><img src="favicon.png" alt="" width={26} height={26} /><span className="font-brand brand">eagler</span></a>
        <nav>
          <a href="#/" className={"navl" + (page === "home" ? " on" : "")}>Home</a>
          <a href="#/play" className={"navl" + (page === "play" ? " on" : "")}>Play</a>
          <a href="#/servers" className={"navl" + (page === "servers" ? " on" : "")}>Servers</a>
        </nav>
        <a href="#/servers" className="btn primary navcta">Dashboard</a>
      </header>
      {page === "servers" ? <Servers sel={r[1] || null} /> : page === "play" ? <Play /> : <Home />}
      <footer className="foot">
        <div><span className="font-brand brand sm">eagler</span><p>Free Minecraft hosting and an offline game launcher.</p></div>
        <div className="cols"><a href="#/">Home</a><a href="#/play">Play</a><a href="#/servers">Servers</a></div>
        <p className="legal">Not affiliated with Mojang or Microsoft. Minecraft is a trademark of Mojang AB.</p>
      </footer>
    </div>
  );
}
