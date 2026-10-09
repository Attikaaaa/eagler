// Always-on gateway: lets the website control servers without any GitHub token on the visitor's side.
// It is a small allow-listed proxy for the GitHub API of THIS repo, running inside Actions with the workflow's own token.
// Its public address is published to gateway.json on the data branch (heartbeat), the site reads it from there.
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPO = process.env.GITHUB_REPOSITORY, TOKEN = process.env.GITHUB_TOKEN, TMP = process.env.RUNNER_TEMP || "/tmp";
const GEN = Number(process.env.GENERATION || 1), T0 = Date.now(), MAX_MS = (5 * 60 + 30) * 60e3, PORT = 8788;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gh = (p, o = {}) => fetch(`https://api.github.com/repos/${REPO}/${p}`, { ...o, headers: { Authorization: `Bearer ${TOKEN}`, "User-Agent": "eagler-gateway", ...o.headers } });

// what the website may do (everything else is refused)
const ALLOW = [
  ["GET", /^contents\/(servers|console|cmd|uploads|sync)(\/[\w.-]+)?$/],
  ["PUT", /^contents\/(servers|console|cmd|uploads|sync)\/[\w.-]+$/],
  ["DELETE", /^contents\/(servers|console|cmd|uploads|sync)\/[\w.-]+$/],
  ["GET", /^releases\/tags\/data$/],
  ["POST", /^actions\/workflows\/server\.yml\/dispatches$/],
];
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type,accept,authorization", "Access-Control-Allow-Methods": "GET,PUT,POST,DELETE,OPTIONS", "Access-Control-Max-Age": "600" };
const cache = new Map(); // short GET cache so many open panels do not burn the hourly API budget

const srv = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/ping") { res.writeHead(200, CORS); return res.end("ok"); }
    const m = u.pathname.match(/^\/gh\/repos\/[^/]+\/[^/]+\/(.+)$/);
    if (!m) { res.writeHead(404, CORS); return res.end("not found"); }
    const p = decodeURIComponent(m[1]);
    if (!ALLOW.some(([me, re]) => me === req.method && re.test(p))) { res.writeHead(403, CORS); return res.end("not allowed"); }
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > 130e6) { res.writeHead(413, CORS); return res.end("too large"); } chunks.push(c); }
    const body = Buffer.concat(chunks);
    if (req.method === "PUT" || req.method === "DELETE") { try { if (JSON.parse(body.toString()).branch !== "data") throw 0; } catch { res.writeHead(403, CORS); return res.end("data branch only"); } }
    const accept = req.headers.accept || "application/vnd.github+json";
    const key = req.method === "GET" ? `${p}${u.search}|${accept}` : null;
    const hit = key && cache.get(key);
    if (hit && Date.now() - hit.t < 3000) { res.writeHead(hit.status, { ...CORS, "Content-Type": hit.type }); return res.end(hit.body); }
    const r = await gh(`${p}${u.search}`, { method: req.method, body: req.method === "GET" ? undefined : body, headers: { Accept: accept, "Content-Type": "application/json" } });
    const out = Buffer.from(await r.arrayBuffer()), type = r.headers.get("content-type") || "application/json";
    if (key) cache.set(key, { t: Date.now(), status: r.status, type, body: out }); else cache.clear();
    if (cache.size > 200) cache.clear();
    res.writeHead(r.status, { ...CORS, "Content-Type": type }); res.end(out);
  } catch (e) { res.writeHead(502, CORS); res.end("gateway error"); }
});
srv.listen(PORT);

// ---- public address
let url = null;
async function publish() {
  if (!url) return;
  const f = "gateway.json";
  for (let i = 0; i < 5; i++) {
    const cur = await gh(`contents/${f}?ref=data`); const sha = cur.ok ? (await cur.json()).sha : undefined;
    const r = await gh(`contents/${f}`, { method: "PUT", body: JSON.stringify({ message: "gateway", branch: "data", content: Buffer.from(JSON.stringify({ url, ts: Date.now(), gen: T0 })).toString("base64"), ...(sha ? { sha } : {}) }) });
    if (r.ok) return;
    await sleep(500 + Math.random() * 1000);
  }
}
sh();
function sh() {
  try {
    execFileSync("curl", ["-sSL", "-o", "/tmp/cloudflared", "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"]);
    fs.chmodSync("/tmp/cloudflared", 0o755);
    const cf = spawn("/tmp/cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://localhost:${PORT}`]);
    const grab = (d) => { const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/); if (m && !url) { url = m[0]; log("gateway", url); publish(); } };
    cf.stdout.on("data", grab); cf.stderr.on("data", grab);
    cf.on("exit", () => { log("tunnel ended"); process.exit(1); });
  } catch (e) { log("tunnel failed", String(e).slice(0, 150)); process.exit(1); }
}

let chained = false;
for (;;) {
  await sleep(30000);
  if (!chained) await publish();
  if (!chained && Date.now() - T0 > MAX_MS) {
    chained = true; log("handing over to a new gateway");
    try { execFileSync("gh", ["workflow", "run", "gateway.yml", "-R", REPO, "-f", `generation=${GEN + 1}`], { stdio: "inherit" }); } catch (e) { log("handover failed", String(e).slice(0, 100)); }
    setTimeout(() => process.exit(0), 4 * 60e3);
  }
}
