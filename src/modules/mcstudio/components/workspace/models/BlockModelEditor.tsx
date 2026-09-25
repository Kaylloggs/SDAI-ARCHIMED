import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Matrix4 } from "three";
import { Box, Cone, Copy, Cylinder, Folder, Globe, Group, ImagePlus, Layers, Move3d, Palette, Pickaxe, Scale3d, Shapes, Trash2, Ungroup } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Button, Select } from "@/design-system/primitives";
import type { ModelInfo } from "@/core/ipc/bindings/ModelInfo";
import type { ProjectSummary } from "@/core/ipc/bindings/ProjectSummary";
import { errorText, mcstudioApi } from "../../../api";
import { defaultUv, elementFaceRect, elementParts, spriteParts, type Part } from "../../../lib/models/geometry";
import {
  freeGroupName,
  groupAt,
  indicesOf,
  outline,
  parentOf,
  placeElements,
  removeElements,
  renameGroup,
  replaceElements,
  ungroup,
  type OutlinerNode,
} from "../../../lib/models/groups";
import { resolveModel, resolveTexture, textureFile, textureReference, type ResolvedModel } from "../../../lib/models/resolve";
import {
  boundsOf,
  boxElement,
  carveElement,
  isRotated,
  itemDisplay,
  SHAPE_LABEL,
  spriteElements,
  subtractBox,
  type Aabb,
  type ShapeKind,
} from "../../../lib/models/shapes";
import {
  cloneModel,
  FACE_LABEL,
  FACES,
  ROTATION_ANGLES,
  type BlockModel,
  type FaceName,
  type ModelElement,
  type Uv,
  type Vec3,
} from "../../../lib/models/types";
import { blankPixels, solidPixels, type Pixels } from "../../../lib/pixels";
import { focusRing, inputClass, Segmented, Switch } from "../../ui";
import { IconButton, NumberInput, PanelSection, StudioHeader, StudioToolbar, Vec3Input } from "./controls";
import { TextureChoice, useModTextures, useTextureAtelier, type TextureSource } from "./TextureChoice";
import { CarvePanel, defaultParams, placedBoxes, ShapePanel, type ShapeDraft } from "./tools";
import { useStudio } from "./useStudio";
import { UvView, type UvRect } from "./UvView";
import { Viewport } from "./Viewport";

/** Cubes choisis (le premier est celui que détaillent les réglages), face et groupe choisis. */
type Selection = { indices: number[]; face: FaceName | null; group: string | null };
const NONE: Selection = { indices: [], face: null, group: null };

type Tool = { kind: "shape"; draft: ShapeDraft } | { kind: "carve"; hole: Aabb } | { kind: "texture"; source: TextureSource } | null;
type Transform = "move" | "resize";

/** Ce qu'une texture choisie devient dans le modèle. */
type Prepared = { kind: "same" } | { kind: "reference"; reference: string; file: string | null; pixels: Pixels | null };

const FACE_SHORT: Record<FaceName, string> = { north: "N", south: "S", east: "E", west: "O", up: "↑", down: "↓" };
const SHAPE_NAME: Record<ShapeKind, string> = { cube: "cube", cylinder: "cylindre", sphere: "sphere", cone: "cone" };
const SHAPE_ICON: Record<ShapeKind, typeof Box> = { cube: Box, cylinder: Cylinder, sphere: Globe, cone: Cone };

const round = (v: number) => Math.round(v * 1000) / 1000;
const snap = (v: number) => Math.round(v * 2) / 2;
const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
/** Identifiant de registre valide (`ruby_lamp_cylindre`). */
const safeId = (text: string) => text.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "texture";

/** Variable de texture pointant vers `reference` (réutilisée si elle existe déjà). */
function ensureVariable(draft: BlockModel, reference: string): string {
  const textures = { ...(draft.textures ?? {}) };
  const found = Object.entries(textures).find(([key, value]) => key !== "particle" && value === reference);
  if (found) return `#${found[0]}`;
  let n = 0;
  while (textures[String(n)] !== undefined) n += 1;
  textures[String(n)] = reference;
  if (!textures.particle) textures.particle = `#${n}`;
  draft.textures = textures;
  return `#${n}`;
}

/**
 * Éditeur des modèles de blocs et d'objets (JSON du jeu), à la manière de Blockbench : cubes
 * rangés en groupes, sélection multiple (Maj ou Ctrl), formes (cube, cylindre, sphère, cône)
 * avec aperçu, creuser, déplacer ou redimensionner à la poignée, texture de chaque cube (même
 * texture, réutilisée, unie ou faite dans l'atelier), peinture sur le modèle. Un objet à plat
 * passe en 3D (cubes d'un pixel) pour recevoir d'autres cubes.
 */
export function BlockModelEditor({
  project,
  info,
  onSaved,
  onDirty,
}: {
  project: ProjectSummary;
  info: ModelInfo;
  onSaved: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const modId = project.meta?.modId ?? "";
  const studio = useStudio<BlockModel>(project.id);
  const { model, textures } = studio;
  const [resolved, setResolved] = useState<ResolvedModel | null>(null);
  const [selection, setSelection] = useState<Selection>(NONE);
  const [tool, setTool] = useState<Tool>(null);
  const [transform, setTransform] = useState<Transform>("move");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [uvTexture, setUvTexture] = useState<string | null>(null);
  const [groupName, setGroupName] = useState<string | null>(null);
  const parents = useRef(new Map<string, BlockModel | null>());
  const modTextures = useModTextures(project.id);
  const atelier = useTextureAtelier(project, modTextures);
  const stem = info.id.split("/").slice(1).join("/");
  const folder = info.kind === "item" ? "item" : "block";

  useEffect(() => {
    let cancelled = false;
    setSelection(NONE);
    setTool(null);
    parents.current.clear();
    mcstudioApi
      .readModel(project.id, info.id)
      .then((file) => {
        if (cancelled) return;
        studio.open(file.exists ? (JSON.parse(file.json) as BlockModel) : { parent: "minecraft:block/block", elements: [] });
      })
      .catch((e) => !cancelled && studio.setError(errorText(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, info.id]);

  const loadParent = useCallback(
    async (reference: string): Promise<BlockModel | null> => {
      if (parents.current.has(reference)) return parents.current.get(reference) ?? null;
      const found = await mcstudioApi
        .readModel(project.id, reference)
        .then((file) => (file.exists ? (JSON.parse(file.json) as BlockModel) : null))
        .catch(() => null);
      parents.current.set(reference, found);
      return found;
    },
    [project.id],
  );

  useEffect(() => {
    if (!model) return;
    let cancelled = false;
    void resolveModel(model, modId, loadParent).then((result) => {
      if (cancelled) return;
      setResolved(result);
      const files = Object.values(result.textures)
        .map((value) => resolveTexture(value, result.textures))
        .map((ref) => (ref ? textureFile(ref, modId) : null))
        .filter((f): f is string => Boolean(f));
      void studio.loadTextures([...new Set(files)]);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, modId, loadParent]);

  const fileOf = useCallback(
    (variable: string) => {
      const ref = resolved ? resolveTexture(variable, resolved.textures) : null;
      return ref ? textureFile(ref, modId) : null;
    },
    [resolved, modId],
  );

  const elements = useMemo(() => resolved?.elements ?? [], [resolved]);
  const editable = Boolean(resolved?.own) && !resolved?.generated;
  const nodes = useMemo(() => (model && editable ? outline(model) : elements.map((_, i) => i as OutlinerNode)), [model, editable, elements]);

  const textureOfPart = useCallback(
    (variable: string) => {
      const file = fileOf(variable);
      const pixels = file ? textures.get(file) : undefined;
      return { file: pixels ? file : null, size: pixels };
    },
    [fileOf, textures],
  );

  const parts: Part[] = useMemo(() => {
    if (!resolved) return [];
    if (resolved.generated) {
      return Object.keys(resolved.textures)
        .filter((key) => /^layer\d+$/.test(key))
        .sort()
        .flatMap((key, layer) => {
          const file = fileOf(`#${key}`);
          const pixels = file ? textures.get(file) : undefined;
          return file && pixels ? spriteParts(pixels, file, layer) : [];
        });
    }
    return elements.flatMap((element, index) => elementParts(element, index, textureOfPart));
  }, [resolved, elements, textures, fileOf, textureOfPart]);

  const usedFiles = useMemo(() => [...new Set(parts.map((p) => p.texture).filter((t): t is string => Boolean(t)))], [parts]);
  const shownTexture = uvTexture && usedFiles.includes(uvTexture) ? uvTexture : (usedFiles[0] ?? null);
  const shownPixels = shownTexture ? textures.get(shownTexture) : undefined;
  const rects: UvRect[] = useMemo(() => {
    if (!shownPixels || resolved?.generated) return [];
    return elements.flatMap((element, index) =>
      FACES.filter((face) => element.faces[face] && fileOf(element.faces[face]!.texture) === shownTexture).map((face) => ({
        owner: `e${index}`,
        face,
        rect: elementFaceRect(element, face, shownPixels)!,
      })),
    );
  }, [elements, shownPixels, shownTexture, fileOf, resolved]);

  const chosen = useMemo(() => selection.indices.filter((i) => i < elements.length), [selection, elements]);
  const primary = chosen.length > 0 ? elements[chosen[0]!] : undefined;
  const bounds = useMemo(() => boundsOf(chosen.map((i) => elements[i]!).filter(Boolean)), [chosen, elements]);

  // ── Aperçu de la forme et zone à creuser ────────────────────────────────

  const shapeBoxesPlaced = useMemo(() => (tool?.kind === "shape" ? placedBoxes(tool.draft) : []), [tool]);
  const preview: Part[] = useMemo(
    () => shapeBoxesPlaced.flatMap((box, i) => elementParts(boxElement(box, "aperçu", () => "#aperçu"), 10_000 + i, () => ({ file: null }))),
    [shapeBoxesPlaced],
  );
  const carveTargets = useMemo(() => (chosen.length > 0 ? chosen : elements.map((_, i) => i)), [chosen, elements]);
  const touched = useMemo(
    () => (tool?.kind === "carve" ? carveTargets.filter((i) => elements[i] && !isRotated(elements[i]!) && subtractBox(elements[i]!, tool.hole)).length : 0),
    [tool, carveTargets, elements],
  );
  const boxes = useMemo(() => (tool?.kind === "carve" ? [{ ...tool.hole, tone: "danger" as const }] : []), [tool]);

  // ── Poignée : forme, zone à creuser, ou cubes choisis ────────────────────

  const identity = useMemo(() => new Matrix4(), []);
  const gizmo = useMemo(() => {
    if (tool?.kind === "shape") return { parent: identity, position: tool.draft.center };
    if (tool?.kind === "carve") return { parent: identity, position: tool.hole.from.map((v, i) => (v + tool.hole.to[i]!) / 2) as Vec3 };
    if (!editable || !bounds) return null;
    if (transform === "resize") return chosen.length === 1 && primary ? { parent: identity, position: primary.to } : null;
    return { parent: identity, position: bounds.from.map((v, i) => (v + bounds.to[i]!) / 2) as Vec3 };
  }, [tool, editable, bounds, transform, chosen, primary, identity]);

  const dragBase = useRef<{ model?: BlockModel; center?: Vec3; hole?: Aabb } | null>(null);
  const move = (delta: Vec3, done: boolean) => {
    const shifted = (base: Vec3) => base.map((x, i) => round(x + delta[i]!)) as Vec3;
    if (tool?.kind === "shape") {
      const base = dragBase.current?.center ?? tool.draft.center;
      dragBase.current = done ? null : { center: base };
      setTool({ kind: "shape", draft: { ...tool.draft, center: shifted(base) } });
      return;
    }
    if (tool?.kind === "carve") {
      const base = dragBase.current?.hole ?? tool.hole;
      dragBase.current = done ? null : { hole: base };
      setTool({ kind: "carve", hole: { from: shifted(base.from), to: shifted(base.to) } });
      return;
    }
    if (!model) return;
    const base = dragBase.current?.model ?? model;
    dragBase.current = { model: base };
    const next = cloneModel(base);
    for (const index of chosen) {
      const el = next.elements?.[index];
      if (!el) continue;
      if (transform === "resize") {
        el.to = el.to.map((v, i) => Math.max(el.from[i]!, round(v + delta[i]!))) as Vec3;
      } else {
        el.from = shifted(el.from);
        el.to = shifted(el.to);
        if (el.rotation) el.rotation.origin = shifted(el.rotation.origin);
      }
    }
    if (done) {
      if (delta.some((d) => d !== 0)) studio.changeFrom(base, next);
      dragBase.current = null;
      setNotice(null);
    } else {
      studio.preview(next);
    }
  };

  // ── Modifications ─────────────────────────────────────────────────────────

  const edit = (update: (draft: BlockModel) => void) => {
    if (!studio.model) return;
    const draft = cloneModel(studio.model);
    update(draft);
    studio.change(draft);
    setNotice(null);
  };
  const editElement = (update: (element: ModelElement) => void) =>
    primary &&
    edit((draft) => {
      const element = draft.elements?.[chosen[0]!];
      if (element) update(element);
    });

  /** Le modèle reprend la forme de son parent : ses cubes deviennent les siens. */
  const ensureOwn = (draft: BlockModel) => {
    if (!Array.isArray(draft.elements)) draft.elements = cloneModel(resolved?.elements ?? []);
  };

  /** Variable de texture pour un nouveau cube : la première du modèle, sinon une nouvelle. */
  const firstVariable = (draft: BlockModel): string => {
    const merged = { ...(resolved?.textures ?? {}), ...(draft.textures ?? {}) };
    const key = Object.keys(merged).find((k) => k !== "particle");
    if (key) return `#${key}`;
    draft.textures = { ...(draft.textures ?? {}), "0": `${modId}:${folder}/${stem}`, particle: "#0" };
    const file = textureFile(`${modId}:${folder}/${stem}`, modId);
    if (file && !textures.has(file)) studio.putTexture(file, solidPixels(16, 16, studio.color), false);
    return "#0";
  };

  /** Nom de texture libre (`ruby_lamp_cylindre`, `ruby_lamp_cylindre_2`…). */
  const freeTextureName = (base: string): string => {
    const taken = new Set<string>([
      ...modTextures.map((t) => textureReference(t.relative, modId)).filter((r): r is string => Boolean(r)),
      ...Object.values(model?.textures ?? {}),
      ...[...textures.keys()].map((file) => textureReference(file, modId)).filter((r): r is string => Boolean(r)),
    ]);
    const name = safeId(base);
    let candidate = name;
    for (let n = 2; taken.has(`${modId}:${folder}/${candidate}`); n += 1) candidate = `${name}_${n}`;
    return candidate;
  };

  /** Texture choisie → variable du modèle (et pixels de la nouvelle texture). `null` : annulé. */
  const prepare = async (source: TextureSource, label: string, base: string): Promise<Prepared | null> => {
    if (source.kind === "same") return { kind: "same" };
    if (source.kind === "existing") return { kind: "reference", reference: source.reference, file: null, pixels: null };
    const name = freeTextureName(base);
    const reference = `${modId}:${folder}/${name}`;
    const file = textureFile(reference, modId);
    if (source.kind === "color") return { kind: "reference", reference, file, pixels: solidPixels(source.size, source.size, studio.color) };
    const pixels = await atelier.pick(name, label);
    return pixels ? { kind: "reference", reference, file, pixels } : null;
  };

  const textureFor = (draft: BlockModel, prepared: Prepared, source: ModelElement | undefined): ((face: FaceName) => string) => {
    if (prepared.kind === "reference") {
      const variable = ensureVariable(draft, prepared.reference);
      return () => variable;
    }
    const fallback = (source && FACES.map((f) => source.faces[f]?.texture).find(Boolean)) ?? firstVariable(draft);
    return (face) => source?.faces[face]?.texture ?? fallback;
  };

  const putPrepared = (prepared: Prepared) => {
    if (prepared.kind === "reference" && prepared.pixels && prepared.file) studio.putTexture(prepared.file, prepared.pixels, false);
  };

  const openShape = (kind: ShapeKind) => {
    const params = defaultParams(kind);
    const draft: ShapeDraft = { params, center: [8, 8, 8], source: primary ? { kind: "same" } : { kind: "color", size: 16 } };
    const height = kind === "cube" ? params.size[1] : kind === "sphere" ? params.size[0] : params.size[1];
    draft.center = bounds
      ? [snap((bounds.from[0] + bounds.to[0]) / 2), round(bounds.to[1] + height / 2), snap((bounds.from[2] + bounds.to[2]) / 2)]
      : [8, round(height / 2), 8];
    setTool({ kind: "shape", draft });
    studio.setMode("select");
  };

  const createShape = async () => {
    if (tool?.kind !== "shape") return;
    const shape = tool.draft;
    const name = SHAPE_NAME[shape.params.kind];
    setBusy(true);
    let prepared: Prepared | null = null;
    try {
      prepared = await prepare(shape.source, SHAPE_LABEL[shape.params.kind], `${stem}_${name}`);
    } catch (e) {
      studio.setError(errorText(e));
    } finally {
      setBusy(false);
    }
    if (!prepared) return;
    const placed = placedBoxes(shape);
    const into = chosen.length > 0 && model ? parentOf(outline(model), chosen[0]!) : null;
    edit((draft) => {
      ensureOwn(draft);
      const faceTexture = textureFor(draft, prepared, primary);
      const start = draft.elements!.length;
      const base = freeGroupName(draft, name);
      placed.forEach((box, i) => draft.elements!.push(boxElement(box, placed.length === 1 ? base : `${base}_${i + 1}`, faceTexture)));
      const indices = range(start, start + placed.length);
      const group = placeElements(draft, indices, placed.length > 1 ? { group: { name: base, origin: shape.center }, into } : { into });
      setSelection({ indices, face: null, group });
    });
    putPrepared(prepared);
    setTool(null);
  };

  const openCarve = () => {
    const area = bounds ?? boundsOf(elements);
    if (!area) return;
    // Un trou ouvert sur le dessus, au milieu, sur la moitié de la hauteur.
    const center = area.from.map((v, i) => (v + area.to[i]!) / 2);
    const half = area.from.map((v, i) => Math.max(0.5, snap((area.to[i]! - v) / 4)));
    const top = area.to[1];
    const depth = Math.max(0.5, snap((top - area.from[1]) / 2));
    setTool({
      kind: "carve",
      hole: {
        from: [snap(center[0]! - half[0]!), round(top - depth), snap(center[2]! - half[2]!)],
        to: [snap(center[0]! + half[0]!), top, snap(center[2]! + half[2]!)],
      },
    });
    studio.setMode("select");
  };

  const carve = () => {
    if (tool?.kind !== "carve") return;
    const hole = tool.hole;
    let skipped = 0;
    let cut = 0;
    let pieces = 0;
    edit((draft) => {
      ensureOwn(draft);
      const replacements = new Map<number, ModelElement[]>();
      for (const index of carveTargets) {
        const element = draft.elements![index];
        if (!element) continue;
        if (isRotated(element)) {
          if (subtractBox(element, hole)) skipped += 1;
          continue;
        }
        const result = carveElement(element, hole);
        if (!result) continue;
        replacements.set(index, result);
        cut += 1;
        pieces += result.length;
      }
      const mapping = replaceElements(draft, replacements);
      setSelection({ indices: chosen.flatMap((i) => mapping.get(i) ?? []), face: null, group: null });
    });
    setTool(null);
    setNotice(`${cut} cube${cut > 1 ? "s" : ""} creusé${cut > 1 ? "s" : ""} · ${pieces} morceau${pieces > 1 ? "x" : ""}`);
    if (skipped > 0) studio.setError(`${skipped} cube${skipped > 1 ? "s" : ""} tourné${skipped > 1 ? "s" : ""} laissé${skipped > 1 ? "s" : ""} tel${skipped > 1 ? "s" : ""} : remettez l'angle à 0° pour le creuser.`);
  };

  const applyTexture = async () => {
    if (tool?.kind !== "texture" || chosen.length === 0) return;
    setBusy(true);
    let prepared: Prepared | null = null;
    try {
      prepared = await prepare(tool.source, primary?.name ?? "Texture", `${stem}_${primary?.name ?? "texture"}`);
    } catch (e) {
      studio.setError(errorText(e));
    } finally {
      setBusy(false);
    }
    if (!prepared || prepared.kind !== "reference") return;
    const onlyFace = chosen.length === 1 ? selection.face : null;
    edit((draft) => {
      const variable = ensureVariable(draft, prepared.reference);
      for (const index of chosen) {
        const el = draft.elements?.[index];
        if (!el) continue;
        for (const face of onlyFace ? [onlyFace] : FACES) {
          const data = el.faces[face];
          if (!data) continue;
          data.texture = variable;
          // Nouvelle texture : les UV suivent de nouveau la position du cube.
          delete data.uv;
        }
      }
    });
    putPrepared(prepared);
    setTool(null);
  };

  const duplicate = () =>
    chosen.length > 0 &&
    edit((draft) => {
      const copies = chosen.map((i) => cloneModel(draft.elements![i]!)).map((c) => ({ ...c, name: `${c.name ?? "cube"}_copie` }));
      const start = draft.elements!.length;
      draft.elements!.push(...copies);
      const indices = range(start, start + copies.length);
      placeElements(draft, indices, { into: parentOf(outline(draft), chosen[0]!) });
      setSelection({ indices, face: null, group: null });
    });

  const remove = () =>
    chosen.length > 0 &&
    edit((draft) => {
      removeElements(draft, chosen);
      setSelection(NONE);
    });

  const group = () =>
    chosen.length > 0 &&
    edit((draft) => {
      const area = boundsOf(chosen.map((i) => draft.elements![i]!));
      const origin = area ? (area.from.map((v, i) => snap((v + area.to[i]!) / 2)) as Vec3) : ([8, 8, 8] as Vec3);
      const path = placeElements(draft, chosen, { group: { name: freeGroupName(draft, "groupe"), origin } });
      setSelection({ indices: chosen, face: null, group: path });
    });

  /** La forme du parent devient celle du modèle, modifiable. */
  const takeShape = () =>
    edit((draft) => {
      draft.elements = cloneModel(resolved?.elements ?? []);
    });

  /** Objet à plat → cubes d'un pixel d'épaisseur, en relief comme dans le jeu. */
  const toCubes = () => {
    if (!resolved) return;
    const layers = Object.keys(resolved.textures)
      .filter((key) => /^layer\d+$/.test(key))
      .sort();
    const built: ModelElement[] = [];
    layers.forEach((key, layer) => {
      const file = fileOf(`#${key}`);
      const pixels = file ? textures.get(file) : undefined;
      if (!pixels) return;
      for (const element of spriteElements(pixels, `#${key}`)) {
        element.from = [element.from[0], element.from[1], round(element.from[2] - layer * 0.01)];
        element.to = [element.to[0], element.to[1], round(element.to[2] + layer * 0.01)];
        for (const face of Object.values(element.faces)) if (face) face.tintindex = layer;
        built.push(element);
      }
    });
    if (built.length === 0) {
      studio.setError("La texture de l'objet est vide ou introuvable : dessinez-la d'abord.");
      return;
    }
    const handheld = resolved.chain.some((parent) => parent.endsWith("item/handheld"));
    edit((draft) => {
      delete draft.parent;
      draft.textures = { ...resolved.textures, particle: resolved.textures.particle ?? "#layer0" };
      draft.elements = built;
      draft.gui_light = "front";
      draft.display = itemDisplay(handheld);
      placeElements(draft, range(0, built.length), { group: { name: "relief", origin: [8, 8, 8] } });
      setSelection(NONE);
    });
    setNotice(`${built.length} cubes`);
  };

  const newTexture = () => {
    const name = freeTextureName(stem);
    const reference = `${modId}:${folder}/${name}`;
    const file = textureFile(reference, modId);
    edit((draft) => void ensureVariable(draft, reference));
    if (file && !textures.has(file)) studio.putTexture(file, solidPixels(16, 16, studio.color));
  };

  const save = async () => {
    if (!model) return;
    setSaving(true);
    studio.setError(null);
    try {
      await studio.saveTextures();
      await mcstudioApi.saveModel(project.id, info.id, JSON.stringify(model, null, 2));
      studio.setModelDirty(false);
      setNotice("Enregistré");
      onSaved();
    } catch (e) {
      studio.setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const pick = (index: number | null, face: FaceName | null, additive: boolean) => {
    if (index === null) {
      if (!additive) setSelection(NONE);
      return;
    }
    if (!additive) return setSelection({ indices: [index], face, group: null });
    setSelection((current) => {
      const has = current.indices.includes(index);
      const indices = has ? current.indices.filter((i) => i !== index) : [index, ...current.indices];
      return { indices, face: null, group: null };
    });
  };

  // Raccourcis façon Blockbench : V déplacer, S redimensionner, Suppr, Ctrl+D, Ctrl+G, Ctrl+A, Échap.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest("[data-studio]") || target.closest("input, textarea, [role=dialog]")) return;
      const ctrl = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (event.key === "Escape") {
        if (tool) setTool(null);
        else setSelection(NONE);
      } else if (event.key === "Delete" && editable) remove();
      else if (ctrl && key === "d" && editable) {
        event.preventDefault();
        duplicate();
      } else if (ctrl && key === "g" && editable) {
        event.preventDefault();
        group();
      } else if (ctrl && key === "a" && editable) {
        event.preventDefault();
        setSelection({ indices: elements.map((_, i) => i), face: null, group: null });
      } else if (ctrl && key === "s") {
        event.preventDefault();
        void save();
      } else if (!ctrl && key === "v") {
        setTransform("move");
        studio.setMode("select");
      } else if (!ctrl && key === "s") {
        setTransform("resize");
        studio.setMode("select");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const dirtyNow = studio.modelDirty || studio.dirtyTextures.size > 0;
  useEffect(() => onDirty(dirtyNow), [dirtyNow, onDirty]);

  if (!model || !resolved) {
    return (
      <div className="flex flex-1 items-center justify-center">
        {studio.error ? <p className="text-footnote text-danger">{studio.error}</p> : <p className="text-footnote text-text-subtle">Lecture du modèle…</p>}
      </div>
    );
  }

  const face = chosen.length === 1 ? selection.face : null;
  const faceData = primary && face ? primary.faces[face] : undefined;
  const variables = Object.keys(resolved.textures).filter((k) => k !== "particle");
  const dirty = studio.modelDirty || studio.dirtyTextures.size > 0;
  const canPaint = usedFiles.some((file) => textures.has(file));
  const ownVariables = Object.entries(model.textures ?? {});
  const canShape = !resolved.generated;
  const selectedGroup = selection.group && editable ? groupAt(nodes, selection.group) : null;
  // Le jeu refuse un modèle dont un cube sort de -16 à 32.
  const outside = elements.filter((el) => [...el.from, ...el.to].some((v) => v < -16 || v > 32)).length;

  const rowClass = (active: boolean) =>
    cn(
      "flex h-7 w-full items-center gap-1.5 rounded-sm pr-1.5 text-left text-footnote transition-colors",
      active ? "bg-accent-soft text-text" : "text-text-muted hover:bg-surface-2 hover:text-text",
      focusRing,
    );
  const renderNodes = (list: OutlinerNode[], depth: number, prefix: string) =>
    list.map((node, position) => {
      if (typeof node === "number") {
        const el = elements[node];
        if (!el) return null;
        return (
          <li key={`e${node}`}>
            <button
              type="button"
              aria-current={chosen.includes(node) ? "true" : undefined}
              onClick={(event: MouseEvent) => pick(node, null, event.shiftKey || event.ctrlKey || event.metaKey)}
              className={rowClass(chosen.includes(node))}
              style={{ paddingLeft: 6 + depth * 12 }}
            >
              <Box size={13} aria-hidden className="shrink-0 text-text-subtle" />
              <span className="truncate">{el.name ?? `Cube ${node + 1}`}</span>
              <span className="ml-auto text-caption tabular-nums text-text-subtle">
                {el.to.map((v, i) => Math.round((v - el.from[i]!) * 100) / 100).join("×")}
              </span>
            </button>
          </li>
        );
      }
      const path = prefix ? `${prefix}/${position}` : String(position);
      const members = indicesOf(node);
      return (
        <li key={`g${path}`}>
          <button
            type="button"
            aria-current={selection.group === path ? "true" : undefined}
            onClick={() => setSelection({ indices: members, face: null, group: path })}
            className={rowClass(selection.group === path)}
            style={{ paddingLeft: 6 + depth * 12 }}
          >
            <Folder size={13} aria-hidden className="shrink-0 text-text-subtle" />
            <span className="truncate font-medium">{node.name}</span>
            <span className="ml-auto text-caption tabular-nums text-text-subtle">{members.length}</span>
          </button>
          {node.children.length > 0 && <ul className="space-y-px">{renderNodes(node.children, depth + 1, path)}</ul>}
        </li>
      );
    });

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-studio tabIndex={-1}>
      <StudioHeader
        title={info.label}
        subtitle={
          <>
            {info.kind === "item" ? "Objet" : "Bloc"}
            {resolved.generated ? " à plat" : ` · ${elements.length} cube${elements.length > 1 ? "s" : ""}`}
            {model.parent && <span className="font-mono"> · parent {model.parent}</span>}
            <span className="font-mono"> · {info.relative.split("/models/").at(-1)}</span>
          </>
        }
        dirty={dirty}
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
          >
            <span role="group" aria-label="Poignée" className="flex items-center">
              <IconButton label="Déplacer (V)" pressed={studio.mode === "select" && transform === "move"} onClick={() => (setTransform("move"), studio.setMode("select"))}>
                <Move3d size={15} strokeWidth={1.75} />
              </IconButton>
              <IconButton
                label="Redimensionner (S) : la poignée tire le coin opposé"
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
                    label={canShape ? `Ajouter : ${SHAPE_LABEL[kind].toLowerCase()}` : "Passez d'abord l'objet en 3D"}
                    pressed={tool?.kind === "shape" && tool.draft.params.kind === kind}
                    disabled={!canShape}
                    onClick={() => openShape(kind)}
                  >
                    <Icon size={15} strokeWidth={1.75} />
                  </IconButton>
                );
              })}
              <IconButton
                label={chosen.length > 0 ? "Creuser les cubes choisis" : "Creuser le modèle"}
                pressed={tool?.kind === "carve"}
                disabled={!editable || elements.length === 0}
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
              selected={chosen.map((i) => `e${i}`)}
              mode={studio.mode}
              frameKey={info.id}
              floor="block"
              onPick={(owner, pickedFace, additive) => {
                const match = owner?.match(/^e(\d+)$/);
                pick(match ? Number(match[1]) : null, pickedFace, additive);
              }}
              onPaint={studio.paint}
              gizmo={gizmo}
              onMove={move}
              preview={preview}
              boxes={boxes}
            />
            {!editable && !tool && (
              <div className="absolute left-3 right-3 top-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-1/95 px-3 py-2">
                <p className="min-w-0 flex-1 text-footnote text-text-muted">
                  {resolved.generated
                    ? "Objet à plat : sa forme vient de sa texture. Peignez-le, ou passez-le en 3D pour lui ajouter des cubes."
                    : resolved.unknownParent && elements.length === 0
                      ? `Forme du jeu que l'atelier ne reproduit pas (${resolved.unknownParent}).`
                      : `Forme reprise du parent (${resolved.chain[0] ?? "?"}).`}
                </p>
                {resolved.generated ? (
                  <Button type="button" size="sm" onClick={toCubes} icon={<Layers size={14} />} disabled={!canPaint}>
                    Passer en 3D
                  </Button>
                ) : (
                  <Button type="button" size="sm" onClick={elements.length > 0 ? takeShape : () => openShape("cube")} icon={<Shapes size={14} />}>
                    {elements.length > 0 ? "Modifier la forme" : "Dessiner une forme"}
                  </Button>
                )}
              </div>
            )}
            <p className="pointer-events-none absolute bottom-2 left-3 text-caption text-text-subtle">
              {studio.mode === "paint"
                ? "Glisser : peindre · clic droit : tourner · molette : zoom"
                : tool?.kind === "shape"
                  ? "La poignée place la forme · Créer pour l'ajouter"
                  : tool?.kind === "carve"
                    ? "La poignée déplace la zone à creuser"
                    : "Clic : choisir · Maj ou Ctrl + clic : plusieurs · glisser : tourner · clic droit : déplacer la vue"}
            </p>
            {outside > 0 && editable && (
              <p role="status" className="absolute right-3 top-3 max-w-[60%] rounded-md border border-warning/40 bg-warning-soft px-3 py-1.5 text-footnote">
                {outside} cube{outside > 1 ? "s" : ""} hors des limites du jeu (de -16 à 32) : le modèle ne se chargerait pas.
              </p>
            )}
            {studio.error && (
              <p role="alert" className="absolute bottom-8 left-3 right-3 rounded-md bg-danger-soft px-3 py-2 text-footnote">
                {studio.error}
              </p>
            )}
          </div>
        </div>

        <aside aria-label="Structure et réglages du modèle" className="w-[300px] shrink-0 overflow-y-auto border-l border-border">
          {tool?.kind === "shape" && (
            <ShapePanel
              value={tool.draft}
              onChange={(draft) => setTool({ kind: "shape", draft })}
              onCreate={() => void createShape()}
              onCancel={() => setTool(null)}
              busy={busy}
              same={primary ? `« ${primary.name ?? "cube"} »` : null}
              textures={modTextures}
              modId={modId}
              color={studio.color}
              centerLabel="Centre (0 à 16 = un bloc)"
            />
          )}
          {tool?.kind === "carve" && (
            <CarvePanel
              hole={tool.hole}
              onChange={(hole) => setTool({ kind: "carve", hole })}
              onApply={carve}
              onCancel={() => setTool(null)}
              touched={touched}
              scope={chosen.length > 0 ? `${chosen.length} cube${chosen.length > 1 ? "s" : ""} choisi${chosen.length > 1 ? "s" : ""}` : "tout le modèle"}
            />
          )}
          {tool?.kind === "texture" && (
            <PanelSection title={face ? `Texture · face ${FACE_LABEL[face].toLowerCase()}` : `Texture · ${chosen.length} cube${chosen.length > 1 ? "s" : ""}`}>
              <TextureChoice value={tool.source} onChange={(source) => setTool({ kind: "texture", source })} same={null} textures={modTextures} modId={modId} color={studio.color} />
              <div className="flex justify-end gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => setTool(null)}>
                  Annuler
                </Button>
                <Button type="button" size="sm" variant="primary" disabled={busy || chosen.length === 0} onClick={() => void applyTexture()}>
                  Appliquer
                </Button>
              </div>
            </PanelSection>
          )}

          {!resolved.generated && (
            <PanelSection
              title="Cubes"
              actions={
                editable && (
                  <>
                    <IconButton label="Grouper la sélection (Ctrl+G)" disabled={chosen.length === 0} onClick={group}>
                      <Group size={14} />
                    </IconButton>
                    <IconButton label="Dupliquer (Ctrl+D)" disabled={chosen.length === 0} onClick={duplicate}>
                      <Copy size={14} />
                    </IconButton>
                    <IconButton label="Supprimer (Suppr)" disabled={chosen.length === 0} danger onClick={remove}>
                      <Trash2 size={14} />
                    </IconButton>
                  </>
                )
              }
            >
              <ul aria-label="Cubes du modèle" className="space-y-px">
                {renderNodes(nodes, 0, "")}
              </ul>
              {elements.length === 0 && <p className="text-caption text-text-subtle">Aucun cube : ajoutez une forme avec la barre d'outils.</p>}
            </PanelSection>
          )}

          {selectedGroup && selection.group && (
            <PanelSection title="Groupe">
              <input
                aria-label="Nom du groupe"
                value={groupName ?? selectedGroup.name}
                onChange={(event) => setGroupName(event.target.value)}
                onBlur={() => {
                  const name = groupName?.trim();
                  if (name && name !== selectedGroup.name && selection.group) edit((draft) => renameGroup(draft, selection.group!, name));
                  setGroupName(null);
                }}
                onKeyDown={(event) => event.key === "Enter" && (event.target as HTMLInputElement).blur()}
                className={cn(inputClass, "h-7 text-caption")}
              />
              <p className="text-caption text-text-subtle">{chosen.length} cubes · la poignée les déplace ensemble.</p>
              <div className="flex flex-wrap gap-1.5">
                <Button type="button" size="sm" variant="ghost" icon={<Ungroup size={13} />} onClick={() => {
                    edit((draft) => ungroup(draft, selection.group!));
                    setSelection({ ...selection, group: null });
                  }}
                >
                  Dégrouper
                </Button>
                <Button type="button" size="sm" variant="ghost" icon={<Palette size={13} />} onClick={() => setTool({ kind: "texture", source: { kind: "color", size: 16 } })}>
                  Texture…
                </Button>
              </div>
            </PanelSection>
          )}

          {chosen.length > 1 && !selectedGroup && editable && bounds && (
            <PanelSection title={`${chosen.length} cubes choisis`}>
              <Vec3Input
                label="Position de l'ensemble (coin)"
                value={bounds.from}
                step={0.5}
                onChange={(from) =>
                  edit((draft) => {
                    const delta = from.map((v, i) => v - bounds.from[i]!);
                    for (const index of chosen) {
                      const el = draft.elements?.[index];
                      if (!el) continue;
                      el.from = el.from.map((v, i) => round(v + delta[i]!)) as Vec3;
                      el.to = el.to.map((v, i) => round(v + delta[i]!)) as Vec3;
                      if (el.rotation) el.rotation.origin = el.rotation.origin.map((v, i) => round(v + delta[i]!)) as Vec3;
                    }
                  })
                }
              />
              <div className="flex flex-wrap gap-1.5">
                <Button type="button" size="sm" variant="ghost" icon={<Group size={13} />} onClick={group}>
                  Grouper
                </Button>
                <Button type="button" size="sm" variant="ghost" icon={<Palette size={13} />} onClick={() => setTool({ kind: "texture", source: { kind: "color", size: 16 } })}>
                  Texture…
                </Button>
              </div>
            </PanelSection>
          )}

          {primary && chosen.length === 1 && editable && (
            <PanelSection
              title="Cube"
              actions={
                <IconButton label="Changer la texture du cube (ou de la face choisie)" onClick={() => setTool({ kind: "texture", source: { kind: "color", size: 16 } })}>
                  <Palette size={14} />
                </IconButton>
              }
            >
              <input
                aria-label="Nom du cube"
                value={primary.name ?? ""}
                placeholder={`Cube ${chosen[0]! + 1}`}
                onChange={(event) => editElement((el) => void (el.name = event.target.value || undefined))}
                className={cn(inputClass, "h-7 text-caption")}
              />
              <Vec3Input
                label="Position (coin, 0 à 16 = un bloc)"
                value={primary.from}
                step={0.5}
                onChange={(from) =>
                  editElement((el) => {
                    const size = el.to.map((v, i) => v - el.from[i]!);
                    el.from = from;
                    el.to = from.map((v, i) => v + size[i]!) as Vec3;
                  })
                }
              />
              <Vec3Input
                label="Taille"
                value={primary.to.map((v, i) => round(v - primary.from[i]!)) as Vec3}
                step={0.5}
                min={0}
                onChange={(size) => editElement((el) => void (el.to = el.from.map((v, i) => v + size[i]!) as Vec3))}
              />
              <div className="space-y-1">
                <p className="text-caption text-text-subtle">Rotation</p>
                <div className="flex items-center gap-2">
                  <Segmented
                    label="Axe de rotation"
                    value={primary.rotation?.axis ?? "y"}
                    options={[
                      { value: "x", label: "X" },
                      { value: "y", label: "Y" },
                      { value: "z", label: "Z" },
                    ]}
                    onChange={(axis) =>
                      editElement((el) => {
                        const center = el.from.map((v, i) => (v + el.to[i]!) / 2) as Vec3;
                        el.rotation = { origin: el.rotation?.origin ?? center, angle: el.rotation?.angle ?? 0, axis };
                      })
                    }
                  />
                  <Select
                    label="Angle"
                    value={String(primary.rotation?.angle ?? 0)}
                    options={ROTATION_ANGLES.map((a) => ({ value: String(a), label: `${a}°` }))}
                    onChange={(value) =>
                      editElement((el) => {
                        const angle = Number(value);
                        const center = el.from.map((v, i) => (v + el.to[i]!) / 2) as Vec3;
                        if (angle === 0) delete el.rotation;
                        else el.rotation = { origin: el.rotation?.origin ?? center, axis: el.rotation?.axis ?? "y", angle, rescale: el.rotation?.rescale };
                      })
                    }
                    className="w-24"
                  />
                </div>
                {primary.rotation && (
                  <>
                    <Vec3Input
                      label="Centre de rotation"
                      value={primary.rotation.origin}
                      step={0.5}
                      onChange={(origin) => editElement((el) => void (el.rotation = { ...el.rotation!, origin }))}
                    />
                    <div className="-ml-2">
                      <Switch
                        checked={Boolean(primary.rotation.rescale)}
                        onChange={(rescale) => editElement((el) => void (el.rotation = { ...el.rotation!, rescale: rescale || undefined }))}
                      >
                        Agrandir pour garder la taille
                      </Switch>
                    </div>
                  </>
                )}
              </div>
              <div className="-ml-2">
                <Switch checked={primary.shade !== false} onChange={(value) => editElement((el) => void (value ? delete el.shade : (el.shade = false)))}>
                  Ombrage du jeu
                </Switch>
              </div>
            </PanelSection>
          )}

          {primary && chosen.length === 1 && editable && (
            <PanelSection title="Faces">
              <div role="tablist" aria-label="Face" className="flex gap-0.5">
                {FACES.map((name) => (
                  <button
                    key={name}
                    type="button"
                    role="tab"
                    aria-selected={face === name}
                    title={FACE_LABEL[name]}
                    onClick={() => setSelection({ indices: chosen, face: name, group: selection.group })}
                    className={cn(
                      "flex h-7 flex-1 items-center justify-center rounded-sm text-caption transition-colors",
                      face === name ? "bg-surface-3 text-text" : primary.faces[name] ? "text-text-muted hover:bg-surface-2" : "text-text-subtle/50 hover:bg-surface-2",
                      focusRing,
                    )}
                  >
                    {FACE_SHORT[name]}
                  </button>
                ))}
              </div>
              {face ? (
                <div className="space-y-2">
                  <div className="-ml-2">
                    <Switch
                      checked={Boolean(faceData)}
                      onChange={(on) =>
                        editElement((el) => {
                          if (on) el.faces[face] = { texture: `#${variables[0] ?? "0"}` };
                          else delete el.faces[face];
                        })
                      }
                    >
                      Face {FACE_LABEL[face].toLowerCase()} visible
                    </Switch>
                  </div>
                  {faceData && (
                    <>
                      <Select
                        label="Texture"
                        value={faceData.texture}
                        options={variables.map((key) => ({ value: `#${key}`, label: `#${key} · ${resolveTexture(`#${key}`, resolved.textures) ?? "?"}` }))}
                        onChange={(texture) => editElement((el) => void (el.faces[face]!.texture = texture))}
                      />
                      <div className="-ml-2">
                        <Switch
                          checked={!faceData.uv}
                          onChange={(auto) =>
                            editElement((el) => {
                              if (auto) delete el.faces[face]!.uv;
                              else el.faces[face]!.uv = defaultUv(el, face);
                            })
                          }
                        >
                          UV automatiques (selon la position)
                        </Switch>
                      </div>
                      {faceData.uv && (
                        <div className="grid grid-cols-4 gap-1">
                          {(["U1", "V1", "U2", "V2"] as const).map((labelText, i) => (
                            <label key={labelText} className="space-y-0.5">
                              <span className="text-caption text-text-subtle">{labelText}</span>
                              <NumberInput
                                label={`UV ${labelText}`}
                                value={faceData.uv![i]!}
                                step={0.5}
                                min={0}
                                max={16}
                                onChange={(value) =>
                                  editElement((el) => {
                                    const uv = [...el.faces[face]!.uv!] as Uv;
                                    uv[i] = value;
                                    el.faces[face]!.uv = uv;
                                  })
                                }
                              />
                            </label>
                          ))}
                        </div>
                      )}
                      <Select
                        label="Rotation de la texture"
                        value={String(faceData.rotation ?? 0)}
                        options={[0, 90, 180, 270].map((r) => ({ value: String(r), label: `${r}°` }))}
                        onChange={(value) =>
                          editElement((el) => {
                            const rotation = Number(value) as 0 | 90 | 180 | 270;
                            if (rotation === 0) delete el.faces[face]!.rotation;
                            else el.faces[face]!.rotation = rotation;
                          })
                        }
                      />
                    </>
                  )}
                </div>
              ) : (
                <p className="text-caption text-text-subtle">Choisissez une face (ou cliquez-la sur le modèle).</p>
              )}
            </PanelSection>
          )}

          <PanelSection
            title="Textures"
            actions={
              (editable || info.kind === "block") && !resolved.generated ? (
                <IconButton label="Nouvelle texture pour ce modèle" onClick={newTexture}>
                  <ImagePlus size={14} />
                </IconButton>
              ) : undefined
            }
          >
            {ownVariables.length > 0 ? (
              <ul className="space-y-1">
                {ownVariables.map(([key, value]) => {
                  const file = fileOf(`#${key}`);
                  const missing = file && studio.missing.has(file);
                  return (
                    <li key={key} className="flex items-center gap-2 text-caption">
                      <span className="w-14 shrink-0 font-mono text-text-muted">#{key}</span>
                      <span className={cn("min-w-0 flex-1 truncate font-mono", missing ? "text-warning" : "text-text-subtle")} title={value}>
                        {value}
                      </span>
                      {missing && file && (
                        <button
                          type="button"
                          onClick={() => studio.putTexture(file, blankPixels(16, 16))}
                          className={cn("shrink-0 rounded-xs text-accent hover:underline", focusRing)}
                        >
                          Créer
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-caption text-text-subtle">Textures héritées du parent.</p>
            )}
            {usedFiles.length > 1 && (
              <Select
                label="Texture affichée"
                value={shownTexture ?? ""}
                options={usedFiles.map((file) => ({ value: file, label: file.split("/textures/").at(-1) ?? file }))}
                onChange={setUvTexture}
              />
            )}
            {shownTexture && shownPixels && (
              <UvView
                pixels={shownPixels}
                texture={shownTexture}
                version={studio.textureVersion}
                rects={rects}
                selected={chosen.length > 0 ? `e${chosen[0]}` : null}
                mode={studio.mode}
                onPaint={studio.paint}
                onPick={(owner, pickedFace) => {
                  const match = owner.match(/^e(\d+)$/);
                  if (match) pick(Number(match[1]), pickedFace, false);
                }}
                size={272}
              />
            )}
            {usedFiles.length === 0 && (
              <p className="text-caption text-text-subtle">Textures du jeu ou absentes : affichées en damier, sans peinture possible.</p>
            )}
          </PanelSection>
        </aside>
      </div>
      {atelier.overlay}
    </div>
  );
}
