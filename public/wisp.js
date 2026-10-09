/* ?wisp=wss://host[&name=Player] -> tells the 26.2 client where its Wisp endpoint is and gives it an offline profile
   (the hosted servers run in offline mode, so no Mojang account is needed). */
(() => {
  const q = new URLSearchParams(location.search), url = q.get("wisp");
  if (!url) return;
  const name = (q.get("name") || localStorage.getItem("eagler-name") || prompt("Your player name (use the same one every time):", "Player" + Math.floor(1000 + Math.random() * 9000)) || "Player").replace(/[^A-Za-z0-9_]/g, "").slice(0, 16) || "Player";
  localStorage.setItem("eagler-name", name);
  let h = 2166136261, id = "";
  for (let i = 0; id.length < 32; i++) { h = Math.imul(h ^ (name.charCodeAt(i % name.length) + i), 16777619) >>> 0; id += h.toString(16).padStart(8, "0"); }
  id = id.slice(0, 32);
  globalThis.wispcraft = { wispUrl: url, authstore: { yggToken: "offline", user: { name } }, showSettingsUI() {} };
  const f = globalThis.fetch;
  globalThis.fetch = (u, o) => String(u).startsWith("https://api.minecraftservices.com/minecraft/profile")
    ? Promise.resolve(new Response(JSON.stringify({ id, name }), { status: 200, headers: { "Content-Type": "application/json" } }))
    : f(u, o);
})();
