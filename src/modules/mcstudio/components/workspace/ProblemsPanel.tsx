import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, RefreshCw, XCircle } from "lucide-react";
import { cn } from "@/core/lib/cn";
import type { ValidationIssue } from "@/core/ipc/bindings/ValidationIssue";
import type { ValidationReport } from "@/core/ipc/bindings/ValidationReport";
import { focusRing } from "../ui";

/** Chemin raccourci pour la liste : on garde ce qui suit `src/main/resources/`. */
function shortPath(file: string): string {
  return file.replace(/^src\/main\/resources\//, "");
}

/** Résumé d'une vérification, en une ligne. */
export function problemsSummary(report: ValidationReport | undefined): string {
  if (!report) return "Pas encore vérifié";
  if (report.issues.length === 0) return `Aucun problème (${report.files} fichiers vérifiés)`;
  const parts = [];
  if (report.errors) parts.push(`${report.errors} erreur${report.errors > 1 ? "s" : ""}`);
  if (report.warnings) parts.push(`${report.warnings} avertissement${report.warnings > 1 ? "s" : ""}`);
  return parts.join(" · ");
}

/**
 * Panneau « Problèmes » sous l'éditeur : ce que le jeu refuserait ou ignorerait au
 * chargement. Un clic ouvre le fichier à la bonne ligne.
 */
export function ProblemsPanel({
  report,
  open,
  checking,
  onToggle,
  onCheck,
  onSelect,
}: {
  report: ValidationReport | undefined;
  open: boolean;
  checking: boolean;
  onToggle: () => void;
  onCheck: () => void;
  onSelect: (issue: ValidationIssue) => void;
}) {
  const clean = report && report.issues.length === 0;
  return (
    <section aria-label="Problèmes" className={cn("flex shrink-0 flex-col border-t border-border", open && "h-[200px]")}>
      <div className="flex h-8 shrink-0 items-center gap-2 px-3">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className={cn("flex min-w-0 flex-1 items-center gap-2 rounded-xs text-left text-footnote", focusRing)}
        >
          <ChevronDown size={12} className={cn("shrink-0 text-text-subtle transition-transform", !open && "-rotate-90")} />
          <span className="font-medium">Problèmes</span>
          <span
            className={cn(
              "truncate",
              report?.errors ? "text-danger" : report?.warnings ? "text-warning" : clean ? "text-success" : "text-text-subtle",
            )}
          >
            {problemsSummary(report)}
          </span>
        </button>
        <button
          type="button"
          aria-label="Vérifier le projet"
          title="Vérifier le projet (sans compiler)"
          disabled={checking}
          onClick={onCheck}
          className={cn(
            "flex size-6 items-center justify-center rounded-sm text-text-subtle hover:bg-surface-2 hover:text-text disabled:opacity-50",
            focusRing,
          )}
        >
          {checking ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        </button>
      </div>
      {open && (
        <div className="min-h-0 flex-1 overflow-y-auto pb-1">
          {clean ? (
            <p className="flex items-center gap-2 px-4 py-2 text-footnote text-text-muted">
              <CheckCircle2 size={14} className="text-success" />
              JSON, TOML, textures, références et format de la version : tout est cohérent.
            </p>
          ) : (
            <ul>
              {report?.issues.map((issue, index) => (
                <li key={`${issue.file}-${issue.line}-${index}`}>
                  <button
                    type="button"
                    onClick={() => onSelect(issue)}
                    className={cn("flex w-full items-start gap-2 px-4 py-1.5 text-left hover:bg-surface-2", focusRing)}
                  >
                    {issue.severity === "error" ? (
                      <XCircle size={14} className="mt-0.5 shrink-0 text-danger" />
                    ) : (
                      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-footnote">{issue.message}</span>
                      {issue.hint && <span className="block text-caption text-text-subtle">{issue.hint}</span>}
                    </span>
                    <span className="shrink-0 font-mono text-caption text-text-subtle">
                      {shortPath(issue.file)}
                      {issue.line !== null && `:${issue.line}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
