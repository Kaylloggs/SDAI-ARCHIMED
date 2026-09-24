import { useCallback, useEffect, useState } from "react";
import { History, Loader2, Palette, RotateCcw, Sparkles, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/design-system/primitives";
import type { Snapshot } from "@/core/ipc/bindings/Snapshot";
import type { SnapshotKind } from "@/core/ipc/bindings/SnapshotKind";
import { errorText, mcstudioApi } from "../../api";
import { useEditorStore } from "../../editor";
import { ago, megabytes } from "../../lib/format";
import { inputClass } from "../ui";

const KIND: Record<SnapshotKind, { label: string; Icon: typeof History }> = {
  manual: { label: "Manuel", Icon: History },
  ai: { label: "Avant l'IA", Icon: Sparkles },
  restore: { label: "Avant restauration", Icon: Undo2 },
  texture: { label: "Atelier des textures", Icon: Palette },
};

function size(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} Ko` : megabytes(bytes);
}

/**
 * Points de restauration du projet : pris à la main, avant chaque application de
 * modifications d'une IA et avant chaque restauration (qui s'annule donc aussi).
 */
export function HistorySection({ projectId, busy }: { projectId: string; busy: boolean }) {
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);
  const [label, setLabel] = useState("");
  const [working, setWorking] = useState(false);
  const [confirm, setConfirm] = useState<{ action: "restore" | "delete"; snapshot: Snapshot } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      mcstudioApi
        .listSnapshots(projectId)
        .then(setSnapshots)
        .catch((e) => setError(errorText(e))),
    [projectId],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (work: () => Promise<void>) => {
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      await work();
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setWorking(false);
      setConfirm(null);
    }
  };

  const create = () =>
    run(async () => {
      const snapshot = await mcstudioApi.createSnapshot(projectId, label);
      setLabel("");
      setNotice(`Point de restauration créé : ${snapshot.files.length} fichiers copiés.`);
    });

  const restore = (snapshot: Snapshot) =>
    run(async () => {
      await mcstudioApi.restoreSnapshot(projectId, snapshot.id);
      setNotice(`« ${snapshot.label} » restauré. L'état d'avant est gardé en tête de liste : restaurez-le pour annuler.`);
      await useEditorStore.getState().refreshClean(projectId);
      void useEditorStore.getState().validate(projectId).catch(() => undefined);
    });

  const remove = (snapshot: Snapshot) => run(() => mcstudioApi.deleteSnapshot(projectId, snapshot.id));

  return (
    <section aria-labelledby="mc-history" className="space-y-3">
      <h2 id="mc-history" className="text-title-3 font-semibold">
        Points de restauration
      </h2>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <input
          aria-label="Nom du point de restauration"
          placeholder="Ex. : avant d'ajouter les armures"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          className={`${inputClass} min-w-0 flex-1`}
        />
        <Button type="submit" size="sm" disabled={working || busy} icon={working ? <Loader2 size={14} className="animate-spin" /> : <History size={14} />}>
          Créer un point de restauration
        </Button>
      </form>

      {notice && <p className="text-footnote text-success">{notice}</p>}
      {error && (
        <p role="alert" className="text-footnote text-danger">
          {error}
        </p>
      )}

      {snapshots && snapshots.length === 0 && (
        <p className="text-footnote text-text-subtle">
          Aucun pour l'instant. Mod Studio en crée un automatiquement avant d'appliquer des modifications proposées par une IA.
        </p>
      )}
      {snapshots && snapshots.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border bg-surface-1">
          {snapshots.slice(0, 20).map((snapshot) => {
            const { label: kind, Icon } = KIND[snapshot.kind];
            const asking = confirm?.snapshot.id === snapshot.id ? confirm.action : null;
            return (
              <li key={snapshot.id} className="space-y-2 px-3 py-2">
                <div className="flex items-center gap-3">
                  <Icon size={14} className="shrink-0 text-text-subtle" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body-sm">{snapshot.label}</p>
                    <p className="text-caption text-text-subtle">
                      {kind} · {ago(snapshot.createdAt)} · {snapshot.files.length} fichier{snapshot.files.length > 1 ? "s" : ""} ·{" "}
                      {size(snapshot.size)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={working || busy}
                    onClick={() => setConfirm({ action: "restore", snapshot })}
                    icon={<RotateCcw size={12} />}
                  >
                    Restaurer
                  </Button>
                  <button
                    type="button"
                    aria-label={`Mettre « ${snapshot.label} » à la Corbeille`}
                    disabled={working}
                    onClick={() => setConfirm({ action: "delete", snapshot })}
                    className="flex size-7 items-center justify-center rounded-sm text-text-subtle hover:bg-surface-2 hover:text-danger disabled:opacity-40"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                {asking && (
                  <div role="alert" className="flex flex-wrap items-center gap-2 rounded-sm bg-warning-soft px-2 py-1.5">
                    <p className="flex-1 text-footnote">
                      {asking === "restore"
                        ? `Remettre ${snapshot.files.length} fichier(s) dans leur état de ce moment ? L'état actuel est sauvegardé d'abord.`
                        : "Mettre ce point de restauration à la Corbeille ?"}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant={asking === "restore" ? "primary" : "danger"}
                      disabled={working}
                      onClick={() => void (asking === "restore" ? restore(snapshot) : remove(snapshot))}
                    >
                      Confirmer
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                      Annuler
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
