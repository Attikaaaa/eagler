/* Gives the 26.2 client its Wisp endpoint and an offline profile (the hosted servers run in offline mode, no account needed).
   - ?wisp=wss://host   -> that server (Join button)
   - no parameter       -> the newest running 26.2 server, so Multiplayer > Direct Connection > Wisp works from the Play page too. */
(() => {
  const REPO = "Attikaaaa/eagler", q = new URLSearchParams(location.search);
  const nameNow = () => {
    let n = q.get("name") || localStorage.getItem("eagler-name") || prompt("Your player name (use the same one every time):", "Player" + Math.floor(1000 + Math.random() * 9000)) || "Player";
    n = n.replace(/[^A-Za-z0-9_]/g, "").slice(0, 16) || "Player"; localStorage.setItem("eagler-name", n); return n;
  };
  const idOf = (name) => { let h = 2166136261, id = ""; for (let i = 0; id.length < 32; i++) { h = Math.imul(h ^ (name.charCodeAt(i % name.length) + i), 16777619) >>> 0; id += h.toString(16).padStart(8, "0"); } return id.slice(0, 32); };
  const f = globalThis.fetch;
  globalThis.fetch = (u, o) => {
    if (!String(u).startsWith("https://api.minecraftservices.com/minecraft/profile")) return f(u, o);
    const name = nameNow();
    return Promise.resolve(new Response(JSON.stringify({ id: idOf(name), name }), { status: 200, headers: { "Content-Type": "application/json" } }));
  };
  const install = (url) => { globalThis.wispcraft = { wispUrl: url, authstore: { yggToken: "offline", user: { name: "player" } }, showSettingsUI() {} }; };
  const direct = q.get("wisp");
  if (direct) return install(direct);
  (async () => {
    let base = `https://api.github.com/repos/${REPO}`;
    try { // the gateway has no rate limit; fall back to the public API
      const g = await (await f(`https://raw.githubusercontent.com/${REPO}/data/gateway.json?t=${Math.floor(Date.now() / 20000)}`, { cache: "no-store" })).json();
      if (g.url && Date.now() - g.ts < 300000 && (await f(g.url + "/ping")).ok) base = `${g.url}/gh/repos/${REPO}`;
    } catch {}
    const dir = await (await f(`${base}/contents/servers?ref=data`, { cache: "no-store" })).json();
    const all = await Promise.all(dir.filter((x) => x.name.endsWith(".json")).map(async (x) => { try { const j = await (await f(`${base}/contents/${x.path}?ref=data`, { cache: "no-store" })).json(); return JSON.parse(atob(j.content.replace(/\n/g, ""))); } catch { return null; } }));
    const best = all.filter((s) => s && s.version === "26.2" && s.status === "running" && (s.addresses?.cloudflare || s.address)).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0];
    if (best) install(best.addresses?.cloudflare || best.address);
  })().catch(() => {});
})();
