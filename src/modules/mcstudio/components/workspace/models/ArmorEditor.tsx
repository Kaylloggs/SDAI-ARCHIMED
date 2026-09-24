import { useEffect, useMemo, useState } from "react";
import { Button, Select } from "@/design-system/primitives";
import type { ModelInfo } from "@/core/ipc/bindings/ModelInfo";
import type { ProjectSummary } from "@/core/ipc/bindings/ProjectSummary";
import { errorText } from "../../../api";
import { ARMOR_PIECES, armorModel, MANNEQUIN, type ArmorPiece } from "../../../lib/models/entity";
import { boxUvRects, entityParts, type Part } from "../../../lib/models/geometry";
import type { FaceName } from "../../../lib/models/types";
import { blankPixels } from "../../../lib/pixels";
import { Segmented } from "../../ui";
import { PanelSection, StudioHeader, StudioToolbar } from "./controls";
import { useStudio } from "./useStudio";
import { UvView, type UvRect } from "./UvView";
import { Viewport } from "./Viewport";

type Shown = ArmorPiece | "all";

/**
 * Armure portée : les couches de texture (1 : casque, plastron, bottes ; 2 : jambières) sur
 * le modèle d'armure du jeu, autour d'un mannequin. On peint directement sur l'armure.
 */
export function ArmorEditor({
  project,
  info,
  onDirty,
}: {
  project: ProjectSummary;
  info: ModelInfo;
  onDirty: (dirty: boolean) => void;
}) {
  const studio = useStudio<null>(project.id);
  const { textures } = studio;
  const [shown, setShown] = useState<Shown>("all");
  const [layer, setLayer] = useState<0 | 1>(0);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Couche absente : son chemin se déduit de l'autre (`_layer_1` ↔ `_layer_2`, `humanoid` ↔
  // `humanoid_leggings`).
  const layers = useMemo(() => {
    const [first = "", second = ""] = info.textures;
    const other = (path: string, from: 0 | 1) =>
      from === 0
        ? path.replace(/_layer_1\.png$/, "_layer_2.png").replace("/equipment/humanoid/", "/equipment/humanoid_leggings/")
        : path.replace(/_layer_2\.png$/, "_layer_1.png").replace("/equipment/humanoid_leggings/", "/equipment/humanoid/");
    return [first || other(second, 1), second || other(first, 0)];
  }, [info.textures]);

  useEffect(() => {
    studio.open(null);
    void studio.loadTextures(layers.filter(Boolean));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, info.id, layers]);

  const pieces = useMemo(() => ARMOR_PIECES.filter((p) => shown === "all" || p.value === shown), [shown]);
  const parts: Part[] = useMemo(
    () =>
      pieces.flatMap(({ value, layer: index }) => {
        const file = layers[index];
        const texture = file && textures.has(file) ? file : null;
        return entityParts(armorModel(value), texture).map((part) => ({ ...part, id: `${value}:${part.id}`, owner: `${value}:${part.owner}` }));
      }),
    [pieces, layers, textures],
  );
  const ghosts = useMemo(() => entityParts(MANNEQUIN, null), []);

  const layerFile = layers[layer] ?? "";
  const layerPixels = textures.get(layerFile);
  const rects: UvRect[] = useMemo(
    () =>
      pieces
        .filter((p) => p.layer === layer)
        .flatMap(({ value }) =>
          armorModel(value).bones.flatMap((bone) =>
            bone.cubes.flatMap((cube) =>
              (Object.entries(boxUvRects(cube)) as [FaceName, [number, number, number, number]][]).map(([face, rect]) => ({
                owner: `${value}:${bone.name}`,
                face,
                rect,
              })),
            ),
          ),
        ),
    [pieces, layer],
  );

  const save = async () => {
    setSaving(true);
    studio.setError(null);
    try {
      await studio.saveTextures();
      setNotice("Enregistré");
    } catch (e) {
      studio.setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const dirty = studio.dirtyTextures.size > 0;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  const canPaint = layers.some((file) => file && textures.has(file));

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-studio tabIndex={-1}>
      <StudioHeader
        title={`Armure ${info.label}`}
        subtitle={<span className="font-mono">{layers.filter(Boolean).map((f) => f.split("/textures/").at(-1)).join(" · ")}</span>}
        dirty={studio.dirtyTextures.size > 0}
        saving={saving}
        notice={notice}
        onSave={() => void save()}
      />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <StudioToolbar
            mode={studio.mode}
            onMode={studio.setMode}
            tool={studio.tool}
            onTool={studio.setTool}
            color={studio.color}
            onColor={studio.setColor}
            brush={studio.brush}
            onBrush={studio.setBrush}
            canPaint={canPaint}
            history={studio.history}
            onUndo={studio.undo}
            onRedo={studio.redo}
          />
          <div className="relative min-h-0 flex-1 bg-bg-subtle">
            <Viewport
              parts={parts}
              ghosts={ghosts}
              textures={textures}
              textureVersion={studio.textureVersion}
              selected={[]}
              mode={studio.mode}
              frameKey={info.id}
              floor="entity"
              onPaint={studio.paint}
            />
            <p className="pointer-events-none absolute bottom-2 left-3 text-caption text-text-subtle">
              Modèle d'armure du jeu sur un mannequin · {studio.mode === "paint" ? "glisser : peindre · clic droit : tourner" : "glisser : tourner · molette : zoom"}
            </p>
            {studio.error && (
              <p role="alert" className="absolute left-3 right-3 top-3 rounded-md bg-danger-soft px-3 py-2 text-footnote">
                {studio.error}
              </p>
            )}
          </div>
        </div>
        <aside aria-label="Pièces et couches de l'armure" className="w-[300px] shrink-0 overflow-y-auto border-l border-border">
          <PanelSection title="Pièces">
            <Select
              label="Pièces montrées"
              value={shown}
              options={[{ value: "all", label: "Armure complète" }, ...ARMOR_PIECES.map((p) => ({ value: p.value, label: p.label }))]}
              onChange={(value) => setShown(value as Shown)}
            />
          </PanelSection>
          <PanelSection title="Couche">
            <Segmented
              label="Couche de texture"
              value={layer}
              options={[
                { value: 0 as const, label: "Couche 1" },
                { value: 1 as const, label: "Couche 2" },
              ]}
              onChange={setLayer}
            />
            <p className="text-caption text-text-subtle">
              {layer === 0 ? "Casque, plastron et bottes." : "Jambières."}
            </p>
            {layerPixels ? (
              <UvView
                pixels={layerPixels}
                texture={layerFile}
                version={studio.textureVersion}
                rects={rects}
                selected={null}
                mode={studio.mode}
                onPaint={studio.paint}
                onPick={() => undefined}
                size={272}
              />
            ) : layerFile && studio.missing.has(layerFile) ? (
              <Button type="button" size="sm" onClick={() => studio.putTexture(layerFile, blankPixels(64, 32))}>
                Créer la couche {layer + 1} (64 × 32)
              </Button>
            ) : !layerFile ? (
              <p className="text-caption text-text-subtle">Pas de couche {layer + 1} pour cette armure.</p>
            ) : (
              <p className="text-caption text-text-subtle">Lecture…</p>
            )}
          </PanelSection>
        </aside>
      </div>
    </div>
  );
}
