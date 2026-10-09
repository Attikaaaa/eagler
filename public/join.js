/* ?server=wss://host -> make the game join that server on startup */
(() => {
  const s = new URLSearchParams(location.search).get("server");
  if (!s) return;
  let cur;
  Object.defineProperty(window, "eaglercraftXOpts", { configurable: true, get: () => cur, set: (v) => { if (v && typeof v === "object") v.joinServer = s; cur = v; } });
})();
