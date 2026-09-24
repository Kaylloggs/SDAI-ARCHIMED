import { useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Button } from "@/design-system/primitives";
import type { BlockLayout } from "@/core/ipc/bindings/BlockLayout";
import type { TextureInfo } from "@/core/ipc/bindings/TextureInfo";
import type { TextureTarget } from "@/core/ipc/bindings/TextureTarget";
import { errorText, mcstudioApi } from "../../../api";
import { FACE_LABEL, LAYOUTS, targetKey } from "../../../lib/textures";
import { Checker, focusRing, PixelImage, Segmented } from "../../ui";

/**
 * Répartition des textures d'un bloc (une pour tout le bloc, colonne, dessus-dessous-côtés,
 * six faces) et onglets de ses faces. Changer de répartition réécrit le modèle du bloc après
 * un point de restauration ; les nouvelles faces partent de la texture actuelle.
 */
export function BlockFaces({
  projectId,
  block,
  texture,
  faces,
  disabled,
  onSelect,
  onLayoutChanged,
}: {
  projectId: string;
  block: string;
  texture: TextureInfo;
  /** Textures de ce bloc (une par face). */
  faces: TextureInfo[];
  disabled: boolean;
  onSelect: (target: TextureTarget) => void;
  onLayoutChanged: (faces: TextureInfo[]) => void;
}) {
  const layout = texture.layout ?? "all";
  const [asking, setAsking] = useState<BlockLayout | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async (next: BlockLayout, replaceCustom: boolean) => {
    setBusy(true);
    setError(null);
    try {
      onLayoutChanged(await mcstudioApi.setBlockLayout(projectId, block, next, replaceCustom));
      setAsking(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const hint = LAYOUTS.find((l) => l.value === layout)?.hint;

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-footnote font-medium text-text-muted">Faces du bloc</p>
        {layout === "custom" ? (
          <p className="text-footnote text-text-subtle">Modèle écrit à la main</p>
        ) : (
          <Segmented
            label="Répartition des textures du bloc"
            value={layout}
            disabled={disabled || busy}
            options={LAYOUTS.map(({ value, label }) => ({ value, label }))}
            onChange={(next) => {
              if (next !== layout) void apply(next, false);
            }}
          />
        )}
      </div>

      {layout === "custom" ? (
        asking ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-footnote text-text-muted">
              Le modèle actuel (forme particulière, dalle, escalier…) sera remplacé par un cube. Un point de restauration
              est créé avant.
            </p>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAsking(null)}>
              Annuler
            </Button>
            <Button type="button" size="sm" variant="danger" disabled={busy} onClick={() => void apply(asking, true)}>
              Remplacer par un cube
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-footnote text-text-subtle">
              Ce bloc a sa propre forme : l'atelier modifie sa texture principale sans toucher au modèle.
            </p>
            <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => setAsking("all")}>
              En faire un cube…
            </Button>
          </div>
        )
      ) : (
        hint && (
          <p className="text-caption text-text-subtle">
            {LAYOUTS.find((l) => l.value === layout)?.label} : {hint}. Changer crée un point de restauration.
          </p>
        )
      )}

      {faces.length > 1 && (
        <div role="tablist" aria-label="Faces" className="flex flex-wrap gap-1.5">
          {faces.map((face) => {
            const selected = targetKey(face.target) === targetKey(texture.target);
            const label = face.target.kind === "block" && face.target.face ? FACE_LABEL[face.target.face] : "Toutes";
            return (
              <button
                key={targetKey(face.target)}
                type="button"
                role="tab"
                aria-selected={selected}
                disabled={disabled}
                onClick={() => onSelect(face.target)}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-2 py-1 text-footnote transition-colors disabled:opacity-40",
                  selected ? "border-accent bg-accent-soft text-text" : "border-border text-text-muted hover:border-border-strong hover:text-text",
                  focusRing,
                )}
              >
                <Checker size={20} className="rounded-xs">
                  {face.exists && <PixelImage path={face.path} version={face.modified ?? 0} size={16} />}
                </Checker>
                {label}
              </button>
            );
          })}
        </div>
      )}

      {busy && <Loader2 size={14} className="animate-spin text-text-subtle" aria-label="Réécriture du modèle" />}
      {error && (
        <p role="alert" className="text-footnote text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
