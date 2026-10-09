export const PLUGINS: { id: string; name: string; desc: string; on: boolean }[] = [
  { id: "spark", name: "spark", desc: "Performance profiler: /spark tps, /spark profiler, memory and lag diagnosis.", on: true },
  { id: "essentialsx", name: "EssentialsX", desc: "Homes, warps, kits, /tpa, /spawn, economy, chat and 100+ commands.", on: true },
  { id: "luckperms", name: "LuckPerms", desc: "Permissions and ranks with an in-game editor (/lp).", on: true },
  { id: "vault", name: "Vault", desc: "Bridge between permission, chat and economy plugins.", on: true },
  { id: "worldedit", name: "WorldEdit", desc: "In-game building tools: wand, //set, //copy, //paste (version 6.1.9 for 1.12).", on: true },
  { id: "placeholderapi", name: "PlaceholderAPI", desc: "Placeholders for chat, scoreboards and other plugins.", on: false },
];
export const DEFAULT_PLUGINS = PLUGINS.filter((p) => p.on).map((p) => p.id);
