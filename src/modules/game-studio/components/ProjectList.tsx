import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { CheckCircle2, CircleSlash, FolderOpen, FolderPlus, FolderX, Gamepad2, Loader2, MoreHorizontal, Plus, XCircle } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Badge, Button, ContextMenu, EmptyState, SectionHeader, type ContextMenuItem } from "@/design-system/primitives";
import type { GameProjectSummary } from "@/core/ipc/bindings/GameProjectSummary";
import { errorText, gameStudioApi } from "../api";
import { ago, DIMENSION, ENGINE_LABEL, MODE, shortVersion } from "../lib/labels";
import { useGameStudioStore } from "../store";
import { EnvironmentPanel } from "./EnvironmentPanel";
import { ErrorLine, focusRing } from "./ui";

function BuildState({ project }: { project: GameProjectSummary }) {
  const status = project.lastBuild;
  if (!status) return <span className="text-footnote text-text-subtle">Jamais compilé</span>;
  const look = {
    success: { Icon: CheckCircle2, tone: "text-success", label: "Dernier build réussi" },
    failed: { Icon: XCircle, tone: "text-danger", label: "Dernier build en échec" },
    cancelled: { Icon: CircleSlash, tone: "text-text-subtle", label: "Dernier build interrompu" },
    running: { Icon: Loader2, tone: "text-info", label: "Build en cours" },
  }[status];
  return (
    <span className="inline-flex items-center gap-1 text-footnote text-text-muted">
      <look.Icon size={13} strokeWidth={1.75} className={look.tone} aria-hidden />
      {look.label}
    </span>
  );
}

function ProjectRow({ project, onError }: { project: GameProjectSummary; onError: (message: string) => void }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const open = useGameStudioStore((s) => s.open);
  const refresh = useGameStudioStore((s) => s.refresh);

  const items: ContextMenuItem[] = [
    {
      id: "reveal",
      label: "Afficher dans l'Explorateur",
      icon: <FolderOpen size={14} />,
      disabled: !project.available,
      onSelect: () => void revealItemInDir(project.root).catch((e) => onError(errorText(e))),
    },
    {
      id: "forget",
      label: "Retirer de la liste",
      icon: <FolderX size={14} />,
      hint: "Les fichiers restent sur le disque",
      onSelect: () =>
        void gameStudioApi
          .forget(project.id)
          .then(refresh)
          .catch((e) => onError(errorText(e))),
    },
  ];

  return (
    <li
      className="group border-b border-border last:border-b-0"
      onContextMenu={(event) => {
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <div className="flex items-center gap-2 pr-2">
        <button
          type="button"
          disabled={!project.available}
          onClick={() => void open(project.id)}
          className={cn(
            "flex min-w-0 flex-1 cursor-pointer items-center gap-4 rounded-md px-4 py-3 text-left transition-colors duration-[80ms] hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60",
            focusRing,
          )}
        >
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-text-muted" aria-hidden>
            <Gamepad2 size={18} strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-body font-medium">{project.name}</span>
              <Badge tone="neutral">{project.engine ? ENGINE_LABEL[project.engine] : "Sans moteur"}{project.engineVersion ? ` ${shortVersion(project.engineVersion)}` : ""}</Badge>
              {project.dimension && <Badge tone="neutral">{DIMENSION[project.dimension]}</Badge>}
              {project.mode && <span className="text-caption text-text-subtle">{MODE[project.mode].label}</span>}
              {!project.available && <Badge tone="warning">Dossier introuvable</Badge>}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-footnote text-text-muted">
              <span className="tabular-nums">{project.systems} systèmes</span>
              <span className="tabular-nums">{project.openTasks} tâches ouvertes</span>
              <BuildState project={project} />
              {project.lastOpened && <span className="text-text-subtle">Ouvert {ago(project.lastOpened)}</span>}
            </div>
            <p className="truncate font-mono text-caption text-text-subtle" title={project.root}>{project.root}</p>
          </div>
        </button>
        <button
          type="button"
          aria-label={`Actions sur ${project.name}`}
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            setMenu({ x: box.left, y: box.bottom + 4 });
          }}
          className={cn("flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-sm text-text-subtle opacity-0 transition-opacity hover:bg-surface-2 hover:text-text group-hover:opacity-100 focus-visible:opacity-100", focusRing)}
        >
          <MoreHorizontal size={16} />
        </button>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} label={`Actions sur ${project.name}`} onClose={() => setMenu(null)} />}
    </li>
  );
}

/** Accueil du module : les jeux, la création, l'import et l'état de la machine. */
export function ProjectList({ onCreate }: { onCreate: () => void }) {
  const projects = useGameStudioStore((s) => s.projects);
  const loaded = useGameStudioStore((s) => s.loaded);
  const refresh = useGameStudioStore((s) => s.refresh);
  const open = useGameStudioStore((s) => s.open);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const importExisting = async () => {
    const picked = await openDialog({ directory: true, multiple: false, title: "Dossier d'un projet Godot, Unity ou Unreal" });
    if (typeof picked !== "string") return;
    setImporting(true);
    try {
      const project = await gameStudioApi.importProject(picked);
      await refresh();
      await open(project.id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setImporting(false);
    }
  };

  const actions = (
    <>
      <Button variant="secondary" className="whitespace-nowrap" icon={importing ? <Loader2 size={14} className="animate-spin" /> : <FolderPlus size={14} />} disabled={importing} onClick={() => void importExisting()}>
        Ajouter un projet existant
      </Button>
      <Button variant="primary" className="whitespace-nowrap" icon={<Plus size={14} />} onClick={onCreate}>
        Nouveau jeu
      </Button>
    </>
  );

  return (
    <div className="mx-auto max-w-[960px] space-y-8 px-8 py-8">
      <SectionHeader
        title="Game Studio"
        description="Décrivez un jeu : Game Studio en tire les systèmes, l'architecture et le plan, crée le projet dans Godot, Unity ou Unreal, puis le construit avec vos agents."
        actions={actions}
      />
      <ErrorLine message={error} onClose={() => setError(null)} />

      {!loaded ? (
        <div className="space-y-2" aria-hidden>
          {[0, 1].map((i) => (
            <div key={i} className="h-[88px] animate-pulse rounded-lg bg-surface-1" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface-1">
          <EmptyState
            icon={<Gamepad2 size={28} strokeWidth={1.5} />}
            title="Aucun jeu pour l'instant"
            description="Commencez par une phrase (« un jeu de pêche relaxant avec une ville et des bateaux »), ou ajoutez un projet que vous avez déjà."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" icon={<Plus size={14} />} onClick={onCreate}>
                  Décrire un nouveau jeu
                </Button>
                <Button variant="secondary" icon={<FolderPlus size={14} />} onClick={() => void importExisting()}>
                  Ajouter un projet existant
                </Button>
              </div>
            }
          />
        </div>
      ) : (
        <ul aria-label="Jeux" className="rounded-lg border border-border bg-surface-1 p-1">
          {projects.map((project) => (
            <ProjectRow key={project.id} project={project} onError={setError} />
          ))}
        </ul>
      )}

      <section aria-label="Votre machine" className="space-y-3">
        <div className="space-y-0.5">
          <h2 className="text-title-3 font-semibold">Votre machine</h2>
          <p className="text-footnote text-text-muted">Moteurs trouvés sur cet ordinateur. Blender, Git et les SDK sont dans l'onglet Outils d'un projet.</p>
        </div>
        <EnvironmentPanel compact />
      </section>
    </div>
  );
}
