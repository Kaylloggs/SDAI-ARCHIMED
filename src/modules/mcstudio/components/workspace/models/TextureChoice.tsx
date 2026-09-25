import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { cn } from "@/core/lib/cn";
import type { ProjectSummary } from "@/core/ipc/bindings/ProjectSummary";
import type { TextureInfo } from "@/core/ipc/bindings/TextureInfo";
import { errorText, mcstudioApi } from "../../../api";
import { joinPath } from "../../../lib/format";
import { textureReference } from "../../../lib/models/resolve";
import { decodePixels, type Pixels, type Rgba } from "../../../lib/pixels";
import { Checker, focusRing, inputClass, PixelImage, Segmented } from "../../ui";
import { TextureStudio } from "../TextureStudio";

/**
 * D'où vient la texture d'un nouveau cube (ou des cubes choisis) : la même que celle du cube
 * de départ, une texture du mod (ou du jeu) réutilisée, une nouvelle texture unie à peindre,
 * ou une nouvelle texture générée par l'IA ou importée dans l'atelier de texture.
 */
export type TextureSource =
  | { kind: "same" }
  | { kind: "existing"; reference: string; file: string | null }
  | { kind: "color"; size: number }
  | { kind: "atelier"; size: number };

const SIZES = [16, 32, 64];

/** Textures du mod déjà dessinées (pour les réutiliser). */
export function useModTextures(projectId: string): TextureInfo[] {
  const [list, setList] = useState<TextureInfo[]>([]);
  useEffect(() => {
    let cancelled = false;
    mcstudioApi
      .listTextures(projectId)
      .then((all) => !cancelled && setList(all.filter((t) => t.exists && !t.unused)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  return list;
}

function Choice({ checked, onSelect, title, hint, children }: { checked: boolean; onSelect: () => void; title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className={cn("rounded-md border transition-colors", checked ? "border-accent/60 bg-accent-soft/40" : "border-border")}>
      <button
        type="button"
        role="radio"
        aria-checked={checked}
        onClick={onSelect}
        className={cn("flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left", focusRing)}
      >
        <span
          aria-hidden
          className={cn(
            "mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border",
            checked ? "border-accent bg-accent" : "border-border-strong",
          )}
        >
          {checked && <span className="size-1.5 rounded-full bg-accent-fg" />}
        </span>
        <span className="min-w-0">
          <span className="block text-caption font-medium text-text">{title}</span>
          {hint && <span className="block text-caption text-text-subtle">{hint}</span>}
        </span>
      </button>
      {checked && children && <div className="space-y-2 px-2.5 pb-2.5">{children}</div>}
    </div>
  );
}

/**
 * Choix de la texture. `same` : libellé de l'option « même texture », absente si `null`.
 * `entity` : les cubes d'entité partagent une seule texture, chacun avec sa zone.
 */
export function TextureChoice({
  value,
  onChange,
  same,
  textures,
  modId,
  color,
  entity = false,
}: {
  value: TextureSource;
  onChange: (source: TextureSource) => void;
  same: string | null;
  textures: TextureInfo[];
  modId: string;
  color: Rgba;
  entity?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [vanilla, setVanilla] = useState("");
  const usable = useMemo(
    () =>
      textures
        .map((info) => ({ info, reference: textureReference(info.relative, modId) }))
        .filter((t): t is { info: TextureInfo; reference: string } => t.reference !== null)
        .filter(({ info, reference }) => !query || `${info.label} ${reference}`.toLowerCase().includes(query.toLowerCase())),
    [textures, modId, query],
  );
  const size = value.kind === "color" || value.kind === "atelier" ? value.size : 16;
  const sizePicker = !entity && (
    <Segmented
      label="Taille de la nouvelle texture"
      value={size}
      options={SIZES.map((s) => ({ value: s, label: `${s} px` }))}
      onChange={(next) => (value.kind === "color" || value.kind === "atelier") && onChange({ ...value, size: next })}
    />
  );

  return (
    <div role="radiogroup" aria-label="Texture" className="space-y-1.5">
      {same !== null && (
        <Choice
          checked={value.kind === "same"}
          onSelect={() => onChange({ kind: "same" })}
          title={entity ? `Même zone de texture que ${same}` : `Même texture que ${same}`}
        />
      )}
      <Choice
        checked={value.kind === "existing"}
        onSelect={() => value.kind !== "existing" && usable[0] && onChange({ kind: "existing", reference: usable[0].reference, file: usable[0].info.relative })}
        title={entity ? "Remplie avec une texture du mod" : "Texture du mod, réutilisée"}
        hint={usable.length === 0 && !query ? "Le mod n'a pas encore de texture." : undefined}
      >
        <label className="flex h-7 items-center gap-1.5 rounded-sm border border-border bg-surface-1 px-2">
          <Search size={12} className="shrink-0 text-text-subtle" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Chercher"
            aria-label="Chercher une texture du mod"
            className="min-w-0 flex-1 bg-transparent text-caption text-text outline-none placeholder:text-text-subtle"
          />
        </label>
        <div role="listbox" aria-label="Textures du mod" className="grid max-h-36 grid-cols-6 gap-1 overflow-y-auto">
          {usable.map(({ info, reference }) => {
            const chosen = value.kind === "existing" && value.reference === reference;
            return (
              <button
                key={info.relative}
                type="button"
                role="option"
                aria-selected={chosen}
                title={`${info.label} · ${reference}`}
                onClick={() => onChange({ kind: "existing", reference, file: info.relative })}
                className={cn("rounded-sm p-0.5", chosen ? "ring-2 ring-accent" : "hover:bg-surface-2", focusRing)}
              >
                <Checker size={32}>
                  <PixelImage path={info.path} version={info.modified ?? 0} size={28} alt={info.label} />
                </Checker>
              </button>
            );
          })}
        </div>
        {!entity && (
          <input
            value={vanilla}
            onChange={(event) => {
              setVanilla(event.target.value);
              const reference = event.target.value.trim();
              if (/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(reference)) onChange({ kind: "existing", reference, file: null });
            }}
            spellCheck={false}
            placeholder="ou une texture du jeu : minecraft:block/stone"
            aria-label="Texture du jeu"
            className={cn(inputClass, "h-7 font-mono text-caption")}
          />
        )}
      </Choice>
      <Choice
        checked={value.kind === "color"}
        onSelect={() => onChange({ kind: "color", size })}
        title={entity ? "Zone propre, de la couleur du pinceau" : "Nouvelle texture, de la couleur du pinceau"}
        hint="À peindre ensuite directement sur le modèle."
      >
        <span className="flex items-center gap-2 text-caption text-text-subtle">
          <span aria-hidden className="size-4 rounded-xs border border-border-strong" style={{ backgroundColor: `rgba(${color.join(",")})` }} />
          Couleur choisie dans la barre d'outils
        </span>
        {sizePicker}
      </Choice>
      <Choice
        checked={value.kind === "atelier"}
        onSelect={() => onChange({ kind: "atelier", size })}
        title={entity ? "Zone propre, image générée ou importée" : "Nouvelle texture générée ou importée"}
        hint="L'atelier de texture s'ouvre : description pour l'IA, ou image de votre ordinateur."
      />
    </div>
  );
}

/** Pixels d'une texture du mod (réutilisée pour remplir une zone). */
export async function texturePixelsOf(projectId: string, file: string): Promise<Pixels> {
  return decodePixels(await mcstudioApi.texturePixels(projectId, file));
}

type Request = { name: string; label: string; resolve: (pixels: Pixels | null) => void };

/**
 * Atelier de texture en surcouche, en mode « choisir » : `pick(nom)` l'ouvre et rend les
 * pixels du brouillon retenu (rien n'est écrit dans le projet), ou `null` si la personne annule.
 */
export function useTextureAtelier(project: ProjectSummary, textures: TextureInfo[]) {
  const [request, setRequest] = useState<Request | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<Request | null>(null);

  const pick = useCallback(
    (name: string, label: string) =>
      new Promise<Pixels | null>((resolve) => {
        pending.current?.resolve(null);
        const next = { name, label, resolve };
        pending.current = next;
        setError(null);
        setRequest(next);
      }),
    [],
  );

  const close = (pixels: Pixels | null) => {
    pending.current?.resolve(pixels);
    pending.current = null;
    setRequest(null);
  };

  useEffect(() => () => pending.current?.resolve(null), []);

  const modId = project.meta?.modId ?? "";
  const overlay = request ? (
    <div role="dialog" aria-modal="true" aria-label="Atelier de texture" className="absolute inset-0 z-30 flex flex-col bg-bg">
      <TextureStudio
        project={project}
        texture={{
          target: { kind: "block", id: request.name, face: null },
          label: request.label,
          path: joinPath(project.path, `src/main/resources/assets/${modId}/textures/block/${request.name}.png`),
          relative: `src/main/resources/assets/${modId}/textures/block/${request.name}.png`,
          exists: false,
          width: 16,
          height: 16,
          modified: null,
          layout: null,
          unused: false,
          assetKind: null,
          usedBy: null,
        }}
        textures={textures}
        onApplied={() => undefined}
        onSelect={() => undefined}
        onLayoutChanged={() => undefined}
        onDeleted={() => undefined}
        pick={{
          label: "Utiliser sur le modèle",
          onCancel: () => close(null),
          onUse: (draft) => {
            mcstudioApi
              .draftPixels(draft.id)
              .then((data) => close(decodePixels(data)))
              .catch((e) => setError(errorText(e)));
          },
        }}
      />
      {error && (
        <p role="alert" className="border-t border-border bg-danger-soft px-4 py-2 text-footnote">
          {error}
        </p>
      )}
    </div>
  ) : null;

  return { pick, overlay };
}
