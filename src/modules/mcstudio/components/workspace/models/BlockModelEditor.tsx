import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Matrix4 } from "three";
import { Box, Copy, ImagePlus, Plus, Shapes, Trash2 } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Button, Select } from "@/design-system/primitives";
import type { ModelInfo } from "@/core/ipc/bindings/ModelInfo";
import type { ProjectSummary } from "@/core/ipc/bindings/ProjectSummary";
import { errorText, mcstudioApi } from "../../../api";
import { defaultUv, elementFaceRect, elementParts, spriteParts, type Part } from "../../../lib/models/geometry";
import { resolveModel, resolveTexture, textureFile, type ResolvedModel } from "../../../lib/models/resolve";
import {
  cloneModel,
  FACE_LABEL,
  FACES,
  ROTATION_ANGLES,
  type BlockModel,
  type FaceName,
  type ModelElement,
  type Uv,
} from "../../../lib/models/types";
import { blankPixels } from "../../../lib/pixels";
import { focusRing, inputClass, Segmented, Switch } from "../../ui";
import { IconButton, NumberInput, PanelSection, StudioHeader, StudioToolbar, Vec3Input } from "./controls";
import { useStudio } from "./useStudio";
import { UvView, type UvRect } from "./UvView";
import { Viewport } from "./Viewport";

type Selection = { index: number; face: FaceName | null } | null;

const FACE_SHORT: Record<FaceName, string> = { north: "N", south: "S", east: "E", west: "O", up: "↑", down: "↓" };

function newElement(texture: string, index: number): ModelElement {
  const faces: ModelElement["faces"] = {};
  for (const face of FACES) faces[face] = { texture };
  return { name: `cube_${index + 1}`, from: [4, 0, 4], to: [12, 8, 12], faces };
}

/**
 * Éditeur des modèles de blocs et d'objets (JSON du jeu) : cubes (position, taille, rotation),
 * faces (texture, UV, rotation), variables de texture, peinture sur le modèle. Un modèle qui
 * reprend la forme de son parent (cube, dalle, objet à plat…) se montre tel quel, et se
 * convertit en cubes modifiables d'un clic.
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
  const [selection, setSelection] = useState<Selection>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [uvTexture, setUvTexture] = useState<string | null>(null);
  const parents = useRef(new Map<string, BlockModel | null>());
  const stem = info.id.split("/").slice(1).join("/");
  const folder = info.kind === "item" ? "item" : "block";

  useEffect(() => {
    let cancelled = false;
    setSelection(null);
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

  const elements = resolved?.elements ?? [];
  const editable = Boolean(resolved?.own) && !resolved?.generated;

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
    return elements.flatMap((element, index) =>
      elementParts(element, index, (variable) => {
        const file = fileOf(variable);
        const pixels = file ? textures.get(file) : undefined;
        return { file: pixels ? file : null, size: pixels };
      }),
    );
  }, [resolved, elements, textures, fileOf]);

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

  // Poignée de déplacement du cube choisi (modèle modifiable seulement).
  const identity = useMemo(() => new Matrix4(), []);
  const gizmo = useMemo(() => {
    const el = selection && editable ? elements[selection.index] : undefined;
    if (!el) return null;
    return { parent: identity, position: el.from.map((v, i) => (v + el.to[i]!) / 2) as [number, number, number] };
  }, [selection, editable, elements, identity]);
  const dragBase = useRef<BlockModel | null>(null);
  const move = (delta: [number, number, number], done: boolean) => {
    if (!model || !selection) return;
    const base = dragBase.current ?? model;
    dragBase.current = base;
    const next = cloneModel(base);
    const el = next.elements?.[selection.index];
    if (el) {
      const shift = (v: [number, number, number]) => v.map((x, i) => Math.round((x + delta[i]!) * 1000) / 1000) as [number, number, number];
      el.from = shift(el.from);
      el.to = shift(el.to);
      if (el.rotation) el.rotation.origin = shift(el.rotation.origin);
    }
    if (done) {
      if (delta.some((d) => d !== 0)) studio.changeFrom(base, next);
      dragBase.current = null;
      setNotice(null);
    } else {
      studio.preview(next);
    }
  };

  const edit = (update: (draft: BlockModel) => void) => {
    if (!studio.model) return;
    const draft = cloneModel(studio.model);
    update(draft);
    studio.change(draft);
    setNotice(null);
  };
  const editElement = (update: (element: ModelElement) => void) =>
    selection &&
    edit((draft) => {
      const element = draft.elements?.[selection.index];
      if (element) update(element);
    });

  /** Variable de texture pour un nouveau cube : la première du modèle, sinon une nouvelle. */
  const firstVariable = (draft: BlockModel): string => {
    const merged = { ...(resolved?.textures ?? {}), ...(draft.textures ?? {}) };
    const key = Object.keys(merged).find((k) => k !== "particle");
    if (key) return `#${key}`;
    draft.textures = { ...(draft.textures ?? {}), "0": `${modId}:${folder}/${stem}`, particle: "#0" };
    const file = textureFile(`${modId}:${folder}/${stem}`, modId);
    if (file && !textures.has(file)) studio.putTexture(file, blankPixels(16, 16), false);
    return "#0";
  };

  const addCube = () =>
    edit((draft) => {
      draft.elements = draft.elements ?? [];
      const texture = firstVariable(draft);
      draft.elements.push(newElement(texture, draft.elements.length));
      setSelection({ index: draft.elements.length - 1, face: null });
    });

  const duplicate = () =>
    selection &&
    edit((draft) => {
      const source = draft.elements?.[selection.index];
      if (!source || !draft.elements) return;
      const copy = cloneModel(source);
      copy.name = `${source.name ?? "cube"}_copie`;
      draft.elements.push(copy);
      setSelection({ index: draft.elements.length - 1, face: null });
    });

  const remove = () =>
    selection &&
    edit((draft) => {
      draft.elements?.splice(selection.index, 1);
      setSelection(null);
    });

  /** La forme du parent devient celle du modèle, modifiable. */
  const takeShape = () =>
    edit((draft) => {
      draft.elements = cloneModel(resolved?.elements ?? []);
    });

  const newTexture = () => {
    const variables = Object.keys(model?.textures ?? {});
    let n = 0;
    while (variables.includes(String(n))) n += 1;
    const reference = `${modId}:${folder}/${stem}${n === 0 ? "" : `_${n}`}`;
    const file = textureFile(reference, modId);
    edit((draft) => {
      draft.textures = { ...(draft.textures ?? {}), [String(n)]: reference };
      if (!draft.textures.particle) draft.textures.particle = `#${n}`;
    });
    if (file && !textures.has(file)) studio.putTexture(file, blankPixels(16, 16));
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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest("[data-studio]") || target.closest("input, textarea")) return;
      const ctrl = event.ctrlKey || event.metaKey;
      if (event.key === "Delete" && editable) remove();
      else if (ctrl && event.key.toLowerCase() === "d" && editable) {
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

  const dirtyNow = studio.modelDirty || studio.dirtyTextures.size > 0;
  useEffect(() => onDirty(dirtyNow), [dirtyNow, onDirty]);

  if (!model || !resolved) {
    return (
      <div className="flex flex-1 items-center justify-center">
        {studio.error ? <p className="text-footnote text-danger">{studio.error}</p> : <p className="text-footnote text-text-subtle">Lecture du modèle…</p>}
      </div>
    );
  }

  const element = selection ? elements[selection.index] : undefined;
  const face = selection?.face ?? null;
  const faceData = element && face ? element.faces[face] : undefined;
  const variables = Object.keys(resolved.textures).filter((k) => k !== "particle");
  const dirty = studio.modelDirty || studio.dirtyTextures.size > 0;
  const canPaint = usedFiles.some((file) => textures.has(file));
  const ownVariables = Object.entries(model.textures ?? {});

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-studio tabIndex={-1}>
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
          />
          <div className="relative min-h-0 flex-1 bg-bg-subtle">
            <Viewport
              parts={parts}
              textures={textures}
              textureVersion={studio.textureVersion}
              selected={selection ? [`e${selection.index}`] : []}
              mode={studio.mode}
              frameKey={info.id}
              floor="block"
              onPick={(owner, pickedFace) => {
                const match = owner?.match(/^e(\d+)$/);
                setSelection(match ? { index: Number(match[1]), face: pickedFace } : null);
              }}
              onPaint={studio.paint}
              gizmo={gizmo}
              onMove={move}
            />
            {!editable && (
              <div className="absolute left-3 right-3 top-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-1/95 px-3 py-2">
                <p className="min-w-0 flex-1 text-footnote text-text-muted">
                  {resolved.generated
                    ? "Objet à plat : sa forme vient de sa texture, en relief. Peignez-le directement."
                    : resolved.unknownParent && elements.length === 0
                      ? `Forme du jeu que l'atelier ne reproduit pas (${resolved.unknownParent}).`
                      : `Forme reprise du parent (${resolved.chain[0] ?? "?"}).`}
                </p>
                {!resolved.generated && (
                  <Button type="button" size="sm" onClick={elements.length > 0 ? takeShape : addCube} icon={<Shapes size={14} />}>
                    {elements.length > 0 ? "Modifier la forme" : "Dessiner une forme"}
                  </Button>
                )}
              </div>
            )}
            <p className="pointer-events-none absolute bottom-2 left-3 text-caption text-text-subtle">
              {studio.mode === "paint"
                ? "Glisser : peindre · clic droit : tourner · molette : zoom"
                : "Clic : choisir un cube, ses flèches le déplacent · glisser : tourner · clic droit : déplacer la vue · molette : zoom"}
            </p>
            {studio.error && (
              <p role="alert" className="absolute bottom-8 left-3 right-3 rounded-md bg-danger-soft px-3 py-2 text-footnote">
                {studio.error}
              </p>
            )}
          </div>
        </div>

        <aside aria-label="Structure et réglages du modèle" className="w-[300px] shrink-0 overflow-y-auto border-l border-border">
          {!resolved.generated && (
            <PanelSection
              title="Cubes"
              actions={
                editable && (
                  <>
                    <IconButton label="Nouveau cube" onClick={addCube}>
                      <Plus size={14} />
                    </IconButton>
                    <IconButton label="Dupliquer (Ctrl+D)" disabled={!selection} onClick={duplicate}>
                      <Copy size={14} />
                    </IconButton>
                    <IconButton label="Supprimer (Suppr)" disabled={!selection} danger onClick={remove}>
                      <Trash2 size={14} />
                    </IconButton>
                  </>
                )
              }
            >
              <ul aria-label="Cubes du modèle" className="space-y-px">
                {elements.map((el, index) => (
                  <li key={index}>
                    <button
                      type="button"
                      aria-current={selection?.index === index ? "true" : undefined}
                      onClick={() => setSelection({ index, face: null })}
                      className={cn(
                        "flex h-7 w-full items-center gap-1.5 rounded-sm px-1.5 text-left text-footnote transition-colors",
                        selection?.index === index ? "bg-accent-soft text-text" : "text-text-muted hover:bg-surface-2 hover:text-text",
                        focusRing,
                      )}
                    >
                      <Box size={13} aria-hidden className="shrink-0 text-text-subtle" />
                      <span className="truncate">{el.name ?? `Cube ${index + 1}`}</span>
                      <span className="ml-auto text-caption tabular-nums text-text-subtle">
                        {el.to.map((v, i) => Math.round((v - el.from[i]!) * 100) / 100).join("×")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {elements.length === 0 && <p className="text-caption text-text-subtle">Aucun cube.</p>}
            </PanelSection>
          )}

          {element && editable && selection && (
            <PanelSection title="Cube">
              <input
                aria-label="Nom du cube"
                value={element.name ?? ""}
                placeholder={`Cube ${selection.index + 1}`}
                onChange={(event) => editElement((el) => void (el.name = event.target.value || undefined))}
                className={cn(inputClass, "h-7 text-caption")}
              />
              <Vec3Input
                label="Position (coin, 0 à 16 = un bloc)"
                value={element.from}
                step={0.5}
                onChange={(from) =>
                  editElement((el) => {
                    const size = el.to.map((v, i) => v - el.from[i]!);
                    el.from = from;
                    el.to = from.map((v, i) => v + size[i]!) as [number, number, number];
                  })
                }
              />
              <Vec3Input
                label="Taille"
                value={element.to.map((v, i) => Math.round((v - element.from[i]!) * 1000) / 1000) as [number, number, number]}
                step={0.5}
                min={0}
                onChange={(size) => editElement((el) => void (el.to = el.from.map((v, i) => v + size[i]!) as [number, number, number]))}
              />
              <div className="space-y-1">
                <p className="text-caption text-text-subtle">Rotation</p>
                <div className="flex items-center gap-2">
                  <Segmented
                    label="Axe de rotation"
                    value={element.rotation?.axis ?? "y"}
                    options={[
                      { value: "x", label: "X" },
                      { value: "y", label: "Y" },
                      { value: "z", label: "Z" },
                    ]}
                    onChange={(axis) =>
                      editElement((el) => {
                        const center = el.from.map((v, i) => (v + el.to[i]!) / 2) as [number, number, number];
                        el.rotation = { origin: el.rotation?.origin ?? center, angle: el.rotation?.angle ?? 0, axis };
                      })
                    }
                  />
                  <Select
                    label="Angle"
                    value={String(element.rotation?.angle ?? 0)}
                    options={ROTATION_ANGLES.map((a) => ({ value: String(a), label: `${a}°` }))}
                    onChange={(value) =>
                      editElement((el) => {
                        const angle = Number(value);
                        const center = el.from.map((v, i) => (v + el.to[i]!) / 2) as [number, number, number];
                        if (angle === 0) delete el.rotation;
                        else el.rotation = { origin: el.rotation?.origin ?? center, axis: el.rotation?.axis ?? "y", angle, rescale: el.rotation?.rescale };
                      })
                    }
                    className="w-24"
                  />
                </div>
                {element.rotation && (
                  <>
                    <Vec3Input
                      label="Centre de rotation"
                      value={element.rotation.origin}
                      step={0.5}
                      onChange={(origin) => editElement((el) => void (el.rotation = { ...el.rotation!, origin }))}
                    />
                    <div className="-ml-2">
                      <Switch
                        checked={Boolean(element.rotation.rescale)}
                        onChange={(rescale) => editElement((el) => void (el.rotation = { ...el.rotation!, rescale: rescale || undefined }))}
                      >
                        Agrandir pour garder la taille
                      </Switch>
                    </div>
                  </>
                )}
              </div>
              <div className="-ml-2">
                <Switch checked={element.shade !== false} onChange={(value) => editElement((el) => void (value ? delete el.shade : (el.shade = false)))}>
                  Ombrage du jeu
                </Switch>
              </div>
            </PanelSection>
          )}

          {element && editable && selection && (
            <PanelSection title="Faces">
              <div role="tablist" aria-label="Face" className="flex gap-0.5">
                {FACES.map((name) => (
                  <button
                    key={name}
                    type="button"
                    role="tab"
                    aria-selected={face === name}
                    title={FACE_LABEL[name]}
                    onClick={() => setSelection({ index: selection.index, face: name })}
                    className={cn(
                      "flex h-7 flex-1 items-center justify-center rounded-sm text-caption transition-colors",
                      face === name ? "bg-surface-3 text-text" : element.faces[name] ? "text-text-muted hover:bg-surface-2" : "text-text-subtle/50 hover:bg-surface-2",
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
                selected={selection ? `e${selection.index}` : null}
                mode={studio.mode}
                onPaint={studio.paint}
                onPick={(owner, pickedFace) => {
                  const match = owner.match(/^e(\d+)$/);
                  if (match) setSelection({ index: Number(match[1]), face: pickedFace });
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
    </div>
  );
}
