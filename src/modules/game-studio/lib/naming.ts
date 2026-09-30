/** Mêmes règles que `folder_name` côté Rust (engines/mod.rs) : aperçu du dossier créé. */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function folderName(name: string): string {
  const joined = fold(name).split(" ").filter(Boolean).join("-");
  if (!joined) return "Nouveau-jeu";
  return (joined[0]!.toUpperCase() + joined.slice(1)).slice(0, 48);
}

/** Séparateur du chemin d'après le dossier parent (Windows ou autre). */
export function joinPath(parent: string, child: string): string {
  const sep = parent.includes("\\") ? "\\" : "/";
  return `${parent.replace(/[\\/]+$/, "")}${sep}${child}`;
}
