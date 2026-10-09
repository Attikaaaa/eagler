// Runs one hosted server inside a GitHub Actions job:
// restore world -> start Paper+EaglerXServer -> tunnel -> keep state/world saved -> stop on request/idle.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";

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

async function getJson(p) {
  const r = await api(`contents/${p}?ref=data`);
  if (!r.ok) return null;
  const j = await r.json();
  return { sha: j.sha, data: JSON.parse(Buffer.from(j.content, "base64").toString()) };
}
async function putJson(p, obj) {
  for (let i = 0; i < 4; i++) {
    const cur = await getJson(p);
    const r = await api(`contents/${p}`, { method: "PUT", body: JSON.stringify({ message: `update ${p}`, branch: "data", content: Buffer.from(JSON.stringify(obj)).toString("base64"), ...(cur ? { sha: cur.sha } : {}) }) });
    if (r.ok) return true;
    await sleep(400 + Math.random() * 800);
  }
  return false;
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
const PROPS = { motd: "motd", maxPlayers: "max-players", difficulty: "difficulty", gamemode: "gamemode", pvp: "pvp", viewDistance: "view-distance", whitelist: "white-list", allowNether: "allow-nether", monsters: "spawn-monsters", animals: "spawn-animals", spawnProtection: "spawn-protection", seed: "level-seed", forceGamemode: "force-gamemode", commandBlocks: "enable-command-block" };
function applySettings(st, fresh) {
  const f = path.join(DIR, "server.properties");
  let txt = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
  const set = (k, v) => { const re = new RegExp(`^${k}=.*$`, "m"); txt = re.test(txt) ? txt.replace(re, `${k}=${v}`) : txt + `${txt.endsWith("\n") || !txt ? "" : "\n"}${k}=${v}\n`; };
  set("online-mode", "false"); set("server-port", "25565");
  for (const [k, prop] of Object.entries(PROPS)) { const v = st.settings?.[k]; if (v === undefined || v === "" || (k === "seed" && !fresh)) continue; set(prop, String(v).replace(/[\r\n]/g, " ")); }
  fs.writeFileSync(f, txt);
  const lst = path.join(DIR, "plugins/EaglercraftXServer/listener.yml");
  const motd = String(st.settings?.motd ?? st.name).replace(/'/g, "").replace(/[\r\n]/g, " ");
  if (fs.existsSync(lst)) fs.writeFileSync(lst, fs.readFileSync(lst, "utf8").replace(/server_motd:\n(?:- .*\n?)+/, `server_motd:\n- '${motd}'\n`));
}
async function provision(name, st, fresh) {
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
  if (!fs.existsSync(lst)) { fs.mkdirSync(path.dirname(lst), { recursive: true }); fs.writeFileSync(lst, `server_motd:\n- '${name.replace(/'/g, "")}'\n`); }
  applySettings(st || {}, fresh);
}

// ---------- plugins (resolved at start, jars are not stored in the world save)
const PLUGINS = {
  spark: { url: "https://sparkapi.lucko.me/download/bukkit" },
  vault: { gh: "MilkBowl/Vault", asset: "Vault.jar" },
  essentialsx: { modrinth: "essentialsx" },
  luckperms: { modrinth: "luckperms" },
  worldedit: { modrinth: "worldedit" },
  placeholderapi: { modrinth: "placeholderapi" },
};
async function installPlugins(ids) {
  const dir = path.join(DIR, "plugins");
  for (const id of ids) {
    const src = PLUGINS[id]; if (!src) continue;
    try {
      if (src.modrinth) {
        const v = await (await fetch(`https://api.modrinth.com/v2/project/${src.modrinth}/version?game_versions=%5B%221.12.2%22%5D&loaders=%5B%22paper%22%2C%22spigot%22%2C%22bukkit%22%5D`, { headers: { "User-Agent": "eagler-host/1.0" } })).json();
        const f = v[0].files.find((x) => x.primary) || v[0].files[0];
        fs.writeFileSync(path.join(dir, f.filename), Buffer.from(await (await fetch(f.url)).arrayBuffer()));
        log("plugin", id, f.filename);
      } else if (src.gh) {
        sh("gh", ["release", "download", "-R", src.gh, "-p", src.asset, "-D", dir, "--clobber"]);
        log("plugin", id, src.asset);
      } else {
        const r = await fetch(src.url, { headers: { "User-Agent": "eagler-host/1.0" } });
        const name = (r.headers.get("content-disposition") || "").match(/filename="?([^";]+)/)?.[1] || `${id}.jar`;
        fs.writeFileSync(path.join(dir, name), Buffer.from(await r.arrayBuffer()));
        log("plugin", id, name);
      }
    } catch (e) { log("plugin failed", id, String(e).slice(0, 150)); }
  }
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
const had = await restore();
if (!had) log("no saved world, creating a new one");
await provision(name, st0, !had);

const ram = Math.min(12, Math.max(1, Number(st0?.settings?.ramGb) || 5));
await installPlugins(st0?.settings?.plugins ?? ["spark", "vault", "essentialsx", "luckperms", "worldedit"]);
log(`host: ${os.cpus().length} cpus, ${(os.totalmem() / 2 ** 30).toFixed(1)} GB RAM; server heap ${ram} GB`);
await patch({ host: { cpus: os.cpus().length, totalGb: Math.round(os.totalmem() / 2 ** 30), ramGb: ram } });
const mc = spawn("java", [`-Xms${Math.min(ram, 2)}G`, `-Xmx${ram}G`, "-XX:+UseG1GC", "-XX:+ParallelRefProcEnabled", "-XX:MaxGCPauseMillis=200", "-jar", "paper.jar", "nogui"], { cwd: DIR });
const players = new Set(); let running = false, lastActive = Date.now(), logTail = [];
let saveWaiters = [];
let consoleBuf = [], consoleDirty = false;
const onLine = (l) => {
  process.stdout.write(l + "\n");
  consoleBuf.push(l.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")); if (consoleBuf.length > 250) consoleBuf.shift(); consoleDirty = true;
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
  await putJson(CON, { lines: consoleBuf.slice(-200), updated: Date.now() });
  await patch({ status: finalStatus, address: null, addresses: {}, players: 0, runId: null, ...extra });
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { await shutdown("signal " + sig); process.exit(0); });

let lastSave = Date.now(), lastBeat = 0, runningMarked = false, lastCon = 0, lastCmd = 0, cmdN = (await getJson(`cmd/${ID}.json`))?.data?.n || 0, startedAt = null;
const CMD = `cmd/${ID}.json`, CON = `console/${ID}.json`;
while (true) {
  await sleep(5000);
  if (exited) { await putJson(CON, { lines: consoleBuf.slice(-200), updated: Date.now() }); await patch({ status: "stopped", address: null, addresses: {}, players: 0, runId: null, error: logTail.slice(-8).join("\n") }); await saveWorld().catch(() => {}); break; }
  if (consoleDirty && Date.now() - lastCon > 7000) { lastCon = Date.now(); consoleDirty = false; await putJson(CON, { lines: consoleBuf.slice(-200), updated: Date.now() }); }
  if (running && Date.now() - lastCmd > 4000) {
    lastCmd = Date.now();
    const c = (await getJson(CMD))?.data;
    for (const it of (c?.items || []).filter((x) => x.n > cmdN)) { cmdN = it.n; log("console command:", it.cmd); if (!exited) cmd(String(it.cmd).replace(/[\r\n]/g, " ").replace(/^\//, "")); }
  }
  if (running && !runningMarked && (addrs.stable || addrs.cloudflare)) { runningMarked = true; startedAt = Date.now(); await patch({ startedAt }); await patch({ status: "running", address: addrs.stable || addrs.cloudflare, addresses: addrs }); }
  if (Date.now() - lastBeat > 30e3) {
    lastBeat = Date.now();
    const s = await getState();
    await patch({ players: players.size, playerNames: [...players], ...(runningMarked ? { status: "running" } : {}) });
    if (s?.want === "stop") { await shutdown("stop requested"); break; }
    if (s?.want === "restart") { await shutdown("restart requested", "starting", { want: "run", note: "Restarting..." }); fs.writeFileSync(path.join(TMP, "chain"), "1"); break; }
    if (s?.always === false && running && players.size === 0 && Date.now() - lastActive > IDLE_MS) { await shutdown("idle for 20 min", "stopped", { note: "Stopped automatically: nobody was online for 20 minutes." }); break; }
    if (Date.now() - t0 > MAX_MS) {
      await shutdown("job time limit, restarting", "starting", { want: "run", note: "Restarting after the 6h job limit." }); fs.writeFileSync(path.join(TMP, "chain"), "1");
      break;
    }
  }
  if (running && Date.now() - lastSave > SAVE_MS) { lastSave = Date.now(); await flush().catch((e) => log("save failed", e)); }
}
process.exit(0);
