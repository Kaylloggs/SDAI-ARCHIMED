import { useEffect, useRef, useState } from "react";
import { Check, CloudOff, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Badge, Button } from "@/design-system/primitives";
import type { LoaderId } from "@/core/ipc/bindings/LoaderId";
import type { VersionCatalog } from "@/core/ipc/bindings/VersionCatalog";
import type { VersionOption } from "@/core/ipc/bindings/VersionOption";
import type { VersionSelection } from "@/core/ipc/bindings/VersionSelection";
import { errorText, mcstudioApi } from "../../api";
import { LOADER_LABEL } from "../../lib/format";
import { Fact, focusRing } from "../ui";
import { VersionPicker } from "../VersionPicker";
import { EMPTY_SELECTION, type Draft } from "./draft";

type CatalogState = { catalog: VersionCatalog | null; error: string | null; loading: boolean; reload: () => void };

/** Catalogue lu une fois par ouverture de l'assistant. */
export function useCatalog(): CatalogState {
  const [catalog, setCatalog] = useState<VersionCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    mcstudioApi
      .versionCatalog()
      .then((result) => {
        if (cancelled) return;
        setCatalog(result);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(errorText(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return { catalog, error, loading, reload: () => setAttempt((n) => n + 1) };
}

const supported = (option: VersionOption) => option.loaders.some((l) => l.profileId);

function OptionRow({
  selected,
  disabled,
  onSelect,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left transition-colors last:border-b-0",
        selected ? "bg-accent-soft" : "hover:bg-surface-2",
        disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
        focusRing,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full border",
          selected ? "border-accent bg-accent text-accent-fg" : "border-border-strong",
        )}
      >
        {selected && <Check size={10} strokeWidth={3} />}
      </span>
      {children}
    </button>
  );
}

export function VersionStep({
  draft,
  update,
  state,
}: {
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  state: CatalogState;
}) {
  const [showAll, setShowAll] = useState(false);
  const { catalog, error, loading, reload } = state;

  if (loading && !catalog) {
    return (
      <p className="flex items-center gap-2 text-body-sm text-text-muted">
        <Loader2 size={14} className="animate-spin" /> Lecture des versions publiées par Fabric, Forge et NeoForge…
      </p>
    );
  }
  if (!catalog) {
    return (
      <div role="alert" className="space-y-3">
        <p className="text-body-sm text-danger">{error ?? "Catalogue indisponible."}</p>
        <Button type="button" onClick={reload} icon={<RefreshCw size={14} />}>
          Réessayer
        </Button>
      </div>
    );
  }

  const versions = catalog.versions.filter((v) => showAll || supported(v));
  const hidden = catalog.versions.length - catalog.versions.filter(supported).length;

  return (
    <div className="space-y-3">
      {(catalog.offline || catalog.errors.length > 0) && (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-footnote">
          <CloudOff size={14} className="mt-0.5 shrink-0 text-warning" />
          <div className="space-y-1">
            {catalog.offline && <p>Hors ligne : versions tirées du cache de la dernière connexion.</p>}
            {catalog.errors.map((message) => (
              <p key={message}>{message}</p>
            ))}
          </div>
        </div>
      )}

      <div role="radiogroup" aria-label="Version de Minecraft" className="max-h-[320px] overflow-y-auto rounded-md border border-border">
        {versions.length === 0 && (
          <p className="px-3 py-6 text-center text-body-sm text-text-muted">Aucune version prise en charge n'a pu être lue.</p>
        )}
        {versions.map((option) => {
          const ok = supported(option);
          return (
            <OptionRow
              key={option.minecraft}
              selected={draft.minecraft === option.minecraft}
              disabled={!ok}
              onSelect={() =>
                update({
                  minecraft: option.minecraft,
                  loader: null,
                  profileId: null,
                  selection: EMPTY_SELECTION,
                  versions: null,
                  javaHome: null,
                })
              }
            >
              <span className="w-20 shrink-0 font-mono text-body-sm tabular-nums">{option.minecraft}</span>
              <span className="flex flex-1 flex-wrap gap-1.5">
                {option.loaders
                  .filter((l) => l.profileId)
                  .map((l) => (
                    <Badge key={l.loader}>{LOADER_LABEL[l.loader]}</Badge>
                  ))}
                {!ok && (
                  <span className="text-footnote text-text-subtle">
                    {option.loaders.find((l) => l.reason)?.reason ?? "Pas encore de profil pour cette version."}
                  </span>
                )}
              </span>

            </OptionRow>
          );
        })}
      </div>

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className={cn("rounded-sm text-footnote text-text-muted underline-offset-2 hover:text-text hover:underline", focusRing)}
        >
          {showAll ? "Masquer les versions non prises en charge" : `Voir aussi ${hidden} ${hidden > 1 ? "versions non prises" : "version non prise"} en charge`}
        </button>
      )}
      <p className="text-footnote text-text-subtle">
        Une version est prise en charge quand Mod Studio a un modèle de projet vérifié pour elle : chaque version de
        Minecraft change une partie de l'API.
      </p>
    </div>
  );
}

const LOADER_ORDER: LoaderId[] = ["fabric", "forge", "neoforge"];
const LOADER_HINT: Record<LoaderId, string> = {
  fabric: "Léger, mises à jour rapides. Nécessite Fabric API.",
  forge: "Historique, très grand catalogue de mods.",
  neoforge: "Successeur communautaire de Forge depuis 1.20.2.",
};

export function LoaderStep({
  draft,
  update,
  catalog,
}: {
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  catalog: VersionCatalog | null;
}) {
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const option = catalog?.versions.find((v) => v.minecraft === draft.minecraft);

  /** Versions exactes pour ce loader ; `selection` vide = versions recommandées. */
  const resolve = (loader: LoaderId, profileId: string, selection: VersionSelection) => {
    if (!draft.minecraft) return;
    const ticket = ++request.current;
    update({ loader, profileId, selection, versions: null, javaHome: null });
    setResolving(true);
    setError(null);
    mcstudioApi
      .resolveVersions(profileId, draft.minecraft, selection)
      .then((versions) => {
        if (ticket === request.current) update({ versions });
      })
      .catch((e) => {
        if (ticket === request.current) setError(errorText(e));
      })
      .finally(() => {
        if (ticket === request.current) setResolving(false);
      });
  };

  const profile = catalog?.profiles.find((p) => p.id === draft.profileId);
  const v = draft.versions;

  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Loader" className="rounded-md border border-border">
        {LOADER_ORDER.map((loader) => {
          const support = option?.loaders.find((l) => l.loader === loader);
          const profileId = support?.profileId ?? null;
          const rowProfile = catalog?.profiles.find((p) => p.id === profileId);
          const reason = !support?.available
            ? `${LOADER_LABEL[loader]} ne publie pas de version pour Minecraft ${draft.minecraft}.`
            : !profileId
              ? (support.reason ?? "Pas encore de profil pour cette version.")
              : LOADER_HINT[loader];
          return (
            <OptionRow
              key={loader}
              selected={draft.loader === loader}
              disabled={!profileId}
              onSelect={() => profileId && resolve(loader, profileId, EMPTY_SELECTION)}
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-body-sm font-medium">
                  {LOADER_LABEL[loader]}
                  {rowProfile && !rowProfile.verified && <Badge tone="warning">Non vérifié</Badge>}
                </span>
                <span className="block text-footnote text-text-subtle">{reason}</span>
              </span>
            </OptionRow>
          );
        })}
      </div>

      {profile && !profile.verified && (
        <p className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-footnote text-text-muted">
          Ce profil n'a pas encore été validé par une compilation réelle. Le projet est généré pour l'API de cette
          version ; si la compilation échoue, le journal dira quoi ajuster.
          {profile.notes && <span className="mt-1 block text-text-subtle">{profile.notes}</span>}
        </p>
      )}

      {draft.loader && draft.profileId && draft.minecraft && (
        <section aria-label="Versions" className="space-y-2">
          <p className="text-footnote font-medium text-text">Versions</p>
          <VersionPicker
            profileId={draft.profileId}
            minecraft={draft.minecraft}
            loader={draft.loader}
            selection={draft.selection}
            disabled={resolving}
            onChange={(selection) => resolve(draft.loader as LoaderId, draft.profileId as string, selection)}
          />
        </section>
      )}

      {resolving && (
        <p className="flex items-center gap-2 text-footnote text-text-muted">
          <Loader2 size={14} className="animate-spin" /> Résolution des versions officielles…
        </p>
      )}
      {error && (
        <div role="alert" className="space-y-2">
          <p className="text-footnote text-danger">{error}</p>
          {draft.loader && draft.profileId && (
            <Button
              type="button"
              size="sm"
              onClick={() => resolve(draft.loader as LoaderId, draft.profileId as string, draft.selection)}
              icon={<RefreshCw size={12} />}
            >
              Réessayer
            </Button>
          )}
        </div>
      )}
      {v && profile && (
        <dl className="divide-y divide-border rounded-md border border-border bg-surface-1 px-3">
          <Fact label="Mappings">{v.mappingsVersion ? "Yarn" : "Officiels (Mojang)"}</Fact>
          <Fact label="Java requis">{v.javaMax === v.java ? `Java ${v.java} exactement` : `Java ${v.java} ou plus`}</Fact>
          <Fact label="Gradle" mono>
            {v.gradle}
          </Fact>
          {v.offline && <Fact label="Source">Cache (hors ligne)</Fact>}
        </dl>
      )}
    </div>
  );
}
