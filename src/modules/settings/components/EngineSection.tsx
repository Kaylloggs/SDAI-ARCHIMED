import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { RefreshCw, FolderSearch, Loader2, Check, X } from "lucide-react";
import { engineApi } from "@/core/engine/engine.api";
import { useAdapters } from "@/core/engine/useAdapters";
import { Badge, Button, Card } from "@/design-system/primitives";

/**
 * Les CLI sont **détectées automatiquement** dans le PATH (et aux emplacements connus).
 * Ce panneau sert à voir l'état de la détection et à forcer un chemin si besoin.
 */
export function EngineSection() {
  const { adapters, loading, refresh } = useAdapters();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pickBinary = async (adapterId: string) => {
    const selected = await open({
      title: "Choisir l'exécutable de la CLI",
      filters: [{ name: "Exécutable", extensions: ["exe", "cmd", "bat", ""] }],
    });
    if (typeof selected !== "string") return;
    setBusy(adapterId);
    setError(null);
    try {
      await engineApi.setBinaryOverride(adapterId, selected);
      await refresh();
    } catch (e) {
      setError((e as { message?: string }).message ?? "Chemin invalide");
    } finally {
      setBusy(null);
    }
  };

  const clearBinary = async (adapterId: string) => {
    setBusy(adapterId);
    try {
      await engineApi.setBinaryOverride(adapterId, null);
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  if (loading && adapters.length === 0) {
    return (
      <div className="flex justify-center py-8 text-text-subtle">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 pb-1">
        <p className="text-footnote text-text-subtle">
          Les CLI présentes dans le PATH sont détectées automatiquement au démarrage.
        </p>
        <Button size="sm" variant="ghost" onClick={() => void refresh()}>
          <RefreshCw size={13} strokeWidth={1.75} />
          Rafraîchir
        </Button>
      </div>

      {error && <p className="text-footnote text-danger">{error}</p>}

      {adapters.map((adapter) => (
        <Card key={adapter.id} className="space-y-2 py-3">
          <div className="flex items-center gap-2">
            <p className="text-body font-medium">{adapter.name}</p>
            {adapter.installed ? (
              <Badge tone="success">
                <Check size={10} strokeWidth={2} />
                détectée
              </Badge>
            ) : (
              <Badge tone="neutral">
                <X size={10} strokeWidth={2} />
                absente
              </Badge>
            )}
            {adapter.version && <Badge tone="neutral">{adapter.version}</Badge>}
            <Badge tone="neutral">{adapter.models.length} modèle(s)</Badge>

            <div className="ml-auto flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={busy === adapter.id}
                onClick={() => void pickBinary(adapter.id)}
              >
                <FolderSearch size={13} strokeWidth={1.75} />
                Choisir l'exécutable
              </Button>
              {adapter.installed && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === adapter.id}
                  onClick={() => void clearBinary(adapter.id)}
                  title="Revenir à la détection automatique"
                >
                  Réinitialiser
                </Button>
              )}
            </div>
          </div>

          <p className="break-all font-mono text-caption text-text-subtle">
            {adapter.binaryPath ?? adapter.hint ?? "—"}
          </p>
        </Card>
      ))}
    </div>
  );
}
