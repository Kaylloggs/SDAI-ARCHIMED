import type { BuildRecord } from "@/core/ipc/bindings/BuildRecord";
import type { WorkChange } from "@/core/ipc/bindings/WorkChange";

/** Corrections d'affilée après un build en échec avant de passer la main à la personne. */
export const MAX_FIX_ROUNDS = 3;

/** Message préparé pour l'IA à partir d'un build en échec (la personne le relit et l'envoie). */
export function fixRequest(record: BuildRecord): string {
  const what =
    record.task === "runClient"
      ? "La partie de test du vrai projet (gradlew runClient) a échoué"
      : "La compilation du vrai projet a échoué";
  const lines = [
    `${what} (Gradle, code de sortie ${record.exitCode ?? "inconnu"}). ${record.summary}`,
    "",
    "Erreurs relevées par Mod Studio :",
  ];
  const issues = record.issues.slice(0, 12);
  if (issues.length === 0) lines.push("- (aucune erreur localisée : lis la fin du journal de build)");
  for (const issue of issues) {
    const where = issue.file ? `${issue.file}${issue.line !== null ? `:${issue.line}` : ""} — ` : "";
    const hint = issue.hint ? ` (piste : ${issue.hint})` : "";
    lines.push(`- ${where}${issue.title} : ${issue.message.split("\n")[0]}${hint}`);
  }
  if (record.issues.length > issues.length) lines.push(`- … et ${record.issues.length - issues.length} autre(s).`);
  lines.push(
    "",
    "Corrige ces erreurs dans ta copie, puis relance la compilation pour vérifier avant de conclure. Ne change pas build.gradle sauf si l'erreur vient de là.",
  );
  return lines.join("\n");
}

/** Sélection par défaut : tout, sauf les conflits (à cocher en connaissance de cause). */
export function defaultSelection(changes: WorkChange[]): Set<string> {
  return new Set(changes.filter((change) => !change.conflict).map((change) => change.path));
}

export const CHANGE_LABEL: Record<WorkChange["kind"], string> = {
  added: "Nouveau",
  modified: "Modifié",
  deleted: "Supprimé",
};
