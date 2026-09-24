import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronRight, GitCompareArrows, Hammer, Loader2, RefreshCw, RotateCcw, X } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { DiffView } from "@/core/cards/DiffView";
import { diffLines, diffStats } from "@/core/lib/diff";
import { Badge, Button } from "@/design-system/primitives";
import type { WorkChange } from "@/core/ipc/bindings/WorkChange";
import { errorText, mcstudioApi } from "../../api";
import { useEditorStore } from "../../editor";
import { CHANGE_LABEL, defaultSelection } from "../../lib/assistant";
import { useMcStudioStore } from "../../store";
import { Checker, focusRing, PixelImage } from "../ui";
import { problemsSummary } from "./ProblemsPanel";

/** Case à cocher aux couleurs du thème (pas de case native, design.md §7.4). */
function Tick({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onChange();
      }}
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-xs border transition-colors",
        checked ? "border-accent bg-accent text-accent-fg" : "border-border-strong bg-surface-1",
        focusRing,
      )}
    >
      {checked && <Check size={11} strokeWidth={3} />}
    </button>
  );
}

function ChangeRow({
  change,
  selected,
  onToggle,
  revision,
}: {
  change: WorkChange;
  selected: boolean;
  onToggle: () => void;
  /** Change à chaque relecture de la copie : l'aperçu d'image est rechargé. */
  revision: number;
}) {
  const [open, setOpen] = useState(false);
  const stats = useMemo(
    () => (change.binary ? null : diffStats(diffLines(change.before, change.after))),
    [change],
  );
  const image = /\.(png|jpe?g|webp|gif)$/i.test(change.path);
  const name = change.path.split("/").pop() ?? change.path;
  const folder = change.path.slice(0, change.path.length - name.length);

  return (
    <li className="border-b border-border last:border-b-0">
      <div className="flex items-center gap-2 px-3 py-2">
        <Tick checked={selected} onChange={onToggle} label={`Garder ${change.path}`} />
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={cn("flex min-w-0 flex-1 items-center gap-2 rounded-xs text-left", focusRing)}
        >
          <ChevronRight size={12} className={cn("shrink-0 text-text-subtle transition-transform", open && "rotate-90")} />
          <span className="flex min-w-0 flex-1 items-baseline gap-2" title={change.path}>
            <span className="shrink-0 font-mono text-footnote">{name}</span>
            <span className="truncate font-mono text-caption text-text-subtle" dir="rtl">
              {folder.replace(/\/$/, "")}
            </span>
          </span>
          {change.conflict && (
            <span title="Ce fichier a aussi changé dans le projet depuis la copie : l'appliquer écrase ce changement.">
              <AlertTriangle size={13} className="shrink-0 text-warning" />
            </span>
          )}
          {stats && (
            <span className="shrink-0 font-mono text-caption">
              <span className="text-success">+{stats.added}</span> <span className="text-danger">−{stats.removed}</span>
            </span>
          )}
          <Badge>{CHANGE_LABEL[change.kind]}</Badge>
        </button>
      </div>
      {open && (
        <div className="px-3 pb-3">
          {change.conflict && (
            <p className="mb-2 rounded-sm bg-warning-soft px-2 py-1.5 text-footnote">
              Vous avez aussi modifié ce fichier depuis que l'IA a commencé : « avant » montre votre version actuelle,
              qui serait remplacée.
            </p>
          )}
          {change.binary ? (
            image && change.kind !== "deleted" ? (
              <Checker size={136}>
                <PixelImage path={change.workPath} version={revision} size={128} alt={change.path} />
              </Checker>
            ) : (
              <p className="text-footnote text-text-subtle">Fichier binaire : pas d'aperçu du contenu.</p>
            )
          ) : (
            <DiffView path={change.path} before={change.before} after={change.after} bare collapseAfter={60} />
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Modifications que l'IA a faites dans sa copie de travail : relues fichier par fichier,
 * puis appliquées au projet (après un point de restauration) ou rejetées.
 */
export function ChangesPanel({
  projectId,
  changes,
  loading,
  revision,
  onRefresh,
  onBuild,
}: {
  projectId: string;
  changes: WorkChange[];
  loading: boolean;
  revision: number;
  onRefresh: () => void;
  onBuild: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => defaultSelection(changes));
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const report = useEditorStore((s) => s.reports[projectId]);
  const building = useMcStudioStore((s) => s.builds[projectId]?.running ?? false);

  // Nouvelle liste : sélection par défaut, en gardant les choix déjà faits.
  const signature = changes.map((c) => `${c.path}:${c.kind}`).join("|");
  useEffect(() => {
    setSelected((current) => {
      const next = defaultSelection(changes);
      for (const change of changes) if (current.has(change.path)) next.add(change.path);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const chosen = changes.filter((change) => selected.has(change.path)).map((change) => change.path);
  const toggle = (path: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      onRefresh();
    }
  };

  const apply = () =>
    run(async () => {
      const outcome = await mcstudioApi.agentApply(projectId, chosen);
      const editor = useEditorStore.getState();
      await editor.refreshClean(projectId);
      await editor.validate(projectId).catch(() => undefined);
      if (outcome.applied.some((path) => path.endsWith("/icon.png"))) useMcStudioStore.getState().bumpIcon(projectId);
      setNotice(
        `${outcome.applied.length} fichier${outcome.applied.length > 1 ? "s" : ""} appliqué${
          outcome.applied.length > 1 ? "s" : ""
        } au projet. Pour annuler : Tableau de bord → Points de restauration → « ${outcome.snapshot.label} ».`,
      );
    });

  const discard = () =>
    run(async () => {
      await mcstudioApi.agentDiscard(projectId, chosen);
      setNotice("Modifications rejetées : la copie de l'IA reprend la version du projet.");
    });

  const reset = () =>
    run(async () => {
      await mcstudioApi.agentReset(projectId);
      setConfirmReset(false);
      setNotice("Copie de travail refaite à partir du projet.");
    });

  return (
    <section aria-labelledby="mc-changes" className="flex min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <GitCompareArrows size={14} className="text-text-subtle" />
        <h2 id="mc-changes" className="flex-1 text-body-sm font-semibold">
          Modifications proposées {changes.length > 0 && <span className="font-normal text-text-subtle">· {changes.length}</span>}
        </h2>
        <button
          type="button"
          aria-label="Relire la copie de l'IA"
          title="Relire la copie de l'IA"
          onClick={onRefresh}
          className={cn("flex size-7 items-center justify-center rounded-sm text-text-subtle hover:bg-surface-2 hover:text-text", focusRing)}
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {changes.length === 0 ? (
          <p className="px-4 py-4 text-footnote text-text-subtle">
            Aucune modification en attente. L'IA travaille dans une copie du projet : ce qu'elle crée, modifie ou
            supprime apparaît ici, et n'entre dans le projet que si vous l'appliquez.
          </p>
        ) : (
          <ul aria-label="Fichiers modifiés par l'IA">
            {changes.map((change) => (
              <ChangeRow
                key={change.path}
                change={change}
                selected={selected.has(change.path)}
                onToggle={() => toggle(change.path)}
                revision={revision}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="shrink-0 space-y-2 border-t border-border p-3">
        {notice && <p className="text-footnote text-success">{notice}</p>}
        {error && (
          <p role="alert" className="text-footnote text-danger">
            {error}
          </p>
        )}
        {notice && report && (
          <p className={cn("text-footnote", report.errors ? "text-danger" : report.warnings ? "text-warning" : "text-text-muted")}>
            Vérification : {problemsSummary(report)}.
          </p>
        )}
        {changes.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={busy || building || chosen.length === 0}
              onClick={() => void apply()}
              icon={busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            >
              Appliquer au projet ({chosen.length})
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy || chosen.length === 0} onClick={() => void discard()} icon={<X size={13} />}>
              Rejeter ({chosen.length})
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" disabled={building} onClick={onBuild} icon={<Hammer size={13} />}>
            {building ? "Compilation…" : "Compiler le projet"}
          </Button>
          {confirmReset ? (
            <span className="flex items-center gap-1.5">
              <Button type="button" size="sm" variant="danger" disabled={busy} onClick={() => void reset()}>
                Tout rejeter et repartir du projet
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmReset(false)}>
                Annuler
              </Button>
            </span>
          ) : (
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmReset(true)} icon={<RotateCcw size={13} />}>
              Nouvelle copie
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
