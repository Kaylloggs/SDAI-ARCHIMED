import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Info, RefreshCw, XCircle } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Badge, Button, Select } from "@/design-system/primitives";
import type { GameLogCategory } from "@/core/ipc/bindings/GameLogCategory";
import type { GameLogEntry } from "@/core/ipc/bindings/GameLogEntry";
import { errorText, gameStudioApi } from "../../api";
import { LOG_CATEGORY } from "../../lib/labels";
import { useGameStudioStore } from "../../store";
import { ErrorLine } from "../ui";

const LEVEL = {
  info: { icon: Info, tone: "text-text-subtle", label: "Information" },
  warning: { icon: AlertTriangle, tone: "text-warning", label: "Attention" },
  error: { icon: XCircle, tone: "text-danger", label: "Erreur" },
} as const;

/** Journal structuré du projet (§78), le plus récent en haut. */
export function JournalSection() {
  const id = useGameStudioStore((s) => s.current?.project.id);
  const [category, setCategory] = useState<GameLogCategory | "">("");
  const [entries, setEntries] = useState<GameLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setEntries(await gameStudioApi.journal(id, category || null, 400));
    } catch (e) {
      setError(errorText(e));
    }
  }, [id, category]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          label="Catégorie"
          value={category}
          onChange={(v) => setCategory(v as GameLogCategory | "")}
          options={[{ value: "", label: "Toutes les catégories" }, ...(Object.keys(LOG_CATEGORY) as GameLogCategory[]).map((c) => ({ value: c, label: LOG_CATEGORY[c] }))]}
          className="w-56"
        />
        <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} onClick={() => void load()}>
          Actualiser
        </Button>
      </div>
      <ErrorLine message={error} onClose={() => setError(null)} />
      {!entries ? (
        <p className="text-footnote text-text-subtle">Lecture du journal…</p>
      ) : entries.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface-1 px-4 py-6 text-center text-body-sm text-text-muted">Rien dans cette catégorie.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface-1">
          {entries.map((entry, index) => {
            const level = LEVEL[entry.level];
            return (
              <li key={`${entry.at}-${index}`} className="flex gap-3 px-4 py-2">
                <level.icon size={14} className={cn("mt-0.5 shrink-0", level.tone)} aria-label={level.label} />
                <div className="min-w-0 flex-1">
                  <p className="break-words text-body-sm">{entry.message}</p>
                  {entry.detail && (
                    <details>
                      <summary className="cursor-pointer text-footnote text-text-subtle">Détails</summary>
                      <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-md bg-bg p-2 font-mono text-caption text-text-muted">{entry.detail}</pre>
                    </details>
                  )}
                </div>
                <Badge tone="neutral">{LOG_CATEGORY[entry.category]}</Badge>
                <time dateTime={entry.at} className="shrink-0 text-caption tabular-nums text-text-subtle">
                  {new Date(entry.at).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
