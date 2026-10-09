export type Version = {
  id: string;
  label: string;
  art?: string;
  desc: string;
  /** runtime name -> path of the playable page; empty = not available */
  runs: Record<string, string>;
};

export const VERSIONS: Version[] = [
  { id: "26.2", label: "26.2", art: "versions/26.png", desc: "The 26.2 zeus build with skins, as one self-contained HTML file.", runs: { "Single file": "play/26.2/" } },
  { id: "1.12.2", label: "1.12.2", art: "versions/1_12.png", desc: "The 1.12.2 port by PeytonPlayz585. The JavaScript build is slow; the WebAssembly build runs well.", runs: { WebAssembly: "play/1.12.2-wasm/", JavaScript: "play/1.12.2-js/" } },
];
