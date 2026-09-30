import { ArrowLeft, BookOpen, Boxes, History, LayoutDashboard, ListChecks, ScrollText, Settings2, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Badge, ResizeHandle, usePanelSize } from "@/design-system/primitives";
import { DIMENSION, ENGINE_LABEL, MODE, shortVersion } from "../../lib/labels";
import { useGameStudioStore, type SectionId } from "../../store";
import { EnvironmentPanel } from "../EnvironmentPanel";
import { ErrorLine, focusRing } from "../ui";
import { CapabilitiesTable } from "./CapabilitiesTable";
import { Dashboard } from "./Dashboard";
import { DesignSection } from "./DesignSection";
import { HistorySection } from "./HistorySection";
import { JournalSection } from "./JournalSection";
import { SettingsSection } from "./SettingsSection";
import { SystemsSection } from "./SystemsSection";
import { TasksSection } from "./TasksSection";

type SectionInfo = { id: SectionId; label: string; description: string; icon: LucideIcon; wide?: boolean };

export const SECTIONS: { title: string; items: SectionInfo[] }[] = [
  {
    title: "Projet",
    items: [
      { id: "dashboard", label: "Tableau de bord", description: "Où en est le jeu, et la prochaine étape.", icon: LayoutDashboard },
      { id: "design", label: "Conception", description: "Idée, hypothèses, décisions, monde, réseau, feuille de route et guide de style.", icon: BookOpen },
      { id: "systems", label: "Systèmes", description: "Les systèmes du jeu, leurs dépendances et ce qui les utilise.", icon: Boxes, wide: true },
      { id: "tasks", label: "Tâches", description: "Le plan de travail : qui fait quoi, dans quel ordre, et comment le vérifier.", icon: ListChecks },
    ],
  },
  {
    title: "Suivi",
    items: [
      { id: "history", label: "Historique", description: "Points de restauration, versions du jeu et modifications tracées.", icon: History },
      { id: "journal", label: "Journal", description: "Tout ce qui s'est passé, classé par catégorie.", icon: ScrollText },
    ],
  },
  {
    title: "Environnement",
    items: [
      { id: "tools", label: "Outils", description: "Moteurs, Blender, Git et SDK de la machine, et ce que le moteur du projet permet vraiment.", icon: Wrench },
      { id: "settings", label: "Réglages", description: "Nom, moteur, ambition, liberté des agents, plateformes et budget de performance.", icon: Settings2 },
    ],
  },
];

const ALL = SECTIONS.flatMap((g) => g.items);

function Content({ id }: { id: SectionId }) {
  switch (id) {
    case "dashboard":
      return <Dashboard />;
    case "design":
      return <DesignSection />;
    case "systems":
      return <SystemsSection />;
    case "tasks":
      return <TasksSection />;
    case "history":
      return <HistorySection />;
    case "journal":
      return <JournalSection />;
    case "tools":
      return (
        <div className="space-y-8">
          <CapabilitiesTable />
          <EnvironmentPanel />
        </div>
      );
    case "settings":
      return <SettingsSection />;
  }
}

/** Espace de travail d'un projet : sections à gauche, contenu à droite. */
export function Workspace() {
  const current = useGameStudioStore((s) => s.current);
  const section = useGameStudioStore((s) => s.section);
  const go = useGameStudioStore((s) => s.go);
  const open = useGameStudioStore((s) => s.open);
  const error = useGameStudioStore((s) => s.error);
  const clearError = useGameStudioStore((s) => s.clearError);
  const [navWidth, setNavWidth] = usePanelSize("game-studio.nav", 216, 180, 300);
  const info = ALL.find((s) => s.id === section) ?? ALL[0]!;

  if (!current) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        {error ? (
          <div className="max-w-md space-y-3">
            <ErrorLine message={error} onClose={clearError} />
            <button type="button" onClick={() => void open(null)} className={cn("cursor-pointer text-footnote text-text-muted hover:text-text", focusRing)}>
              Revenir aux jeux
            </button>
          </div>
        ) : (
          <p className="text-footnote text-text-subtle">Ouverture du projet…</p>
        )}
      </div>
    );
  }
  const { project } = current;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <button
          type="button"
          onClick={() => void open(null)}
          className={cn("inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-sm px-2 text-footnote text-text-muted hover:bg-surface-2 hover:text-text", focusRing)}
        >
          <ArrowLeft size={14} /> Jeux
        </button>
        <div className="h-4 w-px bg-border" aria-hidden />
        <h1 className="min-w-0 truncate text-body font-semibold">{project.name}</h1>
        <Badge tone="neutral">
          {project.engine ? ENGINE_LABEL[project.engine] : "Sans moteur"}
          {project.engineVersion ? ` ${shortVersion(project.engineVersion)}` : ""}
        </Badge>
        <Badge tone="neutral">{DIMENSION[project.dimension]}</Badge>
        <span className="hidden text-caption text-text-subtle md:inline">{MODE[project.mode].label}</span>
        <span className="ml-auto font-mono text-caption text-text-muted">v{project.version}</span>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Sections du projet" style={{ width: navWidth }} className="shrink-0 overflow-y-auto border-r border-border px-2 py-4">
          {SECTIONS.map((group) => (
            <div key={group.title} className="pb-4">
              <p className="pb-1 pl-2.5 text-caption font-medium text-text-subtle">{group.title}</p>
              <ul className="space-y-px">
                {group.items.map(({ id, label, icon: Icon }) => (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => go(id)}
                      aria-current={section === id ? "page" : undefined}
                      className={cn(
                        "flex h-8 w-full cursor-pointer items-center gap-2 rounded-sm px-2.5 text-left text-body-sm transition-colors duration-[80ms]",
                        focusRing,
                        section === id ? "bg-surface-2 font-medium text-text" : "text-text-muted hover:bg-surface-1 hover:text-text",
                      )}
                    >
                      <Icon size={15} strokeWidth={1.75} className="shrink-0" aria-hidden />
                      <span className="truncate">{label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <ResizeHandle size={navWidth} onResize={setNavWidth} panel="before" label="Largeur de la liste des sections" defaultSize={216} />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className={cn("mx-auto px-8 py-8", info.wide ? "max-w-[1400px]" : "max-w-[960px]")}>
            <header className="pb-6">
              <h2 className="text-title-1 font-semibold tracking-[-0.015em]">{info.label}</h2>
              <p className="text-body text-text-muted">{info.description}</p>
            </header>
            {error && (
              <div className="pb-4">
                <ErrorLine message={error} onClose={clearError} />
              </div>
            )}
            <Content id={section} />
          </div>
        </main>
      </div>
    </div>
  );
}
