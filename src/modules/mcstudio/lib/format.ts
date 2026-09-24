import type { LoaderId } from "@/core/ipc/bindings/LoaderId";

export const LOADER_LABEL: Record<LoaderId, string> = {
  fabric: "Fabric",
  forge: "Forge",
  neoforge: "NeoForge",
};

/** « il y a 3 min », « hier », « 12 sept. ». */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "à l'instant";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  if (days === 1) return "hier";
  if (days < 7) return `il y a ${days} jours`;
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

/** 8 432 ms → « 9 s », 125 000 → « 2 min 05 s ». */
export function seconds(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.ceil(ms / 1000))} s`;
  const minutes = Math.floor(ms / 60_000);
  const rest = Math.floor((ms % 60_000) / 1000);
  return `${minutes} min ${String(rest).padStart(2, "0")} s`;
}

/** Dernier segment d'un chemin, séparateurs Windows compris. */
export function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Joint des segments avec le séparateur du chemin de base. */
export function joinPath(base: string, ...parts: string[]): string {
  const separator = base.includes("\\") ? "\\" : "/";
  return [base.replace(/[\\/]+$/, ""), ...parts].join(separator);
}
