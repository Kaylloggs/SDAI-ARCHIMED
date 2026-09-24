import { useCallback, useEffect, useState } from "react";
import { Box, Loader2, Plus, Sword } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Button } from "@/design-system/primitives";
import type { BlockSound } from "@/core/ipc/bindings/BlockSound";
import type { ProjectSummary } from "@/core/ipc/bindings/ProjectSummary";
import type { TextureInfo } from "@/core/ipc/bindings/TextureInfo";
import type { TextureTarget } from "@/core/ipc/bindings/TextureTarget";
import { errorText, mcstudioApi } from "../../api";
import { registryIdProblem, suggestRegistryId } from "../../lib/naming";
import { targetKey } from "../../lib/textures";
import { useMcStudioStore } from "../../store";
import { Field, focusRing, inputClass, Segmented } from "../ui";
import { Checker, PixelImage, TextureStudio } from "./TextureStudio";

/** Dureté et résistance usuelles de chaque matière (valeurs du jeu). */
const MATERIALS: Record<BlockSound, { label: string; hardness: number; resistance: number }> = {
  stone: { label: "Pierre", hardness: 1.5, resistance: 6 },
  metal: { label: "Métal", hardness: 5, resistance: 6 },
  wood: { label: "Bois", hardness: 2, resistance: 3 },
};

type NewKind = "item" | "block";

/** Déclare un objet ou un bloc (code, modèles, traductions, loot table) avant de le dessiner. */
function NewContentForm({
  project,
  kind,
  onCreated,
  onCancel,
}: {
  project: ProjectSummary;
  kind: NewKind;
  onCreated: (target: TextureTarget) => void;
  onCancel: () => void;
}) {
  const [nameFr, setNameFr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [id, setId] = useState("");
  const [idEdited, setIdEdited] = useState(false);
  const [sound, setSound] = useState<BlockSound>("stone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shownId = idEdited ? id : suggestRegistryId(nameEn || nameFr);
  const idProblem = shownId ? registryIdProblem(shownId) : null;
  const ready = nameFr.trim() && shownId && !idProblem && !busy;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const names = { id: shownId, nameFr: nameFr.trim(), nameEn: (nameEn || nameFr).trim() };
      if (kind === "item") {
        await mcstudioApi.addItem(project.id, names);
        onCreated({ kind: "item", id: shownId });
      } else {
        const { hardness, resistance } = MATERIALS[sound];
        await mcstudioApi.addBlock(project.id, { ...names, hardness, resistance, sound });
        onCreated({ kind: "block", id: shownId });
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-3 rounded-md border border-border bg-surface-1 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) void submit();
      }}
    >
      <p className="text-footnote font-semibold">{kind === "item" ? "Nouvel objet" : "Nouveau bloc"}</p>
      <Field id="mc-new-fr" label="Nom en jeu (français)">
        <input id="mc-new-fr" autoFocus value={nameFr} onChange={(e) => setNameFr(e.target.value)} className={inputClass} placeholder={kind === "item" ? "Épée de rubis" : "Minerai de rubis"} />
      </Field>
      <Field id="mc-new-en" label="Nom anglais" hint="Vide : le nom français est repris.">
        <input id="mc-new-en" value={nameEn} onChange={(e) => setNameEn(e.target.value)} className={inputClass} placeholder={kind === "item" ? "Ruby Sword" : "Ruby Ore"} />
      </Field>
      <Field id="mc-new-id" label="Nom de registre" problem={idProblem}>
        <input
          id="mc-new-id"
          value={shownId}
          spellCheck={false}
          onChange={(e) => {
            setId(e.target.value);
            setIdEdited(true);
          }}
          className={cn(inputClass, "font-mono")}
        />
      </Field>
      {kind === "block" && (
        <div className="space-y-1.5">
          <p className="text-footnote font-medium text-text-muted">Matière</p>
          <Segmented
            label="Matière du bloc"
            value={sound}
            onChange={setSound}
            options={(Object.keys(MATERIALS) as BlockSound[]).map((value) => ({ value, label: MATERIALS[value].label }))}
          />
        </div>
      )}
      {error && (
        <p role="alert" className="text-footnote text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={!ready} icon={busy ? <Loader2 size={14} className="animate-spin" /> : undefined}>
          Créer
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
      </div>
      <p className="text-caption text-text-subtle">
        Code, modèle, traductions{kind === "block" ? ", loot table et outil de minage" : ""} sont écrits dans le projet,
        avec une texture provisoire à remplacer ici.
      </p>
    </form>
  );
}

function TextureRow({
  texture,
  selected,
  onSelect,
}: {
  texture: TextureInfo;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
        className={cn(
          "flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors",
          selected ? "bg-accent-soft" : "hover:bg-surface-2",
          focusRing,
        )}
      >
        <Checker size={36}>
          {texture.exists ? (
            <PixelImage path={texture.path} version={texture.modified ?? 0} size={32} />
          ) : (
            <span aria-hidden className="text-caption text-text-subtle">
              ?
            </span>
          )}
        </Checker>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body-sm">{texture.label}</span>
          <span className={cn("block truncate text-caption", texture.exists ? "text-text-subtle" : "text-warning")}>
            {texture.exists ? `${texture.width}×${texture.height}` : "Texture manquante"}
          </span>
        </span>
      </button>
    </li>
  );
}

/** Onglet Textures : l'icône, les objets et les blocs du mod, et l'atelier de la texture choisie. */
export function TexturesPanel({ project }: { project: ProjectSummary }) {
  const [textures, setTextures] = useState<TextureInfo[] | null>(null);
  const [selected, setSelected] = useState<string>("icon");
  const [adding, setAdding] = useState<NewKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (select?: string) =>
      mcstudioApi
        .listTextures(project.id)
        .then((list) => {
          setTextures(list);
          if (select) setSelected(select);
        })
        .catch((e) => setError(errorText(e))),
    [project.id],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const current = textures?.find((t) => targetKey(t.target) === selected) ?? textures?.[0] ?? null;
  const groups: { title: string; kind: TextureTarget["kind"]; add?: NewKind; Icon?: typeof Sword }[] = [
    { title: "Icône", kind: "icon" },
    { title: "Objets", kind: "item", add: "item", Icon: Sword },
    { title: "Blocs", kind: "block", add: "block", Icon: Box },
  ];

  const applied = (info: TextureInfo) => {
    setTextures((list) => list?.map((t) => (targetKey(t.target) === targetKey(info.target) ? info : t)) ?? null);
    if (info.target.kind === "icon") useMcStudioStore.getState().bumpIcon(project.id);
  };

  return (
    <div className="flex h-full min-h-0">
      <aside aria-label="Textures du mod" className="w-[272px] shrink-0 space-y-5 overflow-y-auto border-r border-border p-4">
        {error && (
          <p role="alert" className="text-footnote text-danger">
            {error}
          </p>
        )}
        {!textures && !error && <Loader2 size={16} className="animate-spin text-text-subtle" aria-label="Chargement" />}
        {textures &&
          groups.map(({ title, kind, add, Icon }) => {
            const list = textures.filter((t) => t.target.kind === kind);
            return (
              <section key={kind} className="space-y-1.5">
                <div className="flex items-center justify-between px-2">
                  <h2 className="text-caption font-semibold uppercase tracking-[0.04em] text-text-subtle">
                    {title}
                    {kind !== "icon" && <span className="font-normal"> · {list.length}</span>}
                  </h2>
                  {add && Icon && (
                    <button
                      type="button"
                      aria-label={add === "item" ? "Nouvel objet" : "Nouveau bloc"}
                      title={add === "item" ? "Nouvel objet" : "Nouveau bloc"}
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
                  <NewContentForm
                    project={project}
                    kind={add}
                    onCancel={() => setAdding(null)}
                    onCreated={(target) => {
                      setAdding(null);
                      void load(targetKey(target));
                    }}
                  />
                )}
                {list.length === 0 && kind !== "icon" ? (
                  <p className="px-2 text-caption text-text-subtle">
                    Aucun {kind === "item" ? "objet" : "bloc"} pour l'instant.
                  </p>
                ) : (
                  <ul className="space-y-0.5">
                    {list.map((texture) => (
                      <TextureRow
                        key={targetKey(texture.target)}
                        texture={texture}
                        selected={current !== null && targetKey(current.target) === targetKey(texture.target)}
                        onSelect={() => setSelected(targetKey(texture.target))}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto px-6 py-6">
        {current && <TextureStudio key={targetKey(current.target)} project={project} texture={current} onApplied={applied} />}
      </div>
    </div>
  );
}
