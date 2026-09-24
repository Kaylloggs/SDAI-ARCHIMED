import { useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Button, Select } from "@/design-system/primitives";
import type { BlockLayout } from "@/core/ipc/bindings/BlockLayout";
import type { TextureInfo } from "@/core/ipc/bindings/TextureInfo";
import type { TextureTarget } from "@/core/ipc/bindings/TextureTarget";
import { errorText, mcstudioApi } from "../../../api";
import { FACE_LABEL, LAYOUTS, targetKey } from "../../../lib/textures";
import { Checker, focusRing, PixelImage } from "../../ui";

/**
 * Barre des faces d'un bloc : onglets des faces et répartition des textures (une pour tout le
 * bloc, colonne, dessus-dessous-côtés, six faces). Changer de répartition réécrit le modèle du
 * bloc après un point de restauration ; les nouvelles faces partent de la texture actuelle.
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
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async (next: BlockLayout, replaceCustom: boolean) => {
    setBusy(true);
    setError(null);
    try {
      onLayoutChanged(await mcstudioApi.setBlockLayout(projectId, block, next, replaceCustom));
      setAsking(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5 border-b border-border px-4 py-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {faces.length > 1 ? (
          <div role="tablist" aria-label="Faces du bloc" className="flex flex-wrap gap-1">
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
                    "flex h-7 items-center gap-1.5 rounded-md pl-1 pr-2 text-footnote transition-colors disabled:opacity-40",
                    selected ? "bg-surface-3 text-text" : "text-text-muted hover:bg-surface-2 hover:text-text",
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
        ) : (
          <p className="text-footnote text-text-subtle">
            {layout === "custom" ? "Bloc à forme particulière (modèle fait main)" : "Une texture pour les six faces"}
          </p>
        )}

        <div className="ml-auto flex items-center gap-2">
          {busy && <Loader2 size={14} className="animate-spin text-text-subtle" aria-label="Réécriture du modèle" />}
          {layout === "custom" ? (
            asking ? (
              <>
                <Button type="button" size="sm" variant="ghost" onClick={() => setAsking(false)}>
                  Garder la forme
                </Button>
                <Button type="button" size="sm" variant="danger" disabled={busy} onClick={() => void apply("all", true)}>
                  Remplacer par un cube
                </Button>
              </>
            ) : (
              <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => setAsking(true)}>
                En faire un cube…
              </Button>
            )
          ) : (
            <div
              className="w-[200px]"
              title={`${LAYOUTS.find((l) => l.value === layout)?.hint ?? ""}. Changer de répartition crée un point de restauration.`}
            >
              <Select
                label="Répartition des textures du bloc"
                value={layout}
                disabled={disabled || busy}
                onChange={(next) => {
                  if (next !== layout) void apply(next as BlockLayout, false);
                }}
                options={LAYOUTS.map(({ value, label }) => ({ value, label }))}
              />
            </div>
          )}
        </div>
      </div>
      {asking && (
        <p className="text-caption text-text-subtle">
          Le modèle actuel (dalle, escalier…) sera remplacé par un cube. Un point de restauration est créé avant.
        </p>
      )}

      {error && (
        <p role="alert" className="text-footnote text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
