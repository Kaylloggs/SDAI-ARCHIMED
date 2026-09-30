import { useEffect, useState } from "react";
import { AlertTriangle, Check, FolderSearch, Info, Loader2, Plus, RefreshCw, XCircle } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Badge, Button, EmptyState } from "@/design-system/primitives";
import type { GameFoundSystem } from "@/core/ipc/bindings/GameFoundSystem";
import { adoptOps, languageShares } from "../../lib/map";
import { ago, bytes, CATEGORY_LABEL, FILE_KIND } from "../../lib/labels";
import { useGameStudioStore } from "../../store";
import { ErrorLine, focusRing } from "../ui";

function FoundRow({ found }: { found: GameFoundSystem }) {
  const apply = useGameStudioStore((s) => s.apply);
  const loadMap = useGameStudioStore((s) => s.loadMap);
  const projectId = useGameStudioStore((s) => s.openId);
  const inGraph = useGameStudioStore((s) => s.current?.graph.systems.some((x) => x.id === found.id) ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const adopt = async () => {
    setBusy(true);
    setError(null);
    for (const op of adoptOps({ ...found, inGraph })) {
      const failure = await apply(op);
      if (failure) {
        setError(failure);
        break;
      }
    }
    setBusy(false);
    if (projectId) void loadMap(projectId);
  };

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-body-sm font-medium">{found.name}</p>
        <span className="text-caption text-text-subtle">{CATEGORY_LABEL[found.category]}</span>
        <span className="text-caption text-text-subtle tabular-nums">· {found.fileCount} fichier(s)</span>
        <div className="ml-auto">
          {inGraph ? (
            <Badge tone="success">
              <Check size={11} className="mr-1 inline" aria-hidden />
              Dans le graphe
            </Badge>
          ) : (
            <Button size="sm" variant="secondary" icon={busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} disabled={busy} onClick={() => void adopt()}>
              Ajouter au graphe
            </Button>
          )}
        </div>
      </div>
      {found.evidence.length > 0 && <p className="text-footnote text-text-muted">Reconnu par : {found.evidence.join(", ")}</p>}
      <details className="pt-1">
        <summary className={cn("cursor-pointer text-caption text-text-subtle hover:text-text", focusRing)}>Fichiers</summary>
        <ul className="pt-1 font-mono text-caption text-text-muted">
          {found.files.map((f) => (
            <li key={f} className="truncate" title={f}>
              {f}
            </li>
          ))}
          {found.fileCount > found.files.length && <li className="text-text-subtle">… et {found.fileCount - found.files.length} autre(s)</li>}
        </ul>
      </details>
      <ErrorLine message={error} onClose={() => setError(null)} />
    </li>
  );
}

/** Carte du projet : ce qu'il contient, les systèmes déjà codés, et ce qui présente un risque. */
export function MapSection() {
  const projectId = useGameStudioStore((s) => s.openId);
  const maps = useGameStudioStore((s) => s.maps);
  const scanning = useGameStudioStore((s) => (projectId ? (s.scanning[projectId] ?? false) : false));
  const loadMap = useGameStudioStore((s) => s.loadMap);
  const scan = useGameStudioStore((s) => s.scan);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (projectId && !(projectId in maps)) void loadMap(projectId);
  }, [projectId, maps, loadMap]);

  if (!projectId) return null;
  const map = maps[projectId];
  const run = async () => {
    setError(null);
    const result = await scan(projectId);
    if (typeof result === "string") setError(result);
  };

  if (!map) {
    return (
      <div className="space-y-3">
        <EmptyState
          icon={<FolderSearch size={28} />}
          title="Projet pas encore analysé"
          description="L'analyse lit les fichiers du projet (jamais les dossiers générés par le moteur) : langages, systèmes déjà codés, risques. Rien n'est modifié."
          action={
            <Button variant="primary" icon={scanning ? <Loader2 size={14} className="animate-spin" /> : <FolderSearch size={14} />} disabled={scanning} onClick={() => void run()}>
              {scanning ? "Analyse…" : "Analyser le projet"}
            </Button>
          }
        />
        <ErrorLine message={error} onClose={() => setError(null)} />
      </div>
    );
  }

  const found = map.systems;
  const missing = found.filter((f) => !f.inGraph).length;
  const kinds = [...map.kinds].sort((a, b) => b.files - a.files);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-body-sm text-text-muted">
          Analysé {ago(map.scannedAt)} · <span className="tabular-nums">{map.files}</span> fichiers · {bytes(map.bytes)}
          {map.changed > 0 && ` · ${map.changed} nouveau(x) ou modifié(s) depuis l'analyse précédente`}
        </p>
        <Button size="sm" variant="secondary" className="ml-auto" icon={scanning ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} disabled={scanning} onClick={() => void run()}>
          {scanning ? "Analyse…" : "Analyser à nouveau"}
        </Button>
      </div>
      <ErrorLine message={error} onClose={() => setError(null)} />

      {map.risks.length > 0 && (
        <section aria-label="Risques" className="space-y-2">
          <h3 className="text-title-3 font-semibold">Risques ({map.risks.length})</h3>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface-1">
            {map.risks.map((risk) => {
              const Icon = risk.severity === "error" ? XCircle : risk.severity === "warning" ? AlertTriangle : Info;
              return (
                <li key={risk.title} className="flex gap-3 px-4 py-3">
                  <Icon size={15} className={cn("mt-0.5 shrink-0", risk.severity === "error" ? "text-danger" : risk.severity === "warning" ? "text-warning" : "text-text-subtle")} aria-hidden />
                  <div className="min-w-0">
                    <p className="text-body-sm font-medium">{risk.title}</p>
                    <p className="text-footnote text-text-muted">{risk.detail}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-label="Systèmes repérés dans le code" className="space-y-2">
        <div className="space-y-0.5">
          <h3 className="text-title-3 font-semibold">Systèmes repérés dans le code ({found.length})</h3>
          <p className="text-footnote text-text-muted">
            D'après les noms des fichiers, des classes et des fonctions.
            {missing > 0 && ` ${missing} ne sont pas encore dans le graphe : ajoutez ceux qui sont justes, les agents s'en serviront.`}
          </p>
        </div>
        {found.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface-1 px-4 py-3 text-body-sm text-text-muted">Aucun système reconnu dans les noms du code.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface-1">
            {found.map((f) => (
              <FoundRow key={f.id} found={f} />
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-8 md:grid-cols-2">
        <section aria-label="Langages" className="space-y-2">
          <h3 className="text-title-3 font-semibold">Langages</h3>
          <ul className="space-y-2 rounded-lg border border-border bg-surface-1 px-4 py-3">
            {languageShares(map).map((l) => (
              <li key={l.language} className="space-y-1">
                <div className="flex justify-between text-body-sm">
                  <span>{l.language}</span>
                  <span className="text-footnote text-text-muted tabular-nums">
                    {l.files} fichier(s) · {l.lines.toLocaleString("fr-FR")} lignes
                  </span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                  <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(2, l.share * 100)}%` }} />
                </div>
              </li>
            ))}
            {map.languages.length === 0 && <li className="text-footnote text-text-subtle">Aucun code.</li>}
          </ul>
        </section>
        <section aria-label="Contenu" className="space-y-2">
          <h3 className="text-title-3 font-semibold">Contenu</h3>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface-1 px-4">
            {kinds.map((k) => (
              <li key={k.kind} className="flex justify-between py-2 text-body-sm">
                <span>{FILE_KIND[k.kind]}</span>
                <span className="text-footnote text-text-muted tabular-nums">
                  {k.files} · {bytes(k.bytes)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section aria-label="Dossiers" className="space-y-2">
        <h3 className="text-title-3 font-semibold">Dossiers principaux</h3>
        <ul className="grid gap-x-6 rounded-lg border border-border bg-surface-1 px-4 py-2 sm:grid-cols-2">
          {map.folders.map((f) => (
            <li key={f.path} className="flex justify-between gap-3 py-1.5 text-body-sm">
              <span className="truncate font-mono text-footnote" title={f.path}>
                {f.path === "." ? "(racine)" : `${f.path}/`}
              </span>
              <span className="shrink-0 text-footnote text-text-muted tabular-nums">
                {f.files} · {bytes(f.bytes)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
