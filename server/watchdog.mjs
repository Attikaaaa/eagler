// Restarts servers that should be running (want=run) but whose job is gone.
const REPO = process.env.GITHUB_REPOSITORY, T = process.env.GITHUB_TOKEN;
const h = { Authorization: `Bearer ${T}`, Accept: "application/vnd.github+json", "User-Agent": "eagler-host" };
const api = (p, o = {}) => fetch(`https://api.github.com/repos/${REPO}/${p}`, { ...o, headers: h });
const dir = await (await api("contents/servers?ref=data")).json();
if (!Array.isArray(dir)) process.exit(0);
const runs = (await (await api("actions/workflows/server.yml/runs?per_page=50&status=in_progress")).json()).workflow_runs || [];
const queued = (await (await api("actions/workflows/server.yml/runs?per_page=50&status=queued")).json()).workflow_runs || [];
for (const f of dir) {
  if (!f.name.endsWith(".json")) continue;
  const j = await (await api(`contents/${f.path}?ref=data`)).json();
  const st = JSON.parse(Buffer.from(j.content, "base64").toString());
  if (st.want !== "run") continue;
  const alive = [...runs, ...queued].some((r) => (r.display_title || "").includes(st.id) || r.id == st.runId);
  const stale = Date.now() - (st.updated || 0) > 6 * 60e3;
  if (alive && !(st.status === "running" && stale && false)) continue;
  console.log("restarting", st.id);
  await api("actions/workflows/server.yml/dispatches", { method: "POST", body: JSON.stringify({ ref: "main", inputs: { id: st.id } }) });
}
