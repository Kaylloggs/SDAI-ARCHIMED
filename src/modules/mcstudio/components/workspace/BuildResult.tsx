import { useState } from "react";
import { Check, CheckCircle2, CircleSlash, Copy, FolderOpen, Lightbulb, XCircle } from "lucide-react";
import { engineApi } from "@/core/engine/engine.api";
import { cn } from "@/core/lib/cn";
import { Button } from "@/design-system/primitives";
import type { BuildIssue } from "@/core/ipc/bindings/BuildIssue";
import type { BuildRecord } from "@/core/ipc/bindings/BuildRecord";
import { ago, seconds } from "../../lib/format";

const KIND_LABEL: Record<BuildIssue["kind"], string> = {
  java: "Erreur Java",
  gradle: "Erreur Gradle",
  json: "Erreur JSON",
  dependency: "Dépendance",
  network: "Réseau",
  javaVersion: "Version de Java",
  mapping: "API / mappings",
  crash: "Plantage du jeu",
  unknown: "Erreur",
};

function IssueItem({ issue }: { issue: BuildIssue }) {
  const location = issue.file ? `${issue.file}${issue.line ? `:${issue.line}` : ""}` : null;
  return (
    <li className="space-y-1.5 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-caption font-medium text-danger">{KIND_LABEL[issue.kind]}</span>
        <p className="text-body-sm font-medium">{issue.title}</p>
      </div>
      {location && <p className="selectable font-mono text-footnote text-text-muted">{location}</p>}
      <pre className="selectable whitespace-pre-wrap break-words rounded-sm bg-bg px-2 py-1.5 font-mono text-footnote text-text-muted">
        {issue.message}
      </pre>
      {issue.hint && (
        <p className="flex gap-1.5 text-footnote text-text-muted">
          <Lightbulb size={14} className="mt-px shrink-0 text-accent" />
          <span>{issue.hint}</span>
        </p>
      )}
    </li>
  );
}

export function BuildResult({ record }: { record: BuildRecord }) {
  const [copied, setCopied] = useState(false);
  const jar = record.dist ?? record.jar;
  const playing = record.task === "runClient";
  const look = {
    success: { Icon: CheckCircle2, tone: "text-success", title: playing ? "Partie de test terminée" : "BUILD SUCCESSFUL", frame: "border-success/35" },
    failed: { Icon: XCircle, tone: "text-danger", title: playing ? "Le jeu n'a pas pu tourner" : "Échec de la compilation", frame: "border-danger/35" },
    cancelled: { Icon: CircleSlash, tone: "text-text-subtle", title: playing ? "Partie arrêtée" : "Compilation interrompue", frame: "border-border" },
  }[record.status];

  const copy = async () => {
    if (!jar) return;
    await navigator.clipboard.writeText(jar);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className={cn("overflow-hidden rounded-md border bg-surface-1", look.frame)}>
      <div className="flex items-start gap-3 px-4 py-3">
        <look.Icon size={18} strokeWidth={1.75} className={cn("mt-0.5 shrink-0", look.tone)} />
        <div className="min-w-0 flex-1 space-y-1">
          <p className={cn("text-body-sm font-semibold", record.status === "success" && "font-mono tracking-wide")}>{look.title}</p>
          <p className="text-footnote text-text-muted">{record.summary}</p>
          <p className="text-caption text-text-subtle">
            {ago(record.startedAt)}
            {record.durationMs > 0 && ` · ${seconds(record.durationMs)}`}
            {record.exitCode !== null && ` · code de sortie ${record.exitCode}`}
          </p>
        </div>
      </div>

      {record.status === "success" && jar && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
          <p className="selectable min-w-0 flex-1 truncate font-mono text-footnote">
            {jar}
          </p>
          <Button size="sm" onClick={() => void copy()} icon={copied ? <Check size={12} /> : <Copy size={12} />}>
            {copied ? "Copié" : "Copier le chemin"}
          </Button>
          <Button size="sm" onClick={() => void engineApi.revealPath(jar)} icon={<FolderOpen size={12} />}>
            Afficher le .jar
          </Button>
        </div>
      )}

      {record.issues.length > 0 && (
        <ul aria-label="Causes probables" className="divide-y divide-border border-t border-border">
          {record.issues.slice(0, 8).map((issue, index) => (
            <IssueItem key={`${issue.title}-${index}`} issue={issue} />
          ))}
          {record.issues.length > 8 && (
            <li className="px-4 py-2 text-footnote text-text-subtle">
              {record.issues.length - 8} autres erreurs dans le journal complet.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
