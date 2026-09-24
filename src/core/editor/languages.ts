import { loadLanguage, type LanguageName } from "@uiw/codemirror-extensions-langs";

/** Correspondance langage backend → extension CodeMirror. */
export const LANGUAGE_MAP: Record<string, LanguageName> = {
  typescript: "ts",
  tsx: "tsx",
  javascript: "js",
  jsx: "jsx",
  rust: "rs",
  python: "py",
  go: "go",
  java: "java",
  kotlin: "kt",
  swift: "swift",
  c: "c",
  cpp: "cpp",
  csharp: "cs",
  php: "php",
  ruby: "rb",
  shell: "sh",
  powershell: "ps1",
  sql: "sql",
  html: "html",
  css: "css",
  sass: "scss",
  json: "json",
  yaml: "yaml",
  toml: "toml",
  xml: "xml",
  markdown: "md",
  vue: "vue",
  svelte: "svelte",
  dart: "dart",
  lua: "lua",
  r: "r",
  elixir: "erl",
  zig: "rs",
  dockerfile: "sh",
  makefile: "sh",
  groovy: "groovy",
  properties: "properties",
};

/** Extension de fichier → nom de langage (mêmes noms que le backend du module Code). */
const EXTENSIONS: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx",
  rs: "rust", py: "python", go: "go", java: "java", kt: "kotlin", kts: "kotlin", swift: "swift",
  c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp", php: "php", rb: "ruby", sh: "shell",
  ps1: "powershell", sql: "sql", html: "html", htm: "html", css: "css", scss: "sass",
  json: "json", mcmeta: "json", yaml: "yaml", yml: "yaml", toml: "toml", xml: "xml", md: "markdown",
  gradle: "groovy", groovy: "groovy", properties: "properties", cfg: "properties", lang: "properties",
};

/** Langage d'un chemin d'après son extension (`null` : texte brut). */
export function languageOfPath(path: string): string | null {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? (EXTENSIONS[name.slice(dot + 1).toLowerCase()] ?? null) : null;
}

/** Extension CodeMirror d'un langage, si elle existe. */
export function languageExtension(language: string | null) {
  const name = language ? LANGUAGE_MAP[language] : undefined;
  return name ? loadLanguage(name) : null;
}
