import { useEffect, useState } from "react";
import { BookmarkCheck, Loader2 } from "lucide-react";
import { Button } from "@/design-system/primitives";
import { errorText, skillsApi, type DraftInfo, type DraftReport } from "../../api";

type Props = {
  draft: DraftInfo;
  report: DraftReport | null;
  onSaved: (info: DraftInfo) => void;
};

const time = (ms: number) => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

/**
 * Seul point d'entrée dans la bibliothèque. Un skill du même nom est remplacé après une
 * seconde confirmation (sauf mise à jour du skill amélioré ou déjà enregistré), avec sauvegarde.
 */
export function SaveBar({ draft, report, onSaved }: Props) {
  const [enable, setEnable] = useState(true);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setArmed(false);
    setError(null);
  }, [draft.id, report?.name]);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  const name = report?.name ?? null;
  // Remplacer le skill d'origine, ou celui que ce brouillon a déjà enregistré : c'est attendu.
  const ownTarget = name !== null && (name === draft.sourceId || name === draft.savedAs);
  const needsConfirm = Boolean(report?.targetExists) && !ownTarget;
  const upToDate = draft.savedAs !== null && draft.savedAs === name && draft.savedAt !== null && draft.savedAt >= draft.updatedAt;

  const save = async () => {
    if (!report?.ready || !name) return;
    if (needsConfirm && !armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    setBusy(true);
    setError(null);
    try {
      await skillsApi.draftSave(draft.id, Boolean(report.targetExists), enable);
      onSaved(await skillsApi.draftInfo(draft.id));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const label = armed
    ? `Remplacer « ${name} » ?`
    : report?.targetExists && ownTarget
      ? "Mettre à jour la bibliothèque"
      : "Enregistrer dans la bibliothèque";

  const status = !report
    ? "Vérification…"
    : !name
      ? "Le skill n'a pas encore de nom."
      : !report.ready
        ? "Corrigez les erreurs (onglet Vérification) pour enregistrer."
        : upToDate
          ? `« ${name} » est à jour dans la bibliothèque (${time(draft.savedAt!)}).`
          : draft.savedAs === name
            ? `Modifié depuis l'enregistrement de ${time(draft.savedAt!)}.`
            : needsConfirm
              ? `Un skill « ${name} » existe déjà : il sera remplacé (une copie est gardée).`
              : `Sera enregistré sous « ${name} ».`;

  return (
    <footer className="shrink-0 space-y-2 border-t border-border px-4 py-3">
      {error && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-footnote">
          {error}
        </p>
      )}
      <p className="text-footnote text-text-muted [overflow-wrap:anywhere]">{status}</p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-footnote text-text-muted">
          <input type="checkbox" checked={enable} onChange={(event) => setEnable(event.target.checked)} className="accent-[var(--color-accent)]" />
          Activer pour les IA
        </label>
        <span className="ml-auto" />
        <Button
          variant={armed ? "danger" : "primary"}
          disabled={!report?.ready || !name || busy || upToDate}
          onClick={() => void save()}
          icon={busy ? <Loader2 size={14} className="animate-spin" /> : <BookmarkCheck size={14} strokeWidth={1.75} />}
        >
          {label}
        </Button>
      </div>
    </footer>
  );
}
