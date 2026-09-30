import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Box, FileSearch, FolderOpen, RefreshCw, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import { Badge, Button } from "@/design-system/primitives";
import type { GameAssetEntry } from "@/core/ipc/bindings/GameAssetEntry";
import type { GameAssetsView } from "@/core/ipc/bindings/GameAssetsView";
import type { GameBlendInfo } from "@/core/ipc/bindings/GameBlendInfo";
import type { GameEngine } from "@/core/ipc/bindings/GameEngine";
import type { GameModelFormat } from "@/core/ipc/bindings/GameModelFormat";
import { errorText, gameStudioApi } from "../../../api";
import { defaultFormat, generationCost, generationRequest, isBlend, isPreviewable } from "../../../lib/assets";
import { ago, ASSET_KIND, ASSET_SOURCE, ASSET_STATUS, bytes } from "../../../lib/labels";
import { useGameStudioStore } from "../../../store";
import { ConfirmButton, ErrorLine, Segmented, ToneBadge } from "../../ui";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2 text-body-sm">
      <dt className="text-text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** Lecture d'un .blend par Blender : objets, triangles, animations, points à vérifier. */
function BlendReport({ info }: { info: GameBlendInfo }) {
  return (
    <div className="space-y-2">
      <p className="text-footnote text-text-muted">
        Lu par Blender {info.blender} {ago(info.readAt)} · {info.triangles.toLocaleString("fr-FR")} triangles · {info.materials.length} matériau(x) · {info.actions.length} animation(s)
        {info.actions.length > 0 && ` (${info.fps} i/s)`}
      </p>
      {info.warnings.length > 0 && (
        <ul className="space-y-1">
          {info.warnings.map((w) => (
            <li key={w} className="flex gap-2 rounded-md bg-warning-soft px-2.5 py-1.5 text-footnote">
              <TriangleAlert size={13} className="mt-0.5 shrink-0 text-warning" aria-hidden />
              {w}
            </li>
          ))}
        </ul>
      )}
      <table className="w-full text-left text-footnote">
        <thead className="text-text-subtle">
          <tr>
            <th className="py-1 font-normal">Objet</th>
            <th className="py-1 font-normal">Type</th>
            <th className="py-1 text-right font-normal">Triangles</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {info.objects.slice(0, 40).map((o) => (
            <tr key={o.name}>
              <td className="max-w-0 truncate py-1 pr-2" title={o.name}>
                {o.name}
              </td>
              <td className="py-1 pr-2 text-text-muted">{o.type.toLowerCase()}</td>
              <td className="py-1 text-right tabular-nums">{o.type === "MESH" ? o.triangles.toLocaleString("fr-FR") : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {info.objects.length > 40 && <p className="text-caption text-text-subtle">… et {info.objects.length - 40} autres objets.</p>}
    </div>
  );
}

function BlenderPanel({ entry, view, projectId, engine }: { entry: GameAssetEntry; view: GameAssetsView; projectId: string; engine: GameEngine | null }) {
  const job = useGameStudioStore((s) => s.jobs[projectId]);
  const [info, setInfo] = useState<GameBlendInfo | null>(null);
  const [format, setFormat] = useState<GameModelFormat>(defaultFormat(engine));
  const [error, setError] = useState<string | null>(null);
  const busy = Boolean(job?.running);
  const id = entry.asset.id;

  useEffect(() => {
    setInfo(null);
    void gameStudioApi.blendInfo(projectId, id).then(setInfo).catch(() => setInfo(null));
  }, [projectId, id, job?.record?.id]);

  if (!view.blender) {
    return (
      <p className="text-footnote text-text-muted">
        Blender n'est pas installé sur cette machine : installez-le depuis Outils (ou désignez son exécutable) pour lire ce fichier et l'exporter vers le moteur.
      </p>
    );
  }
  const run = async (kind: "inspect" | "export") => {
    setError(null);
    const record = await useGameStudioStore
      .getState()
      .runAssetJob(projectId, kind === "inspect" ? { kind: "blenderInspect", asset: id } : { kind: "blenderExport", asset: id, format });
    if (record.status === "failed" && !record.id) setError(record.summary);
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" icon={<FileSearch size={13} />} disabled={busy} onClick={() => void run("inspect")}>
          {info ? "Relire le fichier" : "Lire le fichier"}
        </Button>
        <Segmented
          label="Format d'export"
          value={format}
          onChange={setFormat}
          options={[
            { value: "glb", label: "GLB" },
            { value: "fbx", label: "FBX" },
          ]}
        />
        <Button size="sm" icon={<Box size={13} />} disabled={busy} onClick={() => void run("export")}>
          Exporter pour le jeu
        </Button>
      </div>
      <p className="text-caption text-text-subtle">
        Blender {view.blender.version ?? ""} sans fenêtre. {format === "glb" ? "GLB : lu tel quel par Godot." : "FBX : format d'import d'Unity et d'Unreal."}
      </p>
      <ErrorLine message={error} onClose={() => setError(null)} />
      {info && <BlendReport info={info} />}
    </div>
  );
}

/** Fiche d'une ressource : aperçu, ce qu'en disent le disque et le moteur, versions générées, Blender. */
export function AssetDetail({
  entry,
  view,
  projectId,
  engine,
  names,
  onNewVersion,
  onRemoved,
}: {
  entry: GameAssetEntry;
  view: GameAssetsView;
  projectId: string;
  engine: GameEngine | null;
  names: Map<string, string>;
  onNewVersion: () => void;
  onRemoved: () => void;
}) {
  const apply = useGameStudioStore((s) => s.apply);
  const [error, setError] = useState<string | null>(null);
  const { asset } = entry;
  const generations = [...asset.generations].reverse();
  const status = ASSET_STATUS[asset.status];

  return (
    <article aria-label={asset.name} className="space-y-4">
      {entry.absolute && isPreviewable(asset.path) && entry.exists ? (
        <div className="flex max-h-72 items-center justify-center overflow-hidden rounded-lg border border-border bg-[repeating-conic-gradient(var(--color-surface-2)_0%_25%,transparent_0%_50%)] bg-[length:16px_16px]">
          <img src={`${convertFileSrc(entry.absolute)}?v=${asset.version}`} alt={asset.name} className="max-h-72 object-contain" />
        </div>
      ) : null}

      <header className="space-y-1.5">
        <h3 className="text-title-3 font-semibold">{asset.name}</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge>{ASSET_KIND[asset.kind]}</Badge>
          <ToneBadge tone={status.tone}>{status.label}</ToneBadge>
          {asset.version > 1 && <Badge>v{asset.version}</Badge>}
        </div>
      </header>

      <dl className="space-y-1.5">
        <Row label="Fichier">
          {asset.path ? <span className="font-mono text-caption">{asset.path}</span> : "Pas encore produit"}
          {asset.path && !entry.exists && <span className="block text-footnote text-danger">Absent du dossier du jeu.</span>}
        </Row>
        <Row label="Origine">{ASSET_SOURCE[asset.source]}</Row>
        {entry.exists && <Row label="Taille">{bytes(entry.bytes)}</Row>}
        <Row label="Moteur">
          {asset.kind === "concept"
            ? "Hors du jeu : référence pour la direction artistique"
            : engine
              ? entry.inEngine
                ? "Pris en compte (fichier d'import présent)"
                : "Pas encore importé"
              : "Aucun moteur choisi"}
        </Row>
        {asset.importSettings && <Row label="Réglages">{asset.importSettings}</Row>}
        {asset.dependencies.length > 0 && <Row label="Dépend de">{asset.dependencies.map((d) => names.get(d) ?? d).join(", ")}</Row>}
        {asset.usage.length > 0 && <Row label="Utilisée par">{asset.usage.join(", ")}</Row>}
        {asset.notes && <Row label="Notes">{asset.notes}</Row>}
      </dl>

      <div className="flex flex-wrap gap-2">
        {entry.absolute && entry.exists && (
          <Button size="sm" variant="ghost" icon={<FolderOpen size={13} />} onClick={() => void revealItemInDir(entry.absolute!).catch((e) => setError(errorText(e)))}>
            Afficher dans le dossier
          </Button>
        )}
        {asset.generations.length > 0 && (
          <Button size="sm" variant="secondary" icon={<Sparkles size={13} />} onClick={onNewVersion}>
            Nouvelle version
          </Button>
        )}
        <ConfirmButton
          label="Retirer du registre"
          confirmLabel="Retirer (le fichier reste)"
          icon={<Trash2 size={13} />}
          onConfirm={() =>
            void apply({ op: "removeAsset", id: asset.id }).then((failure) => {
              if (failure) setError(failure);
              else onRemoved();
            })
          }
        />
      </div>
      <ErrorLine message={error} onClose={() => setError(null)} />

      {isBlend(asset.path) && (
        <section aria-label="Blender" className="space-y-2 border-t border-border pt-4">
          <h4 className="text-body font-semibold">Blender</h4>
          <BlenderPanel entry={entry} view={view} projectId={projectId} engine={engine} />
        </section>
      )}

      {generations.length > 0 && (
        <section aria-label="Générations" className="space-y-2 border-t border-border pt-4">
          <h4 className="flex items-center gap-2 text-body font-semibold">
            <RefreshCw size={14} className="text-text-subtle" aria-hidden /> Générations ({generations.length})
          </h4>
          <ol className="space-y-2">
            {generations.map((g, i) => (
              <li key={`${g.at}-${g.output}`} className="space-y-1 rounded-md bg-surface-2 px-3 py-2">
                <p className="text-footnote text-text-muted">
                  {i === 0 ? "Actuelle" : `Version ${generations.length - i}`} · {g.model} ({g.provider}) · {ago(g.at)}
                  {generationCost(g) && ` · ${generationCost(g)}`}
                  {g.seed && ` · graine ${g.seed}`}
                </p>
                <p className="text-body-sm">{generationRequest(g)}</p>
                <p className="truncate font-mono text-caption text-text-subtle" title={g.output}>
                  {g.output}
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}
    </article>
  );
}
