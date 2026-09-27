import { AlertTriangle, CheckCircle2, Info, Loader2, Wand2, XCircle } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Button } from "@/design-system/primitives";
import type { CheckIssue, CheckLevel, DraftReport } from "../../api";
import { formatSize } from "./ui";

type Props = {
  report: DraftReport | null;
  error: string | null;
  /** Ouvre un fichier du skill à une ligne (onglet Fichiers). */
  onReveal: (file: string, line: number) => void;
  /** Dépose une demande de correction dans la saisie de l'atelier. */
  onFix: () => void;
};

const LEVELS: { level: CheckLevel; title: string; icon: typeof XCircle; tone: string }[] = [
  { level: "error", title: "À corriger", icon: XCircle, tone: "text-danger" },
  { level: "warning", title: "À améliorer", icon: AlertTriangle, tone: "text-warning" },
  { level: "info", title: "Pour information", icon: Info, tone: "text-info" },
];

const NAME_MAX = 64;
const DESCRIPTION_MAX = 1024;
const BODY_MAX = 500;

function Meter({ label, value, max, unit }: { label: string; value: number; max: number; unit: string }) {
  const ratio = Math.min(1, value / max);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-footnote">
        <span className="text-text-muted">{label}</span>
        <span className={cn("tabular-nums", value > max ? "text-danger" : "text-text-subtle")}>
          {value} / {max} {unit}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn("h-full rounded-full", value > max ? "bg-danger" : ratio > 0.85 ? "bg-warning" : "bg-accent")}
          style={{ width: `${Math.max(2, ratio * 100)}%` }}
        />
      </div>
    </div>
  );
}

function IssueRow({ issue, onReveal }: { issue: CheckIssue; onReveal: Props["onReveal"] }) {
  const where = issue.file ? `${issue.file}${issue.line ? `:${issue.line}` : ""}` : null;
  const body = (
    <>
      <span className="text-body-sm text-text">{issue.message}</span>
      {where && <span className="block truncate font-mono text-caption text-text-subtle">{where}</span>}
    </>
  );
  return issue.file ? (
    <button
      type="button"
      onClick={() => onReveal(issue.file!, issue.line ?? 1)}
      className="block w-full min-w-0 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
      title="Ouvrir dans l'onglet Fichiers"
    >
      {body}
    </button>
  ) : (
    <div className="min-w-0 px-2 py-1.5">{body}</div>
  );
}

/** Contrôle du skill : format, description, taille, liens, secrets, commandes risquées. */
export function CheckTab({ report, error, onReveal, onFix }: Props) {
  if (error) return <p className="px-4 py-4 text-footnote text-text-muted">{error}</p>;
  if (!report) {
    return (
      <div className="flex justify-center py-12 text-text-subtle">
        <Loader2 size={16} className="animate-spin" aria-label="Vérification…" />
      </div>
    );
  }

  const errors = report.issues.filter((i) => i.level === "error").length;
  const warnings = report.issues.filter((i) => i.level === "warning").length;
  const fixable = errors + warnings > 0;

  return (
    <div className="flex flex-col gap-4 px-4 py-3">
      <div
        className={cn(
          "flex items-start gap-2 rounded-md px-3 py-2",
          report.ready ? (warnings > 0 ? "bg-warning-soft" : "bg-success-soft") : "bg-danger-soft",
        )}
      >
        {report.ready ? (
          <CheckCircle2 size={16} strokeWidth={1.75} className={cn("mt-0.5 shrink-0", warnings > 0 ? "text-warning" : "text-success")} aria-hidden />
        ) : (
          <XCircle size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-danger" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-body-sm font-medium">
            {report.ready
              ? warnings > 0
                ? `Enregistrable, ${warnings} point${warnings > 1 ? "s" : ""} à améliorer`
                : "Prêt à enregistrer"
              : `${errors} erreur${errors > 1 ? "s" : ""} à corriger avant d'enregistrer`}
          </p>
          <p className="text-footnote text-text-muted">
            {report.files} fichier{report.files > 1 ? "s" : ""} · {formatSize(report.bytes)}
            {report.scripts.length > 0 && ` · ${report.scripts.length} script${report.scripts.length > 1 ? "s" : ""}`}
          </p>
        </div>
        {fixable && (
          <Button size="sm" variant="secondary" onClick={onFix} icon={<Wand2 size={13} strokeWidth={1.75} />}>
            Corriger avec l'IA
          </Button>
        )}
      </div>

      {(report.name || report.description) && (
        <section aria-label="Déclenchement" className="space-y-2">
          <p className="text-footnote font-medium text-text-muted">Ce que voit l'IA avant d'ouvrir le skill</p>
          <div className="space-y-1 rounded-md border border-border bg-surface-1 px-3 py-2">
            <p className="font-mono text-body-sm">{report.name ?? "—"}</p>
            <p className="text-footnote text-text-muted [overflow-wrap:anywhere]">{report.description ?? "Pas de description."}</p>
          </div>
          <Meter label="Nom" value={report.name?.length ?? 0} max={NAME_MAX} unit="car." />
          <Meter label="Description" value={report.description?.length ?? 0} max={DESCRIPTION_MAX} unit="car." />
          <Meter label="Corps de SKILL.md" value={report.bodyLines} max={BODY_MAX} unit="lignes" />
        </section>
      )}

      {LEVELS.map(({ level, title, icon: Icon, tone }) => {
        const issues = report.issues.filter((issue) => issue.level === level);
        if (issues.length === 0) return null;
        return (
          <section key={level} aria-label={title} className="space-y-1">
            <p className="flex items-center gap-1.5 text-footnote font-medium text-text-muted">
              <Icon size={13} strokeWidth={1.75} className={tone} aria-hidden />
              {title}
              <span className="tabular-nums text-text-subtle">{issues.length}</span>
            </p>
            <ul className="-mx-2">
              {issues.map((issue, index) => (
                <li key={`${issue.code}-${issue.file ?? ""}-${issue.line ?? 0}-${index}`}>
                  <IssueRow issue={issue} onReveal={onReveal} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {report.issues.length === 0 && <p className="text-footnote text-text-subtle">Aucune remarque : le skill respecte le format et les bonnes pratiques.</p>}
    </div>
  );
}
