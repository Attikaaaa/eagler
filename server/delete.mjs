// Removes saved worlds of a deleted server from release `data`.
const ID = process.env.SERVER_ID, REPO = process.env.GITHUB_REPOSITORY, T = process.env.GITHUB_TOKEN;
const h = { Authorization: `Bearer ${T}`, Accept: "application/vnd.github+json", "User-Agent": "eagler-host" };
const j = await (await fetch(`https://api.github.com/repos/${REPO}/releases/tags/data`, { headers: h })).json();
for (const a of j.assets || []) if (a.name.startsWith(`world-${ID}-`) || a.name.startsWith(`backup-${ID}-`)) { await fetch(`https://api.github.com/repos/${REPO}/releases/assets/${a.id}`, { method: "DELETE", headers: h }); console.log("deleted", a.name); }
