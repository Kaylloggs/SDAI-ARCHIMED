import { useEffect, useState } from "react";
import { GitCompareArrows } from "lucide-react";
import { DiffView } from "@/core/cards/DiffView";
import { Badge, EmptyState } from "@/design-system/primitives";
import { errorText, skillsApi, type DraftChange, type DraftInfo } from "../../api";

const KIND: Record<DraftChange["kind"], { label: string; tone: "success" | "warning" | "danger" }> = {
  created: { label: "ajouté", tone: "success" },
  modified: { label: "modifié", tone: "warning" },
  deleted: { label: "supprimé", tone: "danger" },
};

/** Amélioration d'un skill : ce qui change par rapport à la version de la bibliothèque. */
export function ChangesTab({ draft, revision }: { draft: DraftInfo; revision: number }) {
  const [changes, setChanges] = useState<DraftChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    skillsApi
      .draftChanges(draft.id)
      .then((list) => {
        if (cancelled) return;
        setChanges(list);
        setError(null);
      })
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [draft.id, revision]);

  if (error) return <p className="px-4 py-4 text-footnote text-text-muted">{error}</p>;
  if (!changes) return null;
  if (changes.length === 0) {
    return (
      <EmptyState
        icon={<GitCompareArrows size={24} strokeWidth={1.5} />}
        title="Aucune modification"
        description={`Le brouillon est identique à « ${draft.sourceId ?? ""} » dans la bibliothèque.`}
      />
    );
  }

  return (
    <ul className="flex flex-col gap-4 px-4 py-3">
      {changes.map((change) => (
        <li key={change.path} className="min-w-0 space-y-1.5">
          <p className="flex items-center gap-2">
            <span className="min-w-0 truncate font-mono text-footnote">{change.path}</span>
            <Badge tone={KIND[change.kind].tone}>{KIND[change.kind].label}</Badge>
          </p>
          {change.binary ? (
            <p className="text-footnote text-text-subtle">Fichier binaire : pas d'aperçu des différences.</p>
          ) : (
            <DiffView path={change.path} before={change.before} after={change.after} collapseAfter={60} bare />
          )}
        </li>
      ))}
    </ul>
  );
}
