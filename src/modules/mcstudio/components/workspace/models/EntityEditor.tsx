import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bone, Box, Code2, Cone, Copy, Cylinder, Globe, Grid2x2, LayoutGrid, Move3d, Palette, Pickaxe, Plus, Scale3d, Trash2 } from "lucide-react";
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
  cubeOwner,
  ENTITY_ROOT,
  entityParts,
  packBoxUv,
} from "../../../lib/models/geometry";
import {
  allocateBoxUv,
  boundsOf,
  carveCube,
  copyCubeTexture,
  cubeBox,
  SHAPE_LABEL,
  shapeBounds,
  shapeBoxes,
  subtractBox,
  type Aabb,
  type ShapeKind,
} from "../../../lib/models/shapes";
import { cloneModel, type FaceName, type Vec3 } from "../../../lib/models/types";
import { blankPixels, clonePixels, drawScaled, fillRect, resizePixels, shade, type Pixels, type Rgba } from "../../../lib/pixels";
import { focusRing, inputClass, Switch } from "../../ui";
import { IconButton, NumberInput, PanelSection, StudioHeader, StudioToolbar, Vec3Input } from "./controls";
import { TextureChoice, texturePixelsOf, useModTextures, useTextureAtelier, type TextureSource } from "./TextureChoice";
import { CarvePanel, defaultParams, ShapePanel, type ShapeDraft } from "./tools";
import { useStudio } from "./useStudio";
import { UvView, type UvRect } from "./UvView";
import { Viewport } from "./Viewport";

type Selection = { kind: "bone"; bone: string } | { kind: "cube"; bone: string; index: number } | null;

/** Outil en cours : forme à créer (dans un nouvel os), zone à creuser, texture des cubes choisis. */
type Tool =
  | { kind: "shape"; draft: ShapeDraft; parent: string | null }
  | { kind: "carve"; hole: Aabb; bone: string; cubes: number[] }
  | { kind: "texture"; source: TextureSource }
  | null;
type Transform = "move" | "resize";
/** Remplissage de la zone de texture d'un cube. */
type Fill = { kind: "color"; color: Rgba } | { kind: "image"; image: Pixels };

const SHAPE_NAME: Record<ShapeKind, string> = { cube: "cube", cylinder: "cylindre", sphere: "sphere", cone: "cone" };
const SHAPE_ICON: Record<ShapeKind, typeof Box> = { cube: Box, cylinder: Cylinder, sphere: Globe, cone: Cone };
const round = (v: number) => Math.round(v * 1000) / 1000;
const snap = (v: number) => Math.round(v * 2) / 2;
const sizeOf = (box: Aabb) => box.to.map((v, i) => round(v - box.from[i]!)) as Vec3;

/**
 * Formes vues comme dans l'éditeur de blocs : l'espace des entités a Y vers le bas et Z vers
 * l'arrière, une pointe « +Y » monte donc à l'écran.
 */
const toEntitySpace = (box: Aabb): Aabb => ({
  from: [box.from[0], round(-box.to[1]), round(-box.to[2])],
  to: [box.to[0], round(-box.from[1]), round(-box.from[2])],
});

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
  const [tool, setTool] = useState<Tool>(null);
  const [transform, setTransform] = useState<Transform>("move");
  const [busy, setBusy] = useState(false);
  const modTextures = useModTextures(project.id);
  const atelier = useTextureAtelier(project, modTextures);

  useEffect(() => {
    let cancelled = false;
    setSelection(null);
    setTool(null);
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

  // ── Aperçu de la forme, zone à creuser ──────────────────────────────────

  const matrices = useMemo(() => (model ? boneMatrices(model) : new Map()), [model]);
  const preview = useMemo(() => {
    if (!model || tool?.kind !== "shape") return [];
    const boxes = shapeBoxes(tool.draft.params).map(toEntitySpace);
    const ghost: EntityModel = {
      ...model,
      bones: [
        ...model.bones,
        { name: "__apercu", parent: tool.parent, pivot: tool.draft.center, rotation: [0, 0, 0], cubes: boxes.map((b) => makeCube(b.from, sizeOf(b), [0, 0])) },
      ],
    };
    return entityParts(ghost, null).filter((part) => part.owner.startsWith("c:__apercu:"));
  }, [model, tool]);
  const carveBone = tool?.kind === "carve" ? model?.bones.find((b) => b.name === tool.bone) : undefined;
  const boxes = useMemo(
    () => (tool?.kind === "carve" ? [{ ...tool.hole, parent: matrices.get(tool.bone), tone: "danger" as const }] : []),
    [tool, matrices],
  );
  const touched =
    tool?.kind === "carve" && carveBone ? tool.cubes.filter((i) => carveBone.cubes[i] && subtractBox(cubeBox(carveBone.cubes[i]!), tool.hole)).length : 0;

  // Poignée : la forme, la zone à creuser, le coin (ou la taille) d'un cube, le pivot d'un os.
  const gizmo = useMemo(() => {
    if (!model) return null;
    if (tool?.kind === "shape") return { parent: (tool.parent && matrices.get(tool.parent)) || ENTITY_ROOT, position: tool.draft.center };
    if (tool?.kind === "carve") {
      const parent = matrices.get(tool.bone);
      return parent ? { parent, position: tool.hole.from.map((v, i) => (v + tool.hole.to[i]!) / 2) as Vec3 } : null;
    }
    if (!selection) return null;
    const target = model.bones.find((b) => b.name === selection.bone);
    if (!target) return null;
    if (selection.kind === "cube") {
      const c = target.cubes[selection.index];
      const parent = matrices.get(target.name);
      if (!c || !parent) return null;
      if (transform === "resize") return { parent, position: c.origin.map((v, i) => v + c.size[i]!) as Vec3 };
      return { parent, position: c.origin.map((v, i) => v + c.size[i]! / 2) as Vec3 };
    }
    if (transform === "resize") return null;
    const parent = (target.parent && matrices.get(target.parent)) || ENTITY_ROOT;
    return { parent, position: target.pivot };
  }, [model, selection, matrices, tool, transform]);
  const dragBase = useRef<{ model?: EntityModel; center?: Vec3; hole?: Aabb } | null>(null);
  const move = (delta: [number, number, number], done: boolean) => {
    const shifted = (base: Vec3) => base.map((v, i) => round(v + delta[i]!)) as Vec3;
    if (tool?.kind === "shape") {
      const base = dragBase.current?.center ?? tool.draft.center;
      dragBase.current = done ? null : { center: base };
      setTool({ ...tool, draft: { ...tool.draft, center: shifted(base) } });
      return;
    }
    if (tool?.kind === "carve") {
      const base = dragBase.current?.hole ?? tool.hole;
      dragBase.current = done ? null : { hole: base };
      setTool({ ...tool, hole: { from: shifted(base.from), to: shifted(base.to) } });
      return;
    }
    if (!model || !selection) return;
    const base = dragBase.current?.model ?? model;
    dragBase.current = { model: base };
    const next = cloneModel(base);
    const target = next.bones.find((b) => b.name === selection.bone);
    if (target && selection.kind === "cube") {
      const c = target.cubes[selection.index];
      if (c && transform === "resize") c.size = c.size.map((v, i) => Math.max(0, round(v + delta[i]!))) as Vec3;
      else if (c) c.origin = shifted(c.origin);
    } else if (target) {
      target.pivot = shifted(target.pivot);
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

  /** Cube dont on reprend la zone de texture : celui choisi, ou le premier de l'os choisi. */
  const sourceCube = bone ? (cube ?? bone.cubes[0]) : undefined;

  /** Image de travail à la taille du modèle (`width` × `height`). */
  const canvas = (width: number, height: number): Pixels => {
    const base = pixels ?? blankPixels(model?.textureWidth ?? width, model?.textureHeight ?? height);
    return base.width === width && base.height === height ? clonePixels(base) : resizePixels(base, width, height);
  };

  const paintCube = (out: Pixels, target: EntityCube, fill: Fill) => {
    for (const [face, [x, y, w, h]] of Object.entries(boxUvRects(target)) as [FaceName, [number, number, number, number]][]) {
      if (fill.kind === "color") fillRect(out, x, y, w, h, shade(fill.color, TEMPLATE_SHADE[face]));
      else drawScaled(out, fill.image, x, y, w, h);
    }
  };

  /** Texture choisie → remplissage (ou « même zone ») ; `null` : annulé. */
  const fillFor = async (source: TextureSource, label: string): Promise<Fill | "same" | null> => {
    if (source.kind === "same") return "same";
    if (source.kind === "color") return { kind: "color", color: studio.color };
    if (source.kind === "existing") return source.file ? { kind: "image", image: await texturePixelsOf(project.id, source.file) } : null;
    const name = `${model?.name ?? "entite"}_${label}`.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
    const image = await atelier.pick(name || "entite", label);
    return image ? { kind: "image", image } : null;
  };

  const openShape = (kind: ShapeKind) => {
    if (!model) return;
    const params = defaultParams(kind);
    const height = shapeBounds(params)[1];
    const parent = bone?.name ?? null;
    const area = bone ? boundsOf(bone.cubes.map(cubeBox)) : null;
    const center: Vec3 = area
      ? [snap((area.from[0] + area.to[0]) / 2), round(area.from[1] - height / 2), snap((area.from[2] + area.to[2]) / 2)]
      : parent
        ? [0, round(-height / 2), 0]
        : [0, round(24 - height / 2), 0];
    setTool({ kind: "shape", parent, draft: { params, center, source: sourceCube ? { kind: "same" } : { kind: "color", size: 16 } } });
    studio.setMode("select");
  };

  const createShape = async () => {
    if (!model || tool?.kind !== "shape") return;
    const { draft: shape, parent } = tool;
    let fill: Fill | "same" | null = null;
    setBusy(true);
    try {
      fill = await fillFor(shape.source, SHAPE_NAME[shape.params.kind]);
    } catch (e) {
      studio.setError(errorText(e));
    } finally {
      setBusy(false);
    }
    if (!fill) return;
    const boxes = shapeBoxes(shape.params).map(toEntitySpace);
    const sizes = boxes.map(sizeOf);
    const next = cloneModel(model);
    const name = freeBoneName(next, SHAPE_NAME[shape.params.kind]);
    let uvs: [number, number][];
    if (fill === "same") {
      uvs = sizes.map(() => (sourceCube ? [sourceCube.uv[0], sourceCube.uv[1]] : [0, 0]));
    } else {
      const placed = allocateBoxUv(next.bones.flatMap((b) => b.cubes.map(boxUvBounds)), sizes, { width: next.textureWidth, height: next.textureHeight });
      uvs = placed.uvs;
      next.textureWidth = placed.width;
      next.textureHeight = placed.height;
    }
    const cubes = boxes.map((b, i) => makeCube(b.from, sizes[i]!, uvs[i]!));
    next.bones.push({ name, parent, pivot: shape.center, rotation: [0, 0, 0], cubes });
    studio.change(next);
    if (fill !== "same") {
      const out = canvas(next.textureWidth, next.textureHeight);
      for (const c of cubes) paintCube(out, c, fill);
      studio.putTexture(texturePath, out);
    }
    setSelection({ kind: "bone", bone: name });
    setTool(null);
    setNotice(null);
  };

  const openCarve = () => {
    if (!model || !bone) return;
    const cubes = selection?.kind === "cube" ? [selection.index] : bone.cubes.map((_, i) => i);
    const area = boundsOf(cubes.map((i) => cubeBox(bone.cubes[i]!)));
    if (!area) return;
    // Un trou ouvert sur le dessus (Y vers le bas : le dessus est le plus petit Y).
    const center = area.from.map((v, i) => (v + area.to[i]!) / 2);
    const half = area.from.map((v, i) => Math.max(0.5, snap((area.to[i]! - v) / 4)));
    const top = area.from[1];
    const depth = Math.max(0.5, snap((area.to[1] - top) / 2));
    setTool({
      kind: "carve",
      bone: bone.name,
      cubes,
      hole: {
        from: [snap(center[0]! - half[0]!), top, snap(center[2]! - half[2]!)],
        to: [snap(center[0]! + half[0]!), round(top + depth), snap(center[2]! + half[2]!)],
      },
    });
    studio.setMode("select");
  };

  /** Creuse : les morceaux prennent de nouvelles zones, peintes d'après la peau du cube d'origine. */
  const carve = () => {
    if (!model || tool?.kind !== "carve") return;
    const next = cloneModel(model);
    const target = next.bones.find((b) => b.name === tool.bone);
    if (!target) return;
    const results = tool.cubes
      .map((index) => ({ index, original: target.cubes[index]!, pieces: target.cubes[index] ? carveCube(target.cubes[index]!, tool.hole) : null }))
      .filter((r): r is { index: number; original: EntityCube; pieces: EntityCube[] } => Boolean(r.pieces));
    if (results.length === 0) return;
    const carved = new Set(results.map((r) => r.index));
    const taken = next.bones.flatMap((b) => b.cubes.filter((_, i) => b.name !== target.name || !carved.has(i)).map(boxUvBounds));
    const placed = allocateBoxUv(taken, results.flatMap((r) => r.pieces.map((p) => p.size as Vec3)), { width: next.textureWidth, height: next.textureHeight });
    let k = 0;
    for (const r of results) for (const piece of r.pieces) piece.uv = placed.uvs[k++] ?? piece.uv;
    for (const r of [...results].sort((a, b) => b.index - a.index)) target.cubes.splice(r.index, 1, ...r.pieces);
    next.textureWidth = placed.width;
    next.textureHeight = placed.height;
    studio.change(next);
    if (pixels) {
      const out = canvas(placed.width, placed.height);
      const origin = clonePixels(out);
      for (const r of results) for (const piece of r.pieces) copyCubeTexture(out, r.original, piece, origin);
      studio.putTexture(texturePath, out);
    }
    const pieces = results.reduce((n, r) => n + r.pieces.length, 0);
    setSelection({ kind: "bone", bone: target.name });
    setTool(null);
    setNotice(`${results.length} cube${results.length > 1 ? "s" : ""} creusé${results.length > 1 ? "s" : ""} · ${pieces} morceau${pieces > 1 ? "x" : ""}`);
  };

  /** Remplit la zone de texture des cubes choisis (le cube, ou tous ceux de l'os). */
  const applyTexture = async () => {
    if (!model || tool?.kind !== "texture" || !bone) return;
    let fill: Fill | "same" | null = null;
    setBusy(true);
    try {
      fill = await fillFor(tool.source, bone.name);
    } catch (e) {
      studio.setError(errorText(e));
    } finally {
      setBusy(false);
    }
    if (!fill || fill === "same") return;
    const out = canvas(model.textureWidth, model.textureHeight);
    for (const c of cube ? [cube] : bone.cubes) paintCube(out, c, fill);
    studio.putTexture(texturePath, out);
    setTool(null);
  };

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
      if (!target.closest("[data-studio]") || target.closest("input, textarea, [role=dialog]")) return;
      const ctrl = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (event.key === "Escape") {
        if (tool) setTool(null);
        else setSelection(null);
      } else if (!ctrl && key === "v") {
        setTransform("move");
        studio.setMode("select");
      } else if (!ctrl && key === "s") {
        setTransform("resize");
        studio.setMode("select");
      } else if (event.key === "Delete") remove();
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
    <div className="relative flex min-h-0 flex-1 flex-col" data-studio tabIndex={-1}>
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
          >
            <span role="group" aria-label="Poignée" className="flex items-center">
              <IconButton label="Déplacer (V)" pressed={studio.mode === "select" && transform === "move"} onClick={() => (setTransform("move"), studio.setMode("select"))}>
                <Move3d size={15} strokeWidth={1.75} />
              </IconButton>
              <IconButton
                label="Redimensionner le cube (S) : la poignée tire le coin opposé"
                pressed={studio.mode === "select" && transform === "resize"}
                onClick={() => (setTransform("resize"), studio.setMode("select"))}
              >
                <Scale3d size={15} strokeWidth={1.75} />
              </IconButton>
            </span>
            <span aria-hidden className="mx-1 h-5 w-px bg-border" />
            <span role="group" aria-label="Ajouter" className="flex items-center">
              {(Object.keys(SHAPE_ICON) as ShapeKind[]).map((kind) => {
                const Icon = SHAPE_ICON[kind];
                return (
                  <IconButton
                    key={kind}
                    label={`Ajouter : ${SHAPE_LABEL[kind].toLowerCase()} (nouvel os${bone ? `, sous ${bone.name}` : ""})`}
                    pressed={tool?.kind === "shape" && tool.draft.params.kind === kind}
                    onClick={() => openShape(kind)}
                  >
                    <Icon size={15} strokeWidth={1.75} />
                  </IconButton>
                );
              })}
              <IconButton
                label={bone ? (cube ? "Creuser le cube choisi" : `Creuser les cubes de ${bone.name}`) : "Creuser : choisissez d'abord un os ou un cube"}
                pressed={tool?.kind === "carve"}
                disabled={!bone || bone.cubes.length === 0}
                onClick={openCarve}
              >
                <Pickaxe size={15} strokeWidth={1.75} />
              </IconButton>
            </span>
          </StudioToolbar>
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
              preview={preview}
              boxes={boxes}
            />
            <p className="pointer-events-none absolute bottom-2 left-3 text-caption text-text-subtle">
              {studio.mode === "paint"
                ? "Glisser : peindre · clic droit : tourner · molette : zoom"
                : tool?.kind === "shape"
                  ? "La poignée place la forme · Créer pour l'ajouter"
                  : tool?.kind === "carve"
                    ? "La poignée déplace la zone à creuser"
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
          {tool?.kind === "shape" && (
            <ShapePanel
              value={tool.draft}
              onChange={(draft) => setTool({ ...tool, draft })}
              onCreate={() => void createShape()}
              onCancel={() => setTool(null)}
              busy={busy}
              same={sourceCube ? `« ${bone?.name ?? "cube"} »` : null}
              textures={modTextures}
              modId={project.meta?.modId ?? ""}
              color={studio.color}
              entity
              centerLabel={tool.parent ? `Centre (dans l'os ${tool.parent})` : "Centre (24 = sol)"}
            />
          )}
          {tool?.kind === "carve" && (
            <CarvePanel
              hole={tool.hole}
              onChange={(hole) => setTool({ ...tool, hole })}
              onApply={carve}
              onCancel={() => setTool(null)}
              touched={touched}
              scope={tool.cubes.length === 1 ? "ce cube" : `${tool.cubes.length} cubes de ${tool.bone}`}
            />
          )}
          {tool?.kind === "texture" && bone && (
            <PanelSection title={cube ? "Texture du cube" : `Texture des cubes de ${bone.name}`}>
              <TextureChoice
                value={tool.source}
                onChange={(source) => setTool({ kind: "texture", source })}
                same={null}
                textures={modTextures}
                modId={project.meta?.modId ?? ""}
                color={studio.color}
                entity
              />
              <p className="text-caption text-text-subtle">Les cubes qui partagent cette zone de texture changent aussi.</p>
              <div className="flex justify-end gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => setTool(null)}>
                  Annuler
                </Button>
                <Button type="button" size="sm" variant="primary" disabled={busy} onClick={() => void applyTexture()}>
                  Appliquer
                </Button>
              </div>
            </PanelSection>
          )}
          <PanelSection
            title="Os et cubes"
            actions={
              <>
                <IconButton label="Nouvel os (dans l'os choisi)" onClick={addBone}>
                  <Bone size={14} />
                </IconButton>
                <IconButton label="Nouveau cube (dans un nouvel os, sous l'os choisi)" onClick={() => openShape("cube")}>
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
            <PanelSection
              title="Cube"
              actions={
                <IconButton label="Texture du cube : couleur, texture du mod, image générée ou importée" onClick={() => setTool({ kind: "texture", source: { kind: "color", size: 16 } })}>
                  <Palette size={14} />
                </IconButton>
              }
            >
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
      {atelier.overlay}
    </div>
  );
}
