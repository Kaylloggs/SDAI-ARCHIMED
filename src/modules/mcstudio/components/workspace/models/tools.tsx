import { useMemo } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/design-system/primitives";
import type { TextureInfo } from "@/core/ipc/bindings/TextureInfo";
import { MANY_CUBES, SHAPE_LABEL, shapeBoxes, shapeBounds, type Aabb, type ShapeKind, type ShapeParams } from "../../../lib/models/shapes";
import type { Vec3 } from "../../../lib/models/types";
import type { Rgba } from "../../../lib/pixels";
import { Segmented, Switch } from "../../ui";
import { NumberInput, PanelSection, Vec3Input } from "./controls";
import { TextureChoice, type TextureSource } from "./TextureChoice";

/** Forme en préparation : réglages, centre (déplaçable avec la poignée) et texture. */
export type ShapeDraft = { params: ShapeParams; center: Vec3; source: TextureSource };

export const SHAPE_KINDS: ShapeKind[] = ["cube", "cylinder", "sphere", "cone"];

export function defaultParams(kind: ShapeKind): ShapeParams {
  return {
    kind,
    size: kind === "cube" ? [8, 8, 8] : kind === "sphere" ? [10, 10, 10] : [8, 12, 0],
    axis: "y",
    step: 1,
    wall: 0,
  };
}

/** Cubes de la forme, placés à son centre. */
export function placedBoxes(draft: ShapeDraft): Aabb[] {
  return shapeBoxes(draft.params).map((box) => ({
    from: box.from.map((v, i) => Math.round((v + draft.center[i]!) * 1000) / 1000) as Vec3,
    to: box.to.map((v, i) => Math.round((v + draft.center[i]!) * 1000) / 1000) as Vec3,
  }));
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-caption text-text-subtle">{label}</span>
      {children}
    </label>
  );
}

/**
 * Panneau « Nouvelle forme » : cube, cylindre, sphère ou cône faits de cubes, pleins ou creux,
 * avec l'aperçu dans la vue 3D (la poignée déplace la forme) et le choix de sa texture.
 */
export function ShapePanel({
  value,
  onChange,
  onCreate,
  onCancel,
  busy,
  same,
  textures,
  modId,
  color,
  entity = false,
  centerLabel,
}: {
  value: ShapeDraft;
  onChange: (next: ShapeDraft) => void;
  onCreate: () => void;
  onCancel: () => void;
  busy: boolean;
  same: string | null;
  textures: TextureInfo[];
  modId: string;
  color: Rgba;
  entity?: boolean;
  centerLabel: string;
}) {
  const { params } = value;
  const count = useMemo(() => shapeBoxes(params).length, [params]);
  const bounds = shapeBounds(params);
  const set = (patch: Partial<ShapeParams>) => onChange({ ...value, params: { ...params, ...patch } });
  const round = params.kind !== "cube";
  const maxWall = Math.max(0.5, Math.min(...bounds) / 2 - 0.5);

  return (
    <PanelSection title={`Nouvelle forme · ${SHAPE_LABEL[params.kind]}`}>
      <Segmented
        label="Forme"
        value={params.kind}
        options={SHAPE_KINDS.map((kind) => ({ value: kind, label: SHAPE_LABEL[kind] }))}
        onChange={(kind) => onChange({ ...value, params: { ...defaultParams(kind), wall: params.wall, step: params.step } })}
      />
      {params.kind === "cube" ? (
        <Vec3Input label="Taille" value={params.size} step={0.5} min={0.5} onChange={(size) => set({ size })} />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Diamètre">
            <NumberInput label="Diamètre" value={params.size[0]} step={1} min={1} max={64} onChange={(d) => set({ size: [d, params.size[1], params.size[2]] })} />
          </Field>
          {params.kind !== "sphere" && (
            <Field label={params.kind === "cone" ? "Hauteur" : "Longueur"}>
              <NumberInput label="Longueur" value={params.size[1]} step={1} min={1} max={64} onChange={(l) => set({ size: [params.size[0], l, params.size[2]] })} />
            </Field>
          )}
        </div>
      )}
      {(params.kind === "cylinder" || params.kind === "cone") && (
        <div className="flex items-center gap-2">
          <span className="text-caption text-text-subtle">{params.kind === "cone" ? "Pointe vers" : "Axe"}</span>
          <Segmented
            label="Axe"
            value={params.axis}
            options={(["x", "y", "z"] as const).map((axis) => ({ value: axis, label: params.kind === "cone" ? `+${axis.toUpperCase()}` : axis.toUpperCase() }))}
            onChange={(axis) => set({ axis })}
          />
        </div>
      )}
      <Vec3Input label={centerLabel} value={value.center} step={0.5} onChange={(center) => onChange({ ...value, center })} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="-ml-2">
          <Switch checked={params.wall > 0} onChange={(on) => set({ wall: on ? Math.min(1, maxWall) : 0 })}>
            Creuse
          </Switch>
        </div>
        {params.wall > 0 && (
          <label className="flex items-center gap-1.5">
            <span className="text-caption text-text-subtle">Paroi</span>
            <NumberInput label="Épaisseur de la paroi" value={params.wall} step={0.5} min={0.5} max={maxWall} onChange={(wall) => set({ wall })} className="w-14" />
          </label>
        )}
      </div>
      {round && (
        <div className="flex items-center gap-2">
          <span className="text-caption text-text-subtle">Précision</span>
          <Segmented
            label="Précision des courbes"
            value={params.step}
            options={[
              { value: 2, label: "2 px" },
              { value: 1, label: "1 px" },
              { value: 0.5, label: "0,5 px" },
            ]}
            onChange={(step) => set({ step })}
          />
        </div>
      )}
      <p className={count > MANY_CUBES ? "flex gap-1.5 text-caption text-warning" : "text-caption text-text-subtle"}>
        {count > MANY_CUBES && <AlertTriangle size={12} className="mt-0.5 shrink-0" />}
        {count} cube{count > 1 ? "s" : ""} · {bounds.map((v) => Math.round(v * 100) / 100).join(" × ")} px
        {count > MANY_CUBES && " : lourd pour le jeu, baissez la précision."}
      </p>
      <p className="text-caption font-medium text-text-muted">Texture</p>
      <TextureChoice
        value={value.source}
        onChange={(source) => onChange({ ...value, source })}
        same={same}
        textures={textures}
        modId={modId}
        color={color}
        entity={entity}
      />
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
        <Button type="button" size="sm" variant="primary" disabled={busy} onClick={onCreate} icon={busy ? <Loader2 size={14} className="animate-spin" /> : undefined}>
          Créer
        </Button>
      </div>
    </PanelSection>
  );
}

/** Panneau « Creuser » : la boîte à retirer (déplaçable avec la poignée) et ce qu'elle touche. */
export function CarvePanel({
  hole,
  onChange,
  onApply,
  onCancel,
  touched,
  scope,
}: {
  hole: Aabb;
  onChange: (hole: Aabb) => void;
  onApply: () => void;
  onCancel: () => void;
  /** Cubes traversés par la boîte. */
  touched: number;
  scope: string;
}) {
  const size = hole.to.map((v, i) => Math.round((v - hole.from[i]!) * 1000) / 1000) as Vec3;
  return (
    <PanelSection title="Creuser">
      <p className="text-caption text-text-subtle">
        La boîte rouge est retirée de {scope}. Les cubes traversés sont recoupés, leur texture reste en place.
      </p>
      <Vec3Input
        label="Coin"
        value={hole.from}
        step={0.5}
        onChange={(from) => onChange({ from, to: from.map((v, i) => v + size[i]!) as Vec3 })}
      />
      <Vec3Input label="Taille" value={size} step={0.5} min={0.5} onChange={(next) => onChange({ from: hole.from, to: hole.from.map((v, i) => v + next[i]!) as Vec3 })} />
      <p className="text-caption text-text-subtle">
        {touched === 0 ? "La boîte ne touche aucun cube." : `${touched} cube${touched > 1 ? "s" : ""} traversé${touched > 1 ? "s" : ""}.`}
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
        <Button type="button" size="sm" variant="danger" disabled={touched === 0} onClick={onApply}>
          Creuser
        </Button>
      </div>
    </PanelSection>
  );
}
