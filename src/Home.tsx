const FEATURES: [string, string, string][] = [
  ["Always online", "Your server keeps running around the clock and restarts itself if it ever stops.", "M12 3v9l6 3M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"],
  ["Ready in a minute", "Press create. Paper, the Eagler bridge and your plugins are set up for you.", "M13 2 4 14h7l-1 8 9-12h-7l1-8Z"],
  ["Live console", "Watch the log in real time and run any command, right from the panel.", "M4 5h16v14H4zM8 10l3 2-3 2M13 14h4"],
  ["One-click plugins", "spark, EssentialsX, LuckPerms, WorldEdit and more, with your configs kept.", "M9 3v4M15 3v4M7 7h10v5a5 5 0 0 1-10 0V7ZM12 17v4"],
  ["Automatic backups", "The world is saved every 10 minutes and on every stop. Download any copy.", "M12 3v12m0 0-4-4m4 4 4-4M4 19h16"],
  ["Join from any browser", "No Java, no mods. Play on a Chromebook, phone or PC, and share one address.", "M3 5h18v11H3zM8 21h8M12 16v5"],
];
const STEPS: [string, string][] = [
  ["Connect GitHub", "Paste a free access token once. It stays in your browser and nothing is stored on our side."],
  ["Create a server", "Name it and press Create. Your server boots in about a minute."],
  ["Share the address", "Copy the address into Direct Connect and play with your friends."],
];
const FAQ: [string, string][] = [
  ["Where does the server actually run?", "On GitHub's cloud machines (4 CPU cores, 16 GB RAM). Nothing runs on your own computer, and your computer does not need to stay on."],
  ["Is it really always on?", "Yes. A job can run for about 6 hours, so every server restarts itself on a schedule and a watchdog brings it back if it stops. During that short restart (about a minute) players are disconnected, and the address changes, so copy the new one from your panel."],
  ["Can my world get lost?", "Your world is saved to GitHub every 10 minutes and whenever the server stops, in two rolling copies you can download. At worst you lose the last few minutes."],
  ["Which game versions can join?", "Minecraft 1.12.2 in the browser (included on the Play page). More versions will follow."],
  ["What does it cost?", "Nothing. It runs on the free tier of GitHub for public repositories."],
];

const Icon = ({ d }: { d: string }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="heroin">
          <div className="pill"><span className="dot running" /> All systems operational</div>
          <h1>Minecraft server hosting,<br /><span className="grad">on autopilot.</span></h1>
          <p className="lead">Spin up a 24/7 multiplayer server in about a minute. Full console, plugins, backups and a shareable address. Free, no install, nothing runs on your PC.</p>
          <div className="cta">
            <a className="btn primary xl" href="#/servers">Create your server</a>
            <a className="btn ghost xl" href="#/play">Play in browser</a>
          </div>
          <div className="trust"><span>16 GB RAM</span><i /><span>4 vCPU</span><i /><span>Daily-grade backups</span><i /><span>Free</span></div>
        </div>
        <div className="mock" aria-hidden="true">
          <div className="mockbar"><i /><i /><i /><span>eagler / survival</span></div>
          <div className="mockbody">
            <div className="mockhead"><div className="sicon"><span className="dot running" /></div><div><b>Survival SMP</b><small>Minecraft 1.12.2 · Paper</small></div><span className="badge running">Online</span></div>
            <div className="mockstats"><div><small>Players</small><b>7<em>/30</em></b></div><div><small>RAM</small><b>6 GB</b></div><div><small>Uptime</small><b>3h 12m</b></div></div>
            <div className="mockaddr"><code>wss://survival.eagler.run</code><span>Copy</span></div>
            <div className="mockterm">
              <p><i>[12:01:14]</i> Done (3.4s)! For help, type "help"</p>
              <p className="j"><i>[12:03:52]</i> Steve joined the game</p>
              <p><i>[12:04:10]</i> [Essentials] Loaded 214 commands</p>
              <p className="c">&gt; say welcome to the server</p>
            </div>
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="sechead"><h2>Everything a host should have</h2><p>No upsells, no queues. The tools you would pay for elsewhere are just here.</p></div>
        <div className="feats">
          {FEATURES.map(([t, d, ic]) => (
            <div className="feat" key={t}><div className="ficon"><Icon d={ic} /></div><h3>{t}</h3><p>{d}</p></div>
          ))}
        </div>
      </section>

      <section className="sec">
        <div className="sechead"><h2>Live in three steps</h2></div>
        <div className="stepsrow">
          {STEPS.map(([t, d], i) => (<div className="stepc" key={t}><span className="num">{i + 1}</span><h3>{t}</h3><p>{d}</p></div>))}
        </div>
      </section>

      <section className="sec">
        <div className="plan">
          <div>
            <span className="pill">Included for everyone</span>
            <h2>One plan. Free.</h2>
            <p className="lead sm">Every server gets the same powerful machine.</p>
            <a className="btn primary xl" href="#/servers">Get started</a>
          </div>
          <ul className="specs">
            {[["Memory", "Up to 12 GB for the server"], ["CPU", "4 cores"], ["Storage", "14 GB disk, worlds saved to the cloud"], ["Uptime", "24/7 with automatic restarts"], ["Software", "Paper 1.12.2 + EaglerXServer"], ["Plugins", "spark, EssentialsX, LuckPerms, Vault, WorldEdit, PlaceholderAPI"], ["Control", "Live console, player tools, settings, backups"]].map(([k, v]) => (
              <li key={k}><span>{k}</span><b>{v}</b></li>))}
          </ul>
        </div>
      </section>

      <section className="sec narrow">
        <div className="sechead"><h2>Questions</h2></div>
        {FAQ.map(([q, a]) => (<details className="faq" key={q}><summary>{q}</summary><p>{a}</p></details>))}
      </section>
    </>
  );
}
