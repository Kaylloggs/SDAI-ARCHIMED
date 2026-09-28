import { categorize } from "@/core/chat/activity";
import type { TimelineItem } from "@/core/engine/session.store";

const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

/** Fichier visé par un outil d'écriture (Claude Code, Antigravity, Codex). */
function fileOf(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  return str(record.file_path) ?? str(record.path) ?? str(record.notebook_path) ?? str(record.TargetFile) ?? str(record.target_file);
}

/**
 * Fichiers créés ou modifiés lors du dernier tour qui a écrit quelque chose : on remonte la
 * conversation jusqu'au message de la personne qui précède ces écritures.
 */
export function editedFiles(timeline: TimelineItem[]): string[] {
  const files: string[] = [];
  for (let i = timeline.length - 1; i >= 0; i -= 1) {
    const item = timeline[i]!;
    if (item.kind === "user" && files.length > 0) break;
    if (item.kind !== "tool" || item.ok === false) continue;
    const category = categorize(item.tool);
    if (category !== "create" && category !== "edit") continue;
    const file = fileOf(item.input);
    if (file) files.push(file);
  }
  return files.reverse();
}

const parts = (path: string) => path.split(/[\\/]+/).filter(Boolean);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Dossier du projet sur lequel l'agent a travaillé : le dossier commun des fichiers écrits. Si
 * ce dossier est sous le dossier de travail de l'agent, on garde le premier niveau (le dossier
 * du projet créé là) : `<travail>/portfolio/src/a.ts` donne `<travail>/portfolio`.
 */
export function projectFolder(files: string[], cwd: string | null): string | null {
  const absolute = (file: string) => /^([a-zA-Z]:)?[\\/]/.test(file);
  const full = files.map((file) => (absolute(file) || !cwd ? file : `${cwd.replace(/[\\/]+$/, "")}/${file}`)).filter(absolute);
  if (full.length === 0) return null;
  const separator = full[0]!.includes("\\") ? "\\" : "/";
  const leading = full[0]!.startsWith("/") || full[0]!.startsWith("\\") ? separator : "";
  const dirs = full.map((file) => parts(file).slice(0, -1));
  let common = dirs[0]!;
  for (const dir of dirs.slice(1)) {
    let n = 0;
    while (n < common.length && n < dir.length && same(common[n]!, dir[n]!)) n += 1;
    common = common.slice(0, n);
  }
  if (common.length === 0) return null;
  const base = cwd ? parts(cwd) : [];
  const inside = base.length > 0 && common.length > base.length && base.every((segment, i) => same(segment, common[i]!));
  const folder = inside ? common.slice(0, base.length + 1) : common;
  return leading + folder.join(separator);
}
