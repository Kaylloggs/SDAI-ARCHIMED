import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, CircleDot } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Badge } from "@/design-system/primitives";
import { pageFade } from "@/design-system/motion";
import type { JavaStatus } from "@/core/ipc/bindings/JavaStatus";
import type { ProjectSummary } from "@/core/ipc/bindings/ProjectSummary";
import { errorText, mcstudioApi } from "../../api";
import { LOADER_LABEL } from "../../lib/format";
import { useMcStudioStore } from "../../store";
import { focusRing, ModIcon } from "../ui";
import { BuildPanel } from "./BuildPanel";
import { unsavedCount, useEditorStore } from "../../editor";
import { AssistantPanel } from "./AssistantPanel";
import { Dashboard } from "./Dashboard";
import { FilesPanel } from "./FilesPanel";
import { TexturesPanel } from "./TexturesPanel";
import { ModelsPanel } from "./models/ModelsPanel";

type Tab = "dashboard" | "assistant" | "files" | "textures" | "models" | "build";
const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Tableau de bord" },
  { id: "assistant", label: "Assistant IA" },
  { id: "files", label: "Fichiers" },
  { id: "textures", label: "Textures" },
  { id: "models", label: "Modèles 3D" },
  { id: "build", label: "Build" },
];

function StatusBar({ project, java }: { project: ProjectSummary; java: JavaStatus | null }) {
  const session = useMcStudioStore((s) => s.builds[project.id]);
  const record = session?.record ?? project.lastBuild;
  const meta = project.meta;
  if (!meta) return null;
  const build = session?.running
    ? session.task === "runClient"
      ? { tone: "text-info", label: "Partie de test en cours" }
      : session.task === "runServer"
        ? { tone: "text-info", label: "Serveur de test en cours" }
      : { tone: "text-info", label: `Compilation${session.currentTask ? ` · ${session.currentTask}` : "…"}` }
    : record?.status === "success"
      ? { tone: "text-success", label: "Dernier build réussi" }
      : record?.status === "failed"
        ? { tone: "text-danger", label: "Dernier build en échec" }
        : { tone: "text-text-subtle", label: "Pas encore compilé" };
  const items = [
    `Minecraft ${meta.versions.minecraft}`,
    `${LOADER_LABEL[meta.versions.loader]} ${meta.versions.loaderVersion}`,
    java?.install ? `Java ${java.install.major}` : java ? "Java manquant" : "Java…",
    `Gradle ${meta.versions.gradle}`,
  ];
  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-border bg-bg-subtle px-4 text-footnote text-text-muted">
      <span className="inline-flex items-center gap-1.5" aria-live="polite">
        <CircleDot size={11} className={build.tone} />
        {build.label}
      </span>
      {items.map((item) => (
        <span key={item} className={cn("tabular-nums", item === "Java manquant" && "text-warning")}>
          {item}
        </span>
      ))}
    </footer>
  );
}

export function Workspace({ project }: { project: ProjectSummary }) {
  // Conversation rouverte depuis l'accueil : directement sur l'assistant.
  const [tab, setTab] = useState<Tab>(() =>
    useMcStudioStore.getState().focus?.projectId === project.id ? "assistant" : "dashboard",
  );
  const [java, setJava] = useState<JavaStatus | null>(null);
  const [javaError, setJavaError] = useState<string | null>(null);
  const iconVersion = useMcStudioStore((s) => s.iconRevision[project.id] ?? 0);
  const unsaved = useEditorStore((s) => unsavedCount(s.editors[project.id]));
  const meta = project.meta;

  useEffect(() => {
    let cancelled = false;
    mcstudioApi
      .projectJava(project.id)
      .then((status) => !cancelled && setJava(status))
      .catch((e) => !cancelled && setJavaError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  if (!meta) return null;

  const compile = () => {
    setTab("build");
    void useMcStudioStore.getState().startBuild(project.id, "build", false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-4 border-b border-border px-6 py-4">
        <button
          type="button"
          aria-label="Retour aux projets"
          onClick={() => useMcStudioStore.getState().open(null)}
          className={cn(
            "flex size-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text",
            focusRing,
          )}
        >
          <ArrowLeft size={16} />
        </button>
        <ModIcon root={project.path} modId={meta.modId} name={meta.name} version={iconVersion} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-title-2 font-semibold tracking-[-0.01em]">{meta.name}</h1>
          <p className="truncate font-mono text-footnote text-text-subtle">
            {meta.modId} · {meta.modVersion}
          </p>
        </div>
        <Badge>{LOADER_LABEL[meta.versions.loader]}</Badge>
        <Badge>Minecraft {meta.versions.minecraft}</Badge>
      </header>

      <div role="tablist" aria-label="Sections du projet" className="flex shrink-0 gap-1 border-b border-border px-6">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`mc-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`mc-panel-${id}`}
            onClick={() => setTab(id)}
            className={cn(
              "relative h-10 px-3 text-body-sm transition-colors",
              tab === id ? "text-text" : "text-text-muted hover:text-text",
              focusRing,
            )}
          >
            {label}
            {id === "files" && unsaved > 0 && (
              <span className="ml-1.5 inline-block size-1.5 rounded-full bg-accent align-middle" aria-label={`${unsaved} non enregistré(s)`} />
            )}
            {tab === id && (
              <motion.span layoutId="mc-tab-indicator" className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-accent" />
            )}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            role="tabpanel"
            id={`mc-panel-${tab}`}
            aria-labelledby={`mc-tab-${tab}`}
            variants={pageFade}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="h-full"
          >
            {tab === "dashboard" ? (
              <Dashboard
                project={project}
                java={java}
                javaError={javaError}
                onJavaChange={setJava}
                onCompile={compile}
                onShowProblems={() => {
                  useEditorStore.getState().showProblems(project.id, true);
                  setTab("files");
                }}
                onAskAssistant={(text) => {
                  useMcStudioStore.getState().setHandoff({ projectId: project.id, text });
                  setTab("assistant");
                }}
              />
            ) : tab === "assistant" ? (
              <AssistantPanel
                project={project}
                onBuild={() => void useMcStudioStore.getState().startBuild(project.id, "build", false)}
              />
            ) : tab === "files" ? (
              <FilesPanel project={project} />
            ) : tab === "textures" ? (
              <TexturesPanel project={project} />
            ) : tab === "models" ? (
              <ModelsPanel project={project} />
            ) : (
              <BuildPanel project={project} java={java} onJavaChange={setJava} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <StatusBar project={project} java={java} />
    </div>
  );
}
