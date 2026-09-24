import { useCallback, useEffect, useState } from "react";
import { Box, LayoutPanelTop, Loader2, Plus, Sword } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Button, Select } from "@/design-system/primitives";
import type { BlockSound } from "@/core/ipc/bindings/BlockSound";
import type { GuiPreset } from "@/core/ipc/bindings/GuiPreset";
import type { ProjectSummary } from "@/core/ipc/bindings/ProjectSummary";
import type { TextureInfo } from "@/core/ipc/bindings/TextureInfo";
import type { TextureTarget } from "@/core/ipc/bindings/TextureTarget";
import { errorText, mcstudioApi } from "../../api";
import { registryIdProblem, suggestRegistryId } from "../../lib/naming";
import { blockOf, GUI_PRESETS, targetKey } from "../../lib/textures";
import { useMcStudioStore } from "../../store";
import { Checker, Field, focusRing, inputClass, PixelImage, Segmented } from "../ui";
import { TextureStudio } from "./TextureStudio";

/** Dureté et résistance usuelles de chaque matière (valeurs du jeu). */
const MATERIALS: Record<BlockSound, { label: string; hardness: number; resistance: number }> = {
  stone: { label: "Pierre", hardness: 1.5, resistance: 6 },
  metal: { label: "Métal", hardness: 5, resistance: 6 },
  wood: { label: "Bois", hardness: 2, resistance: 3 },
};

type NewKind = "item" | "block" | "gui";

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
        onCreated({ kind: "block", id: shownId, face: null });
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

/** Nouvel élément d'interface : un écran, un bouton, une case… dessiné aux couleurs du jeu. */
function NewGuiForm({
  project,
  onCreated,
  onCancel,
}: {
  project: ProjectSummary;
  onCreated: (target: TextureTarget) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [preset, setPreset] = useState<GuiPreset>("inventoryPanel");
  const [width, setWidth] = useState(64);
  const [height, setHeight] = useState(64);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = name ? registryIdProblem(name) : null;
  const ready = name && !problem && !busy;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await mcstudioApi.createGuiTexture(project.id, { name, preset, width, height });
      onCreated({ kind: "gui", name });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const size = (label: string, value: number, set: (v: number) => void) => (
    <label className="flex-1 space-y-1.5">
      <span className="block text-footnote font-medium text-text-muted">{label}</span>
      <input
        type="number"
        min={1}
        max={256}
        value={value}
        onChange={(e) => set(Math.max(1, Math.min(256, Math.round(Number(e.target.value)) || 1)))}
        className={cn(inputClass, "tabular-nums")}
      />
    </label>
  );

  return (
    <form
      className="space-y-3 rounded-md border border-border bg-surface-1 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) void submit();
      }}
    >
      <p className="text-footnote font-semibold">Nouvel élément d'interface</p>
      <Field id="mc-gui-name" label="Nom du fichier" problem={problem} hint="Dans textures/gui/ : minuscules, chiffres, _.">
        <input
          id="mc-gui-name"
          autoFocus
          value={name}
          spellCheck={false}
          placeholder="forge"
          onChange={(e) => setName(e.target.value)}
          className={cn(inputClass, "font-mono")}
        />
      </Field>
      <div className="space-y-1.5">
        <p className="text-footnote font-medium text-text-muted">Départ</p>
        <Select
          label="Élément de départ"
          value={preset}
          onChange={(value) => setPreset(value as GuiPreset)}
          options={GUI_PRESETS.map((p) => ({ value: p.value, label: p.label, hint: p.size }))}
        />
      </div>
      {preset === "blank" && (
        <div className="flex gap-2">
          {size("Largeur", width, setWidth)}
          {size("Hauteur", height, setHeight)}
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
        Dessiné aux couleurs des écrans du jeu (écrans sur une toile 256 × 256, comme le jeu), puis retouchable au pixel ou
        redessinable par l'IA.
      </p>
    </form>
  );
}

function TextureRow({
  texture,
  selected,
  onSelect,
  label = texture.label,
}: {
  texture: TextureInfo;
  selected: boolean;
  onSelect: () => void;
  label?: string;
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
          <span className="block truncate text-body-sm">{label}</span>
          <span className={cn("block truncate text-caption", texture.exists ? "text-text-subtle" : "text-warning")}>
            {texture.exists ? `${texture.width}×${texture.height}` : "Texture manquante"}
          </span>
        </span>
      </button>
    </li>
  );
}

/** Nom du bloc d'une face (« Bûche · côtés » → « Bûche »). */
function blockLabel(texture: TextureInfo): string {
  if (texture.target.kind !== "block" || !texture.target.face) return texture.label;
  const cut = texture.label.lastIndexOf(" · ");
  return cut > 0 ? texture.label.slice(0, cut) : texture.label;
}

/** Une ligne par bloc (ses faces se choisissent dans l'atelier). */
function rows(list: TextureInfo[]): TextureInfo[] {
  const seen = new Set<string>();
  return list.filter((texture) => {
    const block = blockOf(texture.target);
    if (!block) return true;
    if (seen.has(block)) return false;
    seen.add(block);
    return true;
  });
}

/**
 * Onglet Textures : l'icône, les objets, les blocs (et leurs faces) et les éléments
 * d'interface du mod, et l'atelier de la texture choisie.
 */
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
  const groups: { title: string; kind: TextureTarget["kind"]; add?: NewKind; Icon?: typeof Sword; empty?: string }[] = [
    { title: "Icône", kind: "icon" },
    { title: "Objets", kind: "item", add: "item", Icon: Sword, empty: "Aucun objet pour l'instant." },
    { title: "Blocs", kind: "block", add: "block", Icon: Box, empty: "Aucun bloc pour l'instant." },
    { title: "Interface", kind: "gui", add: "gui", Icon: LayoutPanelTop, empty: "Aucun écran ni bouton pour l'instant." },
  ];
  const addLabel: Record<NewKind, string> = { item: "Nouvel objet", block: "Nouveau bloc", gui: "Nouvel élément d'interface" };

  const applied = (info: TextureInfo) => {
    setTextures((list) => list?.map((t) => (targetKey(t.target) === targetKey(info.target) ? info : t)) ?? null);
    if (info.target.kind === "icon") useMcStudioStore.getState().bumpIcon(project.id);
  };

  // Nouvelle répartition des faces : la liste change, on ouvre la première face.
  const layoutChanged = (faces: TextureInfo[]) => {
    const first = faces[0];
    void load(first ? targetKey(first.target) : undefined);
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
          groups.map(({ title, kind, add, Icon, empty }) => {
            const list = rows(textures.filter((t) => t.target.kind === kind));
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
                      aria-label={addLabel[add]}
                      title={addLabel[add]}
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
                {adding === add && add === "gui" && (
                  <NewGuiForm
                    project={project}
                    onCancel={() => setAdding(null)}
                    onCreated={(target) => {
                      setAdding(null);
                      void load(targetKey(target));
                    }}
                  />
                )}
                {adding === add && add && add !== "gui" && (
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
                {list.length === 0 && empty ? (
                  <p className="px-2 text-caption text-text-subtle">{empty}</p>
                ) : (
                  <ul className="space-y-0.5">
                    {list.map((texture) => {
                      const block = blockOf(texture.target);
                      const isSelected =
                        current !== null &&
                        (block ? blockOf(current.target) === block : targetKey(current.target) === targetKey(texture.target));
                      return (
                        <TextureRow
                          key={targetKey(texture.target)}
                          texture={texture}
                          label={blockLabel(texture)}
                          selected={isSelected}
                          onSelect={() => setSelected(targetKey(texture.target))}
                        />
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
      </aside>
      <div className="min-w-0 flex-1 overflow-hidden">
        {current && textures && (
          <TextureStudio
            key={targetKey(current.target)}
            project={project}
            texture={current}
            textures={textures}
            onApplied={applied}
            onSelect={(target) => setSelected(targetKey(target))}
            onLayoutChanged={layoutChanged}
          />
        )}
      </div>
    </div>
  );
}
