import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bone, Box, Code2, Copy, Grid2x2, LayoutGrid, Plus, Trash2 } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Button, Select } from "@/design-system/primitives";
import type { EntityCube } from "@/core/ipc/bindings/EntityCube";
import type { EntityModel } from "@/core/ipc/bindings/EntityModel";
import type { EntitySaved } from "@/core/ipc/bindings/EntitySaved";
import type { ModelInfo } from "@/core/ipc/bindings/ModelInfo";
import type { ProjectSummary } from "@/core/ipc/bindings/ProjectSummary";
import { errorText, mcstudioApi } from "../../../api";
import { boneNameProblem, cube as makeCube, freeBoneName, subtree } from "../../../lib/models/entity";
import {
  boneMatrices,
  boxUvBounds,
  boxUvRects,
  boxUvSize,
  cubeOwner,
  ENTITY_ROOT,
  entityParts,
  freeUvSpot,
  packBoxUv,
} from "../../../lib/models/geometry";
import { cloneModel, type FaceName } from "../../../lib/models/types";
import { blankPixels, fillRect, resizePixels, shade, type Pixels } from "../../../lib/pixels";
import { focusRing, inputClass, Switch } from "../../ui";
import { IconButton, NumberInput, PanelSection, StudioHeader, StudioToolbar, Vec3Input } from "./controls";
import { useStudio } from "./useStudio";
import { UvView, type UvRect } from "./UvView";
import { Viewport } from "./Viewport";

type Selection = { kind: "bone"; bone: string } | { kind: "cube"; bone: string; index: number } | null;

/** Os dans l'ordre de l'arbre (parent puis enfants), avec leur profondeur. */
function tree(model: EntityModel): { name: string; depth: number }[] {
  const out: { name: string; depth: number }[] = [];
  const visit = (parent: string | null, depth: number) => {
    for (const bone of model.bones.filter((b) => (b.parent ?? null) === parent)) {
      out.push({ name: bone.name, depth });
      if (depth < 32) visit(bone.name, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}

/** Couleur de départ des faces d'un cube dans le patron (dessus clair, dessous sombre). */
const TEMPLATE_SHADE: Record<FaceName, number> = { down: 0.25, up: -0.35, north: 0.05, south: -0.1, west: -0.2, east: -0.2 };
const TEMPLATE_COLORS: [number, number, number, number][] = [
  [196, 120, 92, 255],
  [110, 150, 190, 255],
  [128, 176, 110, 255],
  [200, 176, 96, 255],
  [170, 120, 190, 255],
];

/**
 * Éditeur de modèle d'entité, à la manière de Blockbench : os (pivot, rotation) et cubes
 * (position, taille, UV en boîte, gonflement, miroir), texture peinte sur le modèle ou à plat,
 * et code Java de la géométrie généré à l'enregistrement.
 */
export function EntityEditor({
  project,
  info,
  onSaved,
  onDirty,
}: {
  project: ProjectSummary;
  info: ModelInfo;
  onSaved: (saved: EntitySaved) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const studio = useStudio<EntityModel>(project.id);
  const { model, textures } = studio;
  const texturePath = info.textures[0] ?? "";
  const [selection, setSelection] = useState<Selection>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSelection(null);
    setCode(null);
    mcstudioApi
      .readEntityModel(project.id, info.id)
      .then((loaded) => {
        if (cancelled) return;
        studio.open(loaded);
        void studio.loadTextures([texturePath]);
      })
      .catch((e) => !cancelled && studio.setError(errorText(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, info.id]);

  const pixels = textures.get(texturePath);
  const parts = useMemo(() => (model ? entityParts(model, pixels ? texturePath : null) : []), [model, pixels, texturePath]);
  const selectedOwners = useMemo(() => {
    if (!model || !selection) return [];
    if (selection.kind === "cube") return [cubeOwner(selection.bone, selection.index)];
    const names = subtree(model, selection.bone);
    return model.bones.filter((b) => names.has(b.name)).flatMap((b) => b.cubes.map((_, i) => cubeOwner(b.name, i)));
  }, [model, selection]);

  const rects: UvRect[] = useMemo(() => {
    if (!model) return [];
    return model.bones.flatMap((bone) =>
      bone.cubes.flatMap((cube, index) =>
        (Object.entries(boxUvRects(cube)) as [FaceName, [number, number, number, number]][]).map(([face, rect]) => ({
          owner: cubeOwner(bone.name, index),
          face,
          rect,
        })),
      ),
    );
  }, [model]);

  // Poignée de déplacement : le coin d'un cube (dans son os) ou le pivot d'un os (dans son parent).
  const matrices = useMemo(() => (model ? boneMatrices(model) : new Map()), [model]);
  const gizmo = useMemo(() => {
    if (!model || !selection) return null;
    const target = model.bones.find((b) => b.name === selection.bone);
    if (!target) return null;
    if (selection.kind === "cube") {
      const c = target.cubes[selection.index];
      const parent = matrices.get(target.name);
      if (!c || !parent) return null;
      return { parent, position: c.origin.map((v, i) => v + c.size[i]! / 2) as [number, number, number] };
    }
    const parent = (target.parent && matrices.get(target.parent)) || ENTITY_ROOT;
    return { parent, position: target.pivot };
  }, [model, selection, matrices]);
  const dragBase = useRef<EntityModel | null>(null);
  const move = (delta: [number, number, number], done: boolean) => {
    if (!model || !selection) return;
    const base = dragBase.current ?? model;
    dragBase.current = base;
    const next = cloneModel(base);
    const target = next.bones.find((b) => b.name === selection.bone);
    const round = (v: number) => Math.round(v * 1000) / 1000;
    if (target && selection.kind === "cube") {
      const c = target.cubes[selection.index];
      if (c) c.origin = c.origin.map((v, i) => round(v + delta[i]!)) as [number, number, number];
    } else if (target) {
      target.pivot = target.pivot.map((v, i) => round(v + delta[i]!)) as [number, number, number];
    }
    if (done) {
      if (delta.some((d) => d !== 0)) studio.changeFrom(base, next);
      dragBase.current = null;
      setNotice(null);
    } else {
      studio.preview(next);
    }
  };

  const edit = useCallback(
    (update: (draft: EntityModel) => void) => {
      if (!studio.model) return;
      const draft = cloneModel(studio.model);
      update(draft);
      studio.change(draft);
      setNotice(null);
    },
    [studio],
  );

  const bone = model && selection ? model.bones.find((b) => b.name === selection.bone) : undefined;
  const cube = bone && selection?.kind === "cube" ? bone.cubes[selection.index] : undefined;

  // ── Actions ───────────────────────────────────────────────────────────────

  const addBone = () =>
    edit((draft) => {
      const parent = selection?.bone ?? null;
      const name = freeBoneName(draft);
      draft.bones.push({ name, parent, pivot: parent ? [0, 0, 0] : [0, 24, 0], rotation: [0, 0, 0], cubes: [] });
      setSelection({ kind: "bone", bone: name });
    });

  const addCube = () =>
    edit((draft) => {
      let target = draft.bones.find((b) => b.name === selection?.bone);
      if (!target) {
        const name = freeBoneName(draft);
        target = { name, parent: null, pivot: [0, 24, 0], rotation: [0, 0, 0], cubes: [] };
        draft.bones.push(target);
      }
      const size: [number, number, number] = [4, 4, 4];
      const taken = draft.bones.flatMap((b) => b.cubes.map(boxUvBounds));
      const [w, h] = boxUvSize(size);
      const uv = freeUvSpot(taken, w, h, { width: draft.textureWidth, height: draft.textureHeight }) ?? [0, 0];
      target.cubes.push(makeCube([-2, -4, -2], size, uv));
      setSelection({ kind: "cube", bone: target.name, index: target.cubes.length - 1 });
    });

  const duplicate = () => {
    if (!selection || !model) return;
    edit((draft) => {
      const source = draft.bones.find((b) => b.name === selection.bone);
      if (!source) return;
      if (selection.kind === "cube") {
        const original = source.cubes[selection.index];
        if (!original) return;
        const copy: EntityCube = cloneModel(original);
        copy.origin = [copy.origin[0] + 1, copy.origin[1], copy.origin[2]];
        source.cubes.push(copy);
        setSelection({ kind: "cube", bone: source.name, index: source.cubes.length - 1 });
      } else {
        const name = freeBoneName(draft, source.name);
        draft.bones.push({ ...cloneModel(source), name });
        setSelection({ kind: "bone", bone: name });
      }
    });
  };

  const remove = () => {
    if (!selection || !model) return;
    edit((draft) => {
      if (selection.kind === "cube") {
        const target = draft.bones.find((b) => b.name === selection.bone);
        target?.cubes.splice(selection.index, 1);
        setSelection({ kind: "bone", bone: selection.bone });
      } else {
        const gone = subtree(draft, selection.bone);
        draft.bones = draft.bones.filter((b) => !gone.has(b.name));
        setSelection(null);
      }
    });
    setNotice(null);
  };

  const rename = (name: string) => {
    if (!bone || !model || boneNameProblem(model, name, bone.name) || name === bone.name) return;
    const old = bone.name;
    edit((draft) => {
      for (const b of draft.bones) {
        if (b.name === old) b.name = name;
        if (b.parent === old) b.parent = name;
      }
    });
    setSelection(selection?.kind === "cube" ? { ...selection, bone: name } : { kind: "bone", bone: name });
  };

  /** Range les zones de texture sans chevauchement (et agrandit la texture si besoin). */
  const packUv = () => {
    if (!model) return;
    const cubes = model.bones.flatMap((b) => b.cubes.map((c) => c.size as [number, number, number]));
    const packed = packBoxUv(cubes, model.textureWidth);
    edit((draft) => {
      let i = 0;
      for (const b of draft.bones) for (const c of b.cubes) c.uv = packed.uvs[i++] ?? c.uv;
      draft.textureWidth = Math.max(draft.textureWidth, packed.width);
      draft.textureHeight = Math.max(draft.textureHeight, packed.height);
    });
    if (pixels && (packed.width > pixels.width || packed.height > pixels.height)) {
      studio.putTexture(texturePath, resizePixels(pixels, Math.max(pixels.width, packed.width), Math.max(pixels.height, packed.height)));
    }
  };

  /** Patron : chaque face remplie d'une couleur (une teinte par os), à peindre ensuite. */
  const template = () => {
    if (!model) return;
    const out = pixels ? resizePixels(pixels, model.textureWidth, model.textureHeight) : blankPixels(model.textureWidth, model.textureHeight);
    model.bones.forEach((b, boneIndex) => {
      const base = TEMPLATE_COLORS[boneIndex % TEMPLATE_COLORS.length]!;
      for (const c of b.cubes) {
        for (const [face, [x, y, w, h]] of Object.entries(boxUvRects(c)) as [FaceName, [number, number, number, number]][]) {
          fillRect(out, x, y, w, h, shade(base, TEMPLATE_SHADE[face]));
        }
      }
    });
    studio.putTexture(texturePath, out);
  };

  const resizeTexture = (width: number, height: number) => {
    edit((draft) => {
      draft.textureWidth = width;
      draft.textureHeight = height;
    });
    if (pixels) studio.putTexture(texturePath, resizePixels(pixels, width, height));
  };

  const save = async () => {
    if (!model) return;
    setSaving(true);
    studio.setError(null);
    try {
      await studio.saveTextures();
      const saved = await mcstudioApi.saveEntityModel(project.id, model);
      studio.setModelDirty(false);
      setNotice(saved.java ? `Enregistré · ${saved.java.split("/").at(-1)}` : "Enregistré");
      if (saved.note) studio.setError(saved.note);
      if (code !== null) setCode(await mcstudioApi.entityModelCode(project.id, model));
      onSaved(saved);
    } catch (e) {
      studio.setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const showCode = async () => {
    if (!model) return;
    if (code !== null) return setCode(null);
    try {
      setCode(await mcstudioApi.entityModelCode(project.id, model));
    } catch (e) {
      studio.setError(errorText(e));
    }
  };

  // Suppr, Ctrl+D, Ctrl+S dans l'éditeur.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest("[data-studio]") || target.closest("input, textarea")) return;
      const ctrl = event.ctrlKey || event.metaKey;
      if (event.key === "Delete") remove();
      else if (ctrl && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicate();
      } else if (ctrl && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const dirty = studio.modelDirty || studio.dirtyTextures.size > 0;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  const textureMissing = !pixels && studio.missing.has(texturePath);
  const pick = (owner: string | null) => {
    const match = owner?.match(/^c:(.+):(\d+)$/);
    setSelection(match ? { kind: "cube", bone: match[1]!, index: Number(match[2]) } : null);
  };

  if (!model) {
    return (
      <div className="flex flex-1 items-center justify-center">
        {studio.error ? <p className="text-footnote text-danger">{studio.error}</p> : <p className="text-footnote text-text-subtle">Lecture du modèle…</p>}
      </div>
    );
  }

  const order = tree(model);
  const parentOptions = [
    { value: "", label: "Aucun (racine)" },
    ...model.bones.filter((b) => bone && !subtree(model, bone.name).has(b.name)).map((b) => ({ value: b.name, label: b.name })),
  ];
  const cubeCount = model.bones.reduce((n, b) => n + b.cubes.length, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-studio tabIndex={-1}>
      <StudioHeader
        title={info.label}
        subtitle={
          <>
            Entité · {model.bones.length} os · {cubeCount} cube{cubeCount > 1 ? "s" : ""} · texture {model.textureWidth}×{model.textureHeight}
            <span className="font-mono"> · {info.relative}</span>
          </>
        }
        dirty={dirty}
        saving={saving}
        notice={notice}
        onSave={() => void save()}
      >
        <Button type="button" size="sm" variant="ghost" onClick={() => void showCode()} icon={<Code2 size={14} />} aria-pressed={code !== null}>
          Code Java
        </Button>
      </StudioHeader>
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
            canPaint={Boolean(pixels)}
            history={studio.history}
            onUndo={studio.undo}
            onRedo={studio.redo}
          />
          <div className="relative min-h-0 flex-1 bg-bg-subtle">
            <Viewport
              parts={parts}
              textures={textures}
              textureVersion={studio.textureVersion}
              selected={selectedOwners}
              mode={studio.mode}
              frameKey={info.id}
              floor="entity"
              onPick={(owner) => pick(owner)}
              onPaint={studio.paint}
              gizmo={gizmo}
              onMove={move}
            />
            <p className="pointer-events-none absolute bottom-2 left-3 text-caption text-text-subtle">
              {studio.mode === "paint"
                ? "Glisser : peindre · clic droit : tourner · molette : zoom"
                : "Clic : choisir un cube, ses flèches le déplacent · glisser : tourner · clic droit : déplacer la vue · molette : zoom"}
            </p>
            {studio.error && (
              <p role="alert" className="absolute left-3 right-3 top-3 rounded-md bg-danger-soft px-3 py-2 text-footnote">
                {studio.error}
              </p>
            )}
          </div>
          {code !== null && (
            <div className="max-h-[40%] shrink-0 overflow-auto border-t border-border bg-surface-1">
              <div className="flex items-center justify-between px-3 py-1.5">
                <p className="text-caption text-text-subtle">
                  Géométrie générée à chaque enregistrement : utilisez-la dans le modèle et le rendu de votre entité.
                </p>
                <Button type="button" size="sm" variant="ghost" icon={<Copy size={13} />} onClick={() => void navigator.clipboard?.writeText(code)}>
                  Copier
                </Button>
              </div>
              <pre className="selectable px-3 pb-3 font-mono text-caption leading-relaxed text-text-muted">{code}</pre>
            </div>
          )}
        </div>

        <aside aria-label="Structure et réglages du modèle" className="w-[300px] shrink-0 overflow-y-auto border-l border-border">
          <PanelSection
            title="Os et cubes"
            actions={
              <>
                <IconButton label="Nouvel os (dans l'os choisi)" onClick={addBone}>
                  <Bone size={14} />
                </IconButton>
                <IconButton label="Nouveau cube (dans l'os choisi)" onClick={addCube}>
                  <Plus size={14} />
                </IconButton>
                <IconButton label="Dupliquer (Ctrl+D)" disabled={!selection} onClick={duplicate}>
                  <Copy size={14} />
                </IconButton>
                <IconButton label="Supprimer (Suppr)" disabled={!selection} danger onClick={remove}>
                  <Trash2 size={14} />
                </IconButton>
              </>
            }
          >
            <ul role="tree" aria-label="Os du modèle" className="space-y-px">
              {order.map(({ name, depth }) => {
                const b = model.bones.find((x) => x.name === name)!;
                const boneSelected = selection?.kind === "bone" && selection.bone === name;
                return (
                  <li key={name} role="treeitem" aria-selected={boneSelected} aria-expanded>
                    <button
                      type="button"
                      onClick={() => setSelection({ kind: "bone", bone: name })}
                      className={cn(
                        "flex h-7 w-full items-center gap-1.5 rounded-sm pr-2 text-left text-footnote transition-colors",
                        boneSelected ? "bg-accent-soft text-text" : "text-text-muted hover:bg-surface-2 hover:text-text",
                        focusRing,
                      )}
                      style={{ paddingLeft: 6 + depth * 12 }}
                    >
                      <Bone size={13} aria-hidden className="shrink-0 text-text-subtle" />
                      <span className="truncate font-mono">{name}</span>
                    </button>
                    {b.cubes.length > 0 && (
                      <ul role="group" className="space-y-px">
                        {b.cubes.map((c, index) => {
                          const cubeSelected = selection?.kind === "cube" && selection.bone === name && selection.index === index;
                          return (
                            <li key={index} role="treeitem" aria-selected={cubeSelected}>
                              <button
                                type="button"
                                onClick={() => setSelection({ kind: "cube", bone: name, index })}
                                className={cn(
                                  "flex h-6 w-full items-center gap-1.5 rounded-sm pr-2 text-left text-caption transition-colors",
                                  cubeSelected ? "bg-accent-soft text-text" : "text-text-subtle hover:bg-surface-2 hover:text-text",
                                  focusRing,
                                )}
                                style={{ paddingLeft: 22 + depth * 12 }}
                              >
                                <Box size={12} aria-hidden className="shrink-0" />
                                <span className="tabular-nums">
                                  {c.size.map((v) => Math.round(v * 100) / 100).join(" × ")}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
            {model.bones.length === 0 && <p className="text-caption text-text-subtle">Aucun os : ajoutez un cube pour commencer.</p>}
          </PanelSection>

          {bone && selection?.kind === "bone" && (
            <PanelSection title="Os">
              <label className="block space-y-1">
                <span className="text-caption text-text-subtle">Nom (utilisé par le code)</span>
                <input
                  value={nameDraft ?? bone.name}
                  spellCheck={false}
                  onChange={(event) => setNameDraft(event.target.value)}
                  onBlur={() => {
                    if (nameDraft !== null) rename(nameDraft.trim());
                    setNameDraft(null);
                  }}
                  onKeyDown={(event) => event.key === "Enter" && (event.target as HTMLInputElement).blur()}
                  className={cn(inputClass, "h-7 font-mono text-caption")}
                />
                {nameDraft !== null && boneNameProblem(model, nameDraft.trim(), bone.name) && (
                  <span className="text-caption text-danger">{boneNameProblem(model, nameDraft.trim(), bone.name)}</span>
                )}
              </label>
              <Select
                label="Parent"
                value={bone.parent ?? ""}
                options={parentOptions}
                onChange={(value) =>
                  edit((draft) => {
                    draft.bones.find((b) => b.name === bone.name)!.parent = value || null;
                  })
                }
              />
              <Vec3Input
                label="Pivot (relatif au parent ; racine : 24 = sol)"
                value={bone.pivot}
                step={0.5}
                onChange={(pivot) => edit((draft) => void (draft.bones.find((b) => b.name === bone.name)!.pivot = pivot))}
              />
              <Vec3Input
                label="Rotation (degrés)"
                value={bone.rotation}
                step={2.5}
                onChange={(rotation) => edit((draft) => void (draft.bones.find((b) => b.name === bone.name)!.rotation = rotation))}
              />
            </PanelSection>
          )}

          {cube && selection?.kind === "cube" && (
            <PanelSection title="Cube">
              <Vec3Input
                label="Position (coin, relatif au pivot de l'os)"
                value={cube.origin}
                step={0.5}
                onChange={(origin) => edit((draft) => void (draft.bones.find((b) => b.name === selection.bone)!.cubes[selection.index]!.origin = origin))}
              />
              <Vec3Input
                label="Taille"
                value={cube.size}
                min={0}
                onChange={(size) => edit((draft) => void (draft.bones.find((b) => b.name === selection.bone)!.cubes[selection.index]!.size = size))}
              />
              <div className="grid grid-cols-3 gap-2">
                <label className="space-y-1">
                  <span className="text-caption text-text-subtle">U</span>
                  <NumberInput
                    label="Coin U de la texture"
                    value={cube.uv[0]}
                    min={0}
                    onChange={(u) => edit((draft) => void (draft.bones.find((b) => b.name === selection.bone)!.cubes[selection.index]!.uv[0] = Math.round(u)))}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-caption text-text-subtle">V</span>
                  <NumberInput
                    label="Coin V de la texture"
                    value={cube.uv[1]}
                    min={0}
                    onChange={(v) => edit((draft) => void (draft.bones.find((b) => b.name === selection.bone)!.cubes[selection.index]!.uv[1] = Math.round(v)))}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-caption text-text-subtle">Gonflement</span>
                  <NumberInput
                    label="Gonflement"
                    value={cube.inflate}
                    step={0.25}
                    onChange={(inflate) => edit((draft) => void (draft.bones.find((b) => b.name === selection.bone)!.cubes[selection.index]!.inflate = inflate))}
                  />
                </label>
              </div>
              <div className="-ml-2">
                <Switch
                  checked={cube.mirror}
                  onChange={(mirror) => edit((draft) => void (draft.bones.find((b) => b.name === selection.bone)!.cubes[selection.index]!.mirror = mirror))}
                >
                  Texture en miroir (bras, jambes)
                </Switch>
              </div>
            </PanelSection>
          )}

          <PanelSection
            title="Texture"
            actions={
              <>
                <IconButton label="Répartir les zones de texture sans chevauchement" onClick={packUv} disabled={cubeCount === 0}>
                  <LayoutGrid size={14} />
                </IconButton>
                <IconButton label="Patron : colorer chaque face pour peindre ensuite" onClick={template} disabled={cubeCount === 0}>
                  <Grid2x2 size={14} />
                </IconButton>
              </>
            }
          >
            <p className="selectable truncate font-mono text-caption text-text-subtle" title={texturePath}>
              {texturePath.split("/textures/").at(-1)}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-caption text-text-subtle">Largeur</span>
                <NumberInput label="Largeur de la texture" value={model.textureWidth} min={1} onChange={(w) => resizeTexture(Math.min(1024, Math.round(w)), model.textureHeight)} />
              </label>
              <label className="space-y-1">
                <span className="text-caption text-text-subtle">Hauteur</span>
                <NumberInput label="Hauteur de la texture" value={model.textureHeight} min={1} onChange={(h) => resizeTexture(model.textureWidth, Math.min(1024, Math.round(h)))} />
              </label>
            </div>
            {pixels ? (
              <UvView
                pixels={pixels}
                texture={texturePath}
                version={studio.textureVersion}
                rects={rects}
                selected={selectedOwners[0] ?? null}
                mode={studio.mode}
                onPaint={studio.paint}
                onPick={(owner) => pick(owner)}
                size={272}
              />
            ) : textureMissing ? (
              <div className="space-y-2">
                <p className="text-caption text-text-subtle">La texture n'existe pas encore.</p>
                <Button type="button" size="sm" onClick={() => studio.putTexture(texturePath, blankPixels(model.textureWidth, model.textureHeight) as Pixels)}>
                  Créer la texture
                </Button>
              </div>
            ) : (
              <p className="text-caption text-text-subtle">Lecture de la texture…</p>
            )}
          </PanelSection>
        </aside>
      </div>
    </div>
  );
}
