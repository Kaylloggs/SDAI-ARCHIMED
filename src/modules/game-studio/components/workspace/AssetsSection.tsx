import { useCallback, useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { AudioLines, Box, FileQuestion, FolderInput, Image as ImageIcon, Loader2, Plus, RefreshCw, Search, Sparkles, Square } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Badge, Button, EmptyState } from "@/design-system/primitives";
import type { GameAsset } from "@/core/ipc/bindings/GameAsset";
import type { GameAssetEntry } from "@/core/ipc/bindings/GameAssetEntry";
import type { GameAssetsView } from "@/core/ipc/bindings/GameAssetsView";
import { errorText, gameStudioApi } from "../../api";
import { availability } from "../../lib/actions";
import { assetGroup, filterAssets, importVerb, isPreviewable, type AssetFilter } from "../../lib/assets";
import { ACTION, ASSET_KIND, ASSET_STATUS, bytes, RUN_STATUS } from "../../lib/labels";
import { useGameStudioStore } from "../../store";
import { ErrorLine, focusRing, Segmented, TextInput, ToneBadge } from "../ui";
import { AssetDetail } from "./assets/AssetDetail";
import { GeneratePanel, type ImageDraft } from "./assets/GeneratePanel";

const GROUP_ICON: Record<Exclude<AssetFilter, "all">, LucideIcon> = {
  images: ImageIcon,
  models: Box,
  audio: AudioLines,
  other: FileQuestion,
};

function Thumb({ entry }: { entry: GameAssetEntry }) {
  const [broken, setBroken] = useState(false);
  const Icon = GROUP_ICON[assetGroup(entry.asset.kind)];
  if (entry.absolute && entry.exists && !broken && isPreviewable(entry.asset.path)) {
    return <img src={`${convertFileSrc(entry.absolute)}?v=${entry.asset.version}`} alt="" loading="lazy" onError={() => setBroken(true)} className="size-10 shrink-0 rounded-sm border border-border bg-surface-2 object-cover" />;
  }
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-sm border border-border bg-surface-2 text-text-subtle" aria-hidden>
      <Icon size={16} />
    </span>
  );
}

/** Travail Blender ou import en cours : dernière ligne, arrêt ; puis son verdict. */
function JobStrip({ projectId }: { projectId: string }) {
  const job = useGameStudioStore((s) => s.jobs[projectId]);
  const go = useGameStudioStore((s) => s.go);
  if (!job || (job.action !== "blender" && job.action !== "import")) return null;
  if (job.running) {
    const last = job.lines[job.lines.length - 1]?.text;
    return (
      <div className="flex items-center gap-3 rounded-md border border-border bg-surface-1 px-3 py-2" role="status">
        <Loader2 size={14} className="shrink-0 animate-spin text-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-body-sm font-medium">{ACTION[job.action].label} en cours…</p>
          {last && <p className="truncate font-mono text-caption text-text-muted">{last}</p>}
        </div>
        <Button size="sm" variant="ghost" icon={<Square size={12} />} onClick={() => void useGameStudioStore.getState().cancelAction(projectId)}>
          Arrêter
        </Button>
      </div>
    );
  }
  if (!job.record) return null;
  const look = RUN_STATUS[job.record.status];
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-1 px-3 py-2">
      <ToneBadge tone={look.tone}>{look.label}</ToneBadge>
      <p className="min-w-0 flex-1 text-footnote">{job.record.summary}</p>
      {job.record.id && (
        <button type="button" onClick={() => go("build")} className={cn("text-footnote text-accent hover:underline", focusRing)}>
          Journal complet
        </button>
      )}
    </div>
  );
}

/**
 * Ressources du jeu : le registre (fichiers ajoutés, images générées, exports de Blender), les
 * fichiers du projet pas encore inscrits, et ce que le moteur a réellement importé.
 */
export function AssetsSection() {
  const current = useGameStudioStore((s) => s.current);
  const projectId = current?.project.id ?? null;
  const engine = current?.project.engine ?? null;
  const revision = current?.graph.revision ?? 0;
  const job = useGameStudioStore((s) => (projectId ? s.jobs[projectId] : undefined));
  const [view, setView] = useState<GameAssetsView | null>(null);
  const [filter, setFilter] = useState<AssetFilter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<ImageDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setView(await gameStudioApi.assets(projectId));
    } catch (e) {
      setError(errorText(e));
    }
  }, [projectId]);

  // Le registre change (agent, Blender, import, autre section) : la liste suit.
  useEffect(() => {
    void load();
  }, [load, revision, job?.record?.id]);

  const entries = useMemo(() => (view ? filterAssets(view.entries, filter, query) : []), [view, filter, query]);
  const names = useMemo(() => new Map((view?.entries ?? []).map((e) => [e.asset.id, e.asset.name])), [view]);
  const chosen = view?.entries.find((e) => e.asset.id === selected) ?? null;

  if (!current || !projectId) return null;
  const importState = availability(current, "import");
  const running = Boolean(job?.running);
  const styleEmpty = !current.project.style.visualStyle.trim() && current.project.style.palette.length === 0;
  const counts: Record<AssetFilter, number> | null = view
    ? {
        all: view.entries.length,
        images: view.entries.filter((e) => assetGroup(e.asset.kind) === "images").length,
        models: view.entries.filter((e) => assetGroup(e.asset.kind) === "models").length,
        audio: view.entries.filter((e) => assetGroup(e.asset.kind) === "audio").length,
        other: view.entries.filter((e) => assetGroup(e.asset.kind) === "other").length,
      }
    : null;

  const addFiles = async () => {
    setError(null);
    const picked = await openDialog({ multiple: true, directory: false, title: "Ressources à ajouter au jeu" }).catch(() => null);
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    if (paths.length === 0) return;
    setBusy(true);
    try {
      const added = await gameStudioApi.importAssets(projectId, paths, null);
      setNotice(`${added.length} ressource(s) ajoutée(s) dans ${view?.folder ?? "le projet"}.`);
      if (added[0]) setSelected(added[0].id);
      void useGameStudioStore.getState().reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const register = async (paths: string[]) => {
    setError(null);
    setBusy(true);
    try {
      let last: GameAsset | null = null;
      for (const path of paths) last = await gameStudioApi.registerAsset(projectId, path, null);
      setNotice(`${paths.length} fichier(s) inscrit(s) au registre.`);
      if (last) setSelected(last.id);
      void useGameStudioStore.getState().reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const importInEngine = async () => {
    setError(null);
    setNotice(null);
    await useGameStudioStore.getState().runAssetJob(projectId, { kind: "engineImport" });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon={<Sparkles size={14} />} onClick={() => setDraft({ asset: null, prompt: "", kind: "texture" })} disabled={Boolean(draft)}>
          Générer une image
        </Button>
        <Button variant="secondary" icon={busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} disabled={busy} onClick={() => void addFiles()}>
          Ajouter des fichiers
        </Button>
        <span className="ml-auto" />
        <Button variant="secondary" icon={<FolderInput size={14} />} disabled={running || !importState.available} title={importState.reason ?? undefined} onClick={() => void importInEngine()}>
          {importVerb(engine)}
        </Button>
        <Button variant="ghost" size="sm" aria-label="Relire" title="Relire" onClick={() => void load()}>
          <RefreshCw size={13} />
        </Button>
      </div>
      <p className="text-footnote text-text-muted">
        {view?.importHint}
        {!importState.available && importState.reason && ` ${importState.reason}`}
      </p>
      <JobStrip projectId={projectId} />
      <ErrorLine message={error} onClose={() => setError(null)} />
      {notice && <p className="rounded-md bg-success-soft px-3 py-2 text-footnote">{notice}</p>}

      {draft && (
        <GeneratePanel
          key={draft.asset?.id ?? "new"}
          projectId={projectId}
          draft={draft}
          styleEmpty={styleEmpty}
          onClose={() => setDraft(null)}
          onDone={(asset) => {
            setDraft(null);
            setSelected(asset.id);
            setNotice(`Image écrite : ${asset.path}.`);
            void load();
          }}
        />
      )}

      {view === null ? (
        <p className="text-footnote text-text-subtle">Lecture des ressources…</p>
      ) : view.entries.length === 0 && view.loose.length === 0 ? (
        <EmptyState
          icon={<ImageIcon size={28} />}
          title="Aucune ressource pour l'instant"
          description={`Générez une image, ou ajoutez des fichiers (modèles, textures, sons) : ils sont copiés dans ${view.folder}/ et suivis ici jusqu'à leur import dans le moteur.`}
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                label="Famille de ressources"
                size="sm"
                value={filter}
                onChange={setFilter}
                options={(
                  [
                    ["all", "Toutes"],
                    ["images", "Images"],
                    ["models", "Modèles"],
                    ["audio", "Sons"],
                    ["other", "Autres"],
                  ] as const
                ).map(([value, label]) => ({ value, label: counts ? `${label} (${counts[value]})` : label }))}
              />
              <div className="relative min-w-[10rem] flex-1">
                <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-subtle" aria-hidden />
                <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Chercher" aria-label="Chercher une ressource" className="w-full pl-8" />
              </div>
            </div>

            {entries.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-footnote text-text-muted">
                {view.entries.length === 0 ? "Le registre est vide : inscrivez les fichiers trouvés ci-dessous, ou ajoutez-en." : "Aucune ressource ne correspond."}
              </p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface-1">
                {entries.map((entry) => {
                  const status = ASSET_STATUS[entry.asset.status];
                  const active = entry.asset.id === selected;
                  return (
                    <li key={entry.asset.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(active ? null : entry.asset.id)}
                        aria-pressed={active}
                        className={cn("flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-2", active && "bg-surface-2", focusRing)}
                      >
                        <Thumb entry={entry} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body-sm font-medium">{entry.asset.name}</span>
                          <span className="block truncate text-caption text-text-muted">
                            {ASSET_KIND[entry.asset.kind]}
                            {entry.asset.path ? ` · ${entry.asset.path}` : ""}
                          </span>
                        </span>
                        {!entry.exists && entry.asset.path && <Badge tone="danger">Fichier absent</Badge>}
                        <ToneBadge tone={status.tone}>{status.label}</ToneBadge>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {view.loose.length > 0 && (
              <details className="rounded-lg border border-border bg-surface-1" open={view.entries.length === 0}>
                <summary className={cn("flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-body-sm", focusRing)}>
                  <span>
                    Dans le projet, hors registre ({view.loose.length}
                    {view.looseTruncated ? "+" : ""})
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={(e) => {
                      e.preventDefault();
                      void register(view.loose.map((l) => l.path));
                    }}
                  >
                    Tout inscrire
                  </Button>
                </summary>
                <ul className="max-h-72 divide-y divide-border overflow-y-auto border-t border-border">
                  {view.loose.map((file) => (
                    <li key={file.path} className="flex items-center gap-3 px-3 py-1.5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-caption" title={file.path}>
                          {file.path}
                        </span>
                        <span className="text-caption text-text-subtle">
                          {ASSET_KIND[file.kind]} · {bytes(file.bytes)}
                          {engine && (file.inEngine ? " · dans le moteur" : " · pas encore importé")}
                        </span>
                      </span>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void register([file.path])}>
                        Inscrire
                      </Button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          <aside className="min-w-0 lg:sticky lg:top-4 lg:self-start">
            {chosen ? (
              <div className="rounded-lg border border-border bg-surface-1 p-4">
                <AssetDetail
                  key={chosen.asset.id}
                  entry={chosen}
                  view={view}
                  projectId={projectId}
                  engine={engine}
                  names={names}
                  onNewVersion={() => {
                    const last = chosen.asset.generations[chosen.asset.generations.length - 1];
                    const request = (last?.params as { request?: string } | undefined)?.request;
                    setDraft({ asset: chosen.asset, prompt: request ?? last?.prompt ?? "", kind: chosen.asset.kind });
                  }}
                  onRemoved={() => setSelected(null)}
                />
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-footnote text-text-muted">
                Choisissez une ressource pour voir son aperçu, son état dans le moteur, ses versions générées ou la lire avec Blender.
              </p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
