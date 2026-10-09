// Runs one hosted server inside a GitHub Actions job:
// restore world -> start Paper+EaglerXServer -> tunnel -> keep state/world saved -> stop on request/idle.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ID = process.env.SERVER_ID, REPO = process.env.GITHUB_REPOSITORY, TOKEN = process.env.GITHUB_TOKEN;
const RUN_ID = process.env.GITHUB_RUN_ID, GENERATION = Number(process.env.GENERATION || 1);
const DIR = path.resolve("srv"), TMP = process.env.RUNNER_TEMP || "/tmp";
const PAPER = { url: "https://fill-data.papermc.io/v1/objects/3a2041807f492dcdc34ebb324a287414946e3e05ec3df6fd03f5b5f7d9afc210/paper-1.12.2-1620.jar", sha: "3a2041807f492dcdc34ebb324a287414946e3e05ec3df6fd03f5b5f7d9afc210" };
const IDLE_MS = 20 * 60e3, SAVE_MS = 10 * 60e3, MAX_MS = (5 * 60 + 40) * 60e3;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (cmd, args, o = {}) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", ...o });

// ---------- state on the `data` branch (servers/<id>.json)
const api = (p, o = {}) => fetch(`https://api.github.com/repos/${REPO}/${p}`, { ...o, headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "eagler-host", ...o.headers } });
const FILE = `servers/${ID}.json`;
async function getState() {
  const r = await api(`contents/${FILE}?ref=data`);
  if (r.status === 404) return null;
  const j = await r.json();
  return { sha: j.sha, ...JSON.parse(Buffer.from(j.content, "base64").toString()) };
}
async function patch(p) {
  for (let i = 0; i < 6; i++) {
    const cur = (await getState()) || { id: ID, name: ID, version: "1.12.2", created: Date.now() };
    const { sha, ...rest } = cur;
    const next = { ...rest, ...p, updated: Date.now() };
    const r = await api(`contents/${FILE}`, { method: "PUT", body: JSON.stringify({ message: `state ${ID}`, branch: "data", content: Buffer.from(JSON.stringify(next, null, 1)).toString("base64"), ...(sha ? { sha } : {}) }) });
    if (r.ok) return next;
    await sleep(500 + Math.random() * 1500);
  }
  log("could not write state");
}

// ---------- world storage in release `data` (two alternating slots, newest wins)
const slotName = (s) => `world-${ID}-${s}.tgz`;
async function assets() {
  const r = await api("releases/tags/data"); const j = await r.json();
  return (j.assets || []).filter((a) => a.name.startsWith(`world-${ID}-`));
}
async function restore() {
  const list = (await assets()).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  for (const a of list) {
    try {
      const f = path.join(TMP, a.name);
      sh("gh", ["release", "download", "data", "-R", REPO, "-p", a.name, "-D", TMP, "--clobber"]);
      fs.mkdirSync(DIR, { recursive: true });
      sh("tar", ["xzf", f, "-C", DIR]);
      log("restored world from", a.name, `(${(fs.statSync(f).size / 1e6).toFixed(1)} MB)`);
      return true;
    } catch (e) { log("restore failed for", a.name, String(e).slice(0, 200)); }
  }
  return false;
}
async function saveWorld() {
  const list = (await assets()).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const slot = list[0]?.name === slotName("a") ? "b" : "a";
  const f = path.join(TMP, slotName(slot));
  sh("tar", ["czf", f, "--exclude=*.jar", "--exclude=./logs", "--exclude=./cache", "--exclude=./plugins/EaglercraftXServer/drivers", "--exclude=./eagler_skins_cache.db*", "-C", DIR, "."]);
  sh("gh", ["release", "upload", "data", f, "-R", REPO, "--clobber"]);
  log("saved world ->", slotName(slot), `${(fs.statSync(f).size / 1e6).toFixed(1)} MB`);
}

// ---------- server files
async function provision(name) {
  fs.mkdirSync(path.join(DIR, "plugins"), { recursive: true });
  const jar = path.join(DIR, "paper.jar");
  if (!fs.existsSync(jar)) {
    const buf = Buffer.from(await (await fetch(PAPER.url)).arrayBuffer());
    if (crypto.createHash("sha256").update(buf).digest("hex") !== PAPER.sha) throw new Error("paper checksum mismatch");
    fs.writeFileSync(jar, buf);
  }
  sh("gh", ["release", "download", "v1.1.1", "-R", "lax1dude/eaglerxserver", "-p", "EaglerXServer.jar", "-D", path.join(DIR, "plugins"), "--clobber"]);
  fs.writeFileSync(path.join(DIR, "eula.txt"), "eula=true\n");
  const props = path.join(DIR, "server.properties");
  if (!fs.existsSync(props)) fs.writeFileSync(props, `online-mode=false\nserver-port=25565\nmotd=${name}\nmax-players=30\nview-distance=8\nenable-command-block=true\nspawn-protection=0\n`);
  const lst = path.join(DIR, "plugins/EaglercraftXServer/listener.yml");
  if (!fs.existsSync(lst)) { fs.mkdirSync(path.dirname(lst), { recursive: true }); fs.writeFileSync(lst, `server_motd:\n- '&6${name.replace(/'/g, "")}'\n`); }
}

// ---------- tunnels (public address)
function tunnels(onAddr) {
  const found = {};
  const emit = () => onAddr({ ...found });
  try {
    sh("curl", ["-sSL", "-o", "/tmp/cloudflared", "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"]);
    fs.chmodSync("/tmp/cloudflared", 0o755);
    const cf = spawn("/tmp/cloudflared", ["tunnel", "--no-autoupdate", "--url", "http://localhost:25565"]);
    const grab = (d) => { const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/); if (m && !found.cloudflare) { found.cloudflare = m[0].replace("https", "wss"); emit(); } };
    cf.stdout.on("data", grab); cf.stderr.on("data", grab);
  } catch (e) { log("cloudflared failed", String(e).slice(0, 150)); }
  // stable name (same address every start) when serveo is reachable
  const sub = `eagler-${ID}`.replace(/[^a-z0-9-]/g, "").slice(0, 40);
  const sv = spawn("ssh", ["-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "ServerAliveInterval=20", "-o", "ExitOnForwardFailure=yes", "-R", `${sub}:80:localhost:25565`, "serveo.net"]);
  const grab2 = (d) => { const m = String(d).match(/https:\/\/([a-z0-9-]+\.serveousercontent\.com|[a-z0-9-]+\.serveo\.net)/); if (m && !found.stable) { found.stable = m[0].replace("https", "wss"); emit(); } };
  sv.stdout.on("data", grab2); sv.stderr.on("data", grab2);
}

// ---------- main
const t0 = Date.now();
const st0 = await getState();
const name = st0?.name || ID;
await patch({ status: "starting", runId: RUN_ID, address: null, addresses: {}, players: 0 });
if (!(await restore())) log("no saved world, creating a new one");
await provision(name);

const mc = spawn("java", ["-Xms1G", "-Xmx5G", "-jar", "paper.jar", "nogui"], { cwd: DIR });
const players = new Set(); let running = false, lastActive = Date.now(), logTail = [];
let saveWaiters = [];
const onLine = (l) => {
  process.stdout.write(l + "\n");
  logTail.push(l); if (logTail.length > 60) logTail.shift();
  let m;
  if (/Done \(/.test(l)) { running = true; }
  if ((m = l.match(/\]: (\w+) joined the game/))) { players.add(m[1]); lastActive = Date.now(); }
  if ((m = l.match(/\]: (\w+) left the game/))) { players.delete(m[1]); lastActive = Date.now(); }
  if (/Saved the world|Saved the game/.test(l)) { saveWaiters.forEach((f) => f()); saveWaiters = []; }
};
let buf = ""; const feed = (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { onLine(buf.slice(0, i).trimEnd()); buf = buf.slice(i + 1); } };
mc.stdout.on("data", feed); mc.stderr.on("data", feed);
const cmd = (c) => mc.stdin.write(c + "\n");
let exited = false; mc.on("exit", (c) => { exited = true; log("minecraft exited", c); });

let addrs = {};
tunnels(async (a) => { addrs = a; await patch({ addresses: a, address: a.stable || a.cloudflare || null }); log("address", a); });

async function flush() {
  if (exited) return;
  cmd("save-all");
  await Promise.race([new Promise((r) => saveWaiters.push(r)), sleep(60000)]);
  await sleep(1500);
  await saveWorld();
}
async function shutdown(reason, finalStatus = "stopped", extra = {}) {
  log("stopping:", reason);
  await patch({ status: "stopping" });
  if (!exited) { cmd("save-all"); await sleep(2000); cmd("stop"); for (let i = 0; i < 90 && !exited; i++) await sleep(1000); if (!exited) mc.kill("SIGKILL"); }
  await saveWorld();
  await patch({ status: finalStatus, address: null, addresses: {}, players: 0, runId: null, ...extra });
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { await shutdown("signal " + sig); process.exit(0); });

let lastSave = Date.now(), lastBeat = 0, runningMarked = false;
while (true) {
  await sleep(5000);
  if (exited) { await patch({ status: "stopped", address: null, addresses: {}, players: 0, runId: null, error: logTail.slice(-8).join("\n") }); await saveWorld().catch(() => {}); break; }
  if (running && !runningMarked && (addrs.stable || addrs.cloudflare)) { runningMarked = true; await patch({ status: "running", address: addrs.stable || addrs.cloudflare, addresses: addrs }); }
  if (Date.now() - lastBeat > 30e3) {
    lastBeat = Date.now();
    const s = await getState();
    await patch({ players: players.size, playerNames: [...players], ...(runningMarked ? { status: "running" } : {}) });
    if (s?.want === "stop") { await shutdown("stop requested"); break; }
    if (running && players.size === 0 && Date.now() - lastActive > IDLE_MS) { await shutdown("idle for 20 min", "stopped", { note: "Stopped automatically: nobody was online for 20 minutes." }); break; }
    if (Date.now() - t0 > MAX_MS) {
      if (players.size > 0) { await shutdown("job time limit, restarting", "starting", { want: "run", note: "Restarting after the 6h job limit." }); fs.writeFileSync(path.join(TMP, "chain"), "1"); }
      else await shutdown("job time limit");
      break;
    }
  }
  if (running && Date.now() - lastSave > SAVE_MS) { lastSave = Date.now(); await flush().catch((e) => log("save failed", e)); }
}
process.exit(0);
