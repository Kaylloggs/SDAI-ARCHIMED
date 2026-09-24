import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, CheckCircle2, FolderOpen, Hammer, ListChecks, XCircle } from "lucide-react";
import { engineApi } from "@/core/engine/engine.api";
import { Button } from "@/design-system/primitives";
import type { JavaStatus } from "@/core/ipc/bindings/JavaStatus";
import type { ProjectStats } from "@/core/ipc/bindings/ProjectStats";
import type { ProjectSummary } from "@/core/ipc/bindings/ProjectSummary";
import { errorText, mcstudioApi } from "../../api";
import { ago, LOADER_LABEL } from "../../lib/format";
import { useMcStudioStore } from "../../store";
import { Fact } from "../ui";
import { JdkInstallCard } from "../JdkInstallCard";
import { useEditorStore } from "../../editor";
import { BuildResult } from "./BuildResult";
import { problemsSummary } from "./ProblemsPanel";
import { VersionsSection } from "./VersionsSection";

const STAT_LABELS: [keyof ProjectStats, string][] = [
  ["javaClasses", "Classes Java"],
  ["items", "Objets"],
  ["blocks", "Blocs"],
  ["entities", "Entités"],
  ["recipes", "Recettes"],
  ["lootTables", "Loot tables"],
  ["textures", "Textures"],
  ["models", "Modèles"],
  ["langFiles", "Langues"],
  ["assets", "Assets"],
];

export function Dashboard({
  project,
  java,
  javaError,
  onJavaChange,
  onCompile,
  onShowProblems,
}: {
  project: ProjectSummary;
  java: JavaStatus | null;
  javaError: string | null;
  onJavaChange: (status: JavaStatus) => void;
  onCompile: () => void;
  onShowProblems: () => void;
}) {
  const [stats, setStats] = useState<ProjectStats | null>(null);
  const [error, setError] = useState<string | null>(javaError);
  const running = useMcStudioStore((s) => s.builds[project.id]?.running ?? false);
  const record = useMcStudioStore((s) => s.builds[project.id]?.record) ?? project.lastBuild;
  const meta = project.meta;
  const report = useEditorStore((s) => s.reports[project.id]);

  // Vérification rapide à l'ouverture et après chaque compilation.
  useEffect(() => {
    void useEditorStore.getState().validate(project.id).catch(() => undefined);
  }, [project.id, record?.id]);

  useEffect(() => {
    let cancelled = false;
    mcstudioApi
      .projectStats(project.id)
      .then((result) => !cancelled && setStats(result))
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [project.id, record?.id]);

  if (!meta) return null;
  const v = meta.versions;

  /** Le choix de JDK vit dans project.json : on relit le projet pour rester à jour. */
  const applyJava = (status: JavaStatus) => {
    onJavaChange(status);
    setError(null);
    void mcstudioApi.getProject(project.id).then(useMcStudioStore.getState().upsert).catch(() => undefined);
  };

  const chooseJdk = async () => {
    const folder = await openDialog({ directory: true, title: `JDK ${v.java} pour ${meta.name}` });
    if (typeof folder !== "string") return;
    try {
      applyJava(await mcstudioApi.setProjectJava(project.id, folder));
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-[1040px] gap-8 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-8">
          <section aria-labelledby="mc-last-build" className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 id="mc-last-build" className="text-title-3 font-semibold">
                Dernière compilation
              </h2>
              <Button
                variant="primary"
                disabled={running || !java?.install}
                onClick={onCompile}
                icon={<Hammer size={14} strokeWidth={1.75} />}
              >
                {running ? "Compilation en cours…" : "Compiler le mod"}
              </Button>
            </div>
            {record ? (
              <BuildResult record={record} />
            ) : (
              <p className="rounded-md border border-border px-4 py-5 text-body-sm text-text-muted">
                Ce projet n'a jamais été compilé. La première compilation télécharge Gradle, Minecraft et le loader :
                comptez quelques minutes et une connexion Internet. Les suivantes réutilisent le cache.
              </p>
            )}
          </section>

          <section aria-labelledby="mc-content" className="space-y-3">
            <h2 id="mc-content" className="text-title-3 font-semibold">
              Contenu du mod
            </h2>
            <dl className="grid grid-cols-2 gap-x-6 rounded-md border border-border bg-surface-1 px-4 py-2 sm:grid-cols-5">
              {STAT_LABELS.map(([key, label]) => (
                <div key={key} className="py-2">
                  <dt className="text-caption text-text-subtle">{label}</dt>
                  <dd className="text-title-3 font-semibold tabular-nums">{stats ? stats[key] : "–"}</dd>
                </div>
              ))}
            </dl>
            <p className="text-footnote text-text-subtle">Compté sur les fichiers réels du projet, à chaque ouverture.</p>
          </section>

          <section aria-labelledby="mc-check" className="space-y-3">
            <h2 id="mc-check" className="text-title-3 font-semibold">
              Vérification
            </h2>
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface-1 px-4 py-3">
              {report && report.errors > 0 ? (
                <XCircle size={16} className="text-danger" />
              ) : report && report.warnings > 0 ? (
                <AlertTriangle size={16} className="text-warning" />
              ) : (
                <CheckCircle2 size={16} className={report ? "text-success" : "text-text-subtle"} />
              )}
              <p className="min-w-0 flex-1 text-body-sm">
                {problemsSummary(report)}
                <span className="block text-footnote text-text-subtle">
                  JSON, TOML, textures, références et format de Minecraft {v.minecraft}, sans compiler.
                </span>
              </p>
              <Button size="sm" onClick={onShowProblems} icon={<ListChecks size={14} />}>
                Voir les problèmes
              </Button>
            </div>
          </section>

          <VersionsSection project={project} busy={running} />
        </div>

        <aside className="space-y-6">
          <section aria-labelledby="mc-identity" className="space-y-2">
            <h2 id="mc-identity" className="text-body-sm font-semibold">
              Projet
            </h2>
            <dl className="divide-y divide-border rounded-md border border-border bg-surface-1 px-3">
              <Fact label="Minecraft">{v.minecraft}</Fact>
              <Fact label="Loader">{LOADER_LABEL[v.loader]}</Fact>
              <Fact label="Gradle" mono>
                {v.gradle}
              </Fact>
              <Fact label="Package" mono>
                {meta.package}
              </Fact>
              <Fact label="Licence">{meta.license === "mit" ? "MIT" : "Tous droits réservés"}</Fact>
              <Fact label="Créé">{ago(meta.createdAt)}</Fact>
            </dl>
            <Button size="sm" variant="ghost" icon={<FolderOpen size={12} />} onClick={() => void engineApi.revealPath(project.path)}>
              Afficher le dossier
            </Button>
          </section>

          <section aria-labelledby="mc-java" className="space-y-2">
            <h2 id="mc-java" className="text-body-sm font-semibold">
              Java
            </h2>
            {java?.install ? (
              <dl className="divide-y divide-border rounded-md border border-border bg-surface-1 px-3">
                <Fact label="Version">Java {java.install.major}</Fact>
                <Fact label="JDK" mono>
                  {java.install.path}
                </Fact>
                <Fact label="Choix">{meta.javaHome ? "Fixé pour ce projet" : "Automatique"}</Fact>
              </dl>
            ) : java ? (
              <div role="alert" className="space-y-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2">
                <p className="flex items-center gap-2 text-footnote font-medium">
                  <AlertTriangle size={14} className="text-warning" /> Aucun JDK compatible
                </p>
                <p className="text-footnote text-text-muted">{java.problem}</p>
                <JdkInstallCard
                  major={java.min}
                  exact={java.max === java.min}
                  onInstalled={() => void mcstudioApi.projectJava(project.id).then(applyJava).catch(() => undefined)}
                />
              </div>
            ) : (
              <div className="h-24 rounded-md border border-border bg-surface-1" aria-busy />
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => void chooseJdk()}>
                Choisir un JDK…
              </Button>
              {meta.javaHome && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void mcstudioApi
                      .setProjectJava(project.id, null)
                      .then(applyJava)
                      .catch((e) => setError(errorText(e)))
                  }
                >
                  Revenir au choix automatique
                </Button>
              )}
            </div>
          </section>

          {error && (
            <p role="alert" className="text-footnote text-danger">
              {error}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
