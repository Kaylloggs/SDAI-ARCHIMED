import { useCallback, useEffect, useState } from "react";
import { Box, Loader2, PawPrint, Plus, Shield, Sword } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Button } from "@/design-system/primitives";
import type { ModelInfo } from "@/core/ipc/bindings/ModelInfo";
import type { ModelKind } from "@/core/ipc/bindings/ModelKind";
import type { ProjectSummary } from "@/core/ipc/bindings/ProjectSummary";
import { errorText, mcstudioApi } from "../../../api";
import { ENTITY_TEMPLATES, type EntityTemplate } from "../../../lib/models/entity";
import type { BlockModel, ModelElement } from "../../../lib/models/types";
import { registryIdProblem } from "../../../lib/naming";
import { Field, focusRing, inputClass, Segmented } from "../../ui";
import { ArmorEditor } from "./ArmorEditor";
import { BlockModelEditor } from "./BlockModelEditor";
import { EntityEditor } from "./EntityEditor";

type Creatable = "block" | "item" | "entity";

const GROUPS: { kind: ModelKind; title: string; Icon: typeof Box; add?: Creatable; empty: string }[] = [
  { kind: "block", title: "Blocs", Icon: Box, add: "block", empty: "Aucun modèle de bloc." },
  { kind: "item", title: "Objets", Icon: Sword, add: "item", empty: "Aucun modèle d'objet." },
  { kind: "entity", title: "Entités", Icon: PawPrint, add: "entity", empty: "Aucune entité : créez-en une à partir d'un gabarit." },
  { kind: "armor", title: "Armures", Icon: Shield, empty: "Aucune armure : ses couches apparaissent ici dès qu'elles existent dans textures/." },
];

const ADD_LABEL: Record<Creatable, string> = {
  block: "Nouveau modèle de bloc",
  item: "Nouvel objet en 3D",
  entity: "Nouvelle entité",
};

const keyOf = (model: Pick<ModelInfo, "kind" | "id">) => `${model.kind}:${model.id}`;

/** Nouveau modèle de bloc ou d'objet (cubes), ou nouvelle entité à partir d'un gabarit. */
function NewModelForm({
  project,
  kind,
  onCreated,
  onCancel,
}: {
  project: ProjectSummary;
  kind: Creatable;
  onCreated: (key: string) => void;
  onCancel: () => void;
}) {
  const modId = project.meta?.modId ?? "";
  const [id, setId] = useState("");
  const [shape, setShape] = useState<"cube" | "slab" | "empty">("cube");
  const [template, setTemplate] = useState<EntityTemplate>("humanoid");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = id ? registryIdProblem(id) : null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (kind === "entity") {
        await mcstudioApi.saveEntityModel(project.id, ENTITY_TEMPLATES[template].make(id));
        onCreated(`entity:${id}`);
        return;
      }
      const folder = kind === "item" ? "item" : "block";
      const reference = `${modId}:${folder}/${id}`;
      const faces = (uv?: [number, number, number, number]) =>
        Object.fromEntries(
          (["north", "south", "east", "west", "up", "down"] as const).map((face) => [
            face,
            { texture: "#0", ...(uv && face !== "up" && face !== "down" ? { uv } : {}) },
          ]),
        );
      const elements: ModelElement[] =
        shape === "empty"
          ? []
          : [
              shape === "slab"
                ? { name: "dalle", from: [0, 0, 0], to: [16, 8, 16], faces: faces([0, 8, 16, 16]) }
                : { name: "cube", from: [0, 0, 0], to: [16, 16, 16], faces: faces() },
            ];
      // Parent `block/block` : tenu et affiché dans l'inventaire comme un bloc (section `display`).
      const model: BlockModel = { parent: "minecraft:block/block", textures: { "0": reference, particle: "#0" }, elements };
      await mcstudioApi.saveModel(project.id, `${folder}/${id}`, JSON.stringify(model, null, 2), true);
      onCreated(`${kind}:${folder}/${id}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-3 rounded-lg border border-border bg-surface-1 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (id && !problem && !busy) void submit();
      }}
    >
      <Field
        id={`new-${kind}`}
        label={kind === "entity" ? "Nom de l'entité" : "Nom du modèle"}
        hint={
          kind === "entity"
            ? "Minuscules et _ (ex. ruby_golem)."
            : "Le nom d'un bloc ou d'un objet du mod pour lui donner cette forme."
        }
        problem={problem}
      >
        <input
          id={`new-${kind}`}
          autoFocus
          value={id}
          spellCheck={false}
          onChange={(event) => setId(event.target.value.trim())}
          className={cn(inputClass, "font-mono")}
        />
      </Field>
      {kind === "entity" ? (
        <div className="space-y-1.5">
          <Segmented
            label="Gabarit"
            value={template}
            options={(Object.keys(ENTITY_TEMPLATES) as EntityTemplate[]).map((value) => ({ value, label: ENTITY_TEMPLATES[value].label }))}
            onChange={setTemplate}
          />
          <p className="text-caption text-text-subtle">{ENTITY_TEMPLATES[template].hint}</p>
        </div>
      ) : (
        <Segmented
          label="Forme de départ"
          value={shape}
          options={[
            { value: "cube", label: "Cube" },
            { value: "slab", label: "Dalle" },
            { value: "empty", label: "Vide" },
          ]}
          onChange={setShape}
        />
      )}
      {error && <p className="text-footnote text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
        <Button type="submit" size="sm" variant="primary" disabled={!id || Boolean(problem) || busy} icon={busy ? <Loader2 size={14} className="animate-spin" /> : undefined}>
          Créer
        </Button>
      </div>
    </form>
  );
}

/**
 * Onglet Modèles (atelier 3D) : les modèles de blocs et d'objets du mod, ses entités et ses
 * armures, avec l'éditeur du modèle choisi.
 */
export function ModelsPanel({ project }: { project: ProjectSummary }) {
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState<Creatable | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  const load = useCallback(
    (select?: string) =>
      mcstudioApi
        .listModels(project.id)
        .then((list) => {
          setModels(list);
          if (select) setSelected(select);
        })
        .catch((e) => setError(errorText(e))),
    [project.id],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const current = models?.find((m) => keyOf(m) === selected) ?? null;
  const choose = (key: string) => {
    if (key === selected) return;
    if (dirty) setPending(key);
    else setSelected(key);
  };

  return (
    <div className="flex h-full min-h-0">
      <aside aria-label="Modèles du mod" className="w-[256px] shrink-0 space-y-5 overflow-y-auto border-r border-border p-4">
        {error && (
          <p role="alert" className="text-footnote text-danger">
            {error}
          </p>
        )}
        {!models && !error && <Loader2 size={16} className="animate-spin text-text-subtle" aria-label="Chargement" />}
        {models &&
          GROUPS.map(({ kind, title, Icon, add, empty }) => {
            const list = models.filter((m) => m.kind === kind);
            return (
              <section key={kind} className="space-y-1.5">
                <div className="flex items-center justify-between px-2">
                  <h2 className="text-caption font-semibold uppercase tracking-[0.04em] text-text-subtle">
                    {title} <span className="font-normal">· {list.length}</span>
                  </h2>
                  {add && (
                    <button
                      type="button"
                      aria-label={ADD_LABEL[add]}
                      title={ADD_LABEL[add]}
                      onClick={() => setAdding(add)}
                      className={cn(
                        "flex size-6 items-center justify-center rounded-sm text-text-subtle transition-colors hover:bg-surface-2 hover:text-text",
                        focusRing,
                      )}
                    >
                      <Plus size={14} />
                    </button>
                  )}
                </div>
                {adding === add && add && (
                  <NewModelForm
                    project={project}
                    kind={add}
                    onCancel={() => setAdding(null)}
                    onCreated={(key) => {
                      setAdding(null);
                      setDirty(false);
                      void load(key);
                    }}
                  />
                )}
                {list.length === 0 ? (
                  <p className="px-2 text-caption text-text-subtle">{empty}</p>
                ) : (
                  <ul className="space-y-0.5">
                    {list.map((model) => {
                      const key = keyOf(model);
                      return (
                        <li key={key}>
                          <button
                            type="button"
                            aria-current={key === selected ? "true" : undefined}
                            onClick={() => choose(key)}
                            title={model.relative}
                            className={cn(
                              "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors",
                              key === selected ? "bg-accent-soft" : "hover:bg-surface-2",
                              focusRing,
                            )}
                          >
                            <Icon size={15} strokeWidth={1.75} aria-hidden className="shrink-0 text-text-subtle" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-body-sm">{model.label}</span>
                              <span className="block truncate text-caption text-text-subtle">
                                {model.kind === "entity"
                                  ? "Entité"
                                  : model.kind === "armor"
                                    ? model.textures.filter(Boolean).length === 2
                                      ? "Couches 1 et 2"
                                      : "Une couche"
                                    : model.custom
                                      ? "Forme en cubes"
                                      : (model.parent?.replace("minecraft:", "") ?? "Sans parent")}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {pending && (
          <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-border bg-warning-soft px-4 py-2">
            <p className="flex-1 text-footnote">Des modifications ne sont pas enregistrées. Les abandonner ?</p>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPending(null)}>
              Rester
            </Button>
            <Button
              type="button"
              size="sm"
              variant="danger"
              onClick={() => {
                setSelected(pending);
                setPending(null);
                setDirty(false);
              }}
            >
              Abandonner
            </Button>
          </div>
        )}
        {current ? (
          current.kind === "entity" ? (
            <EntityEditor key={selected} project={project} info={current} onDirty={setDirty} onSaved={() => void load()} />
          ) : current.kind === "armor" ? (
            <ArmorEditor key={selected} project={project} info={current} onDirty={setDirty} />
          ) : (
            <BlockModelEditor key={selected} project={project} info={current} onDirty={setDirty} onSaved={() => void load()} />
          )
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <Box size={28} strokeWidth={1.5} className="text-text-subtle" aria-hidden />
            <p className="text-body text-text">Atelier 3D</p>
            <p className="max-w-[46ch] text-footnote text-text-subtle">
              Choisissez un modèle à gauche, ou créez un bloc, un objet en 3D ou une entité avec « + ». Les cubes se
              règlent à droite, la texture se peint directement sur le modèle.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
