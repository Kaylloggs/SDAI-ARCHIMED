import { useState, type MouseEvent } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  Copy,
  FolderOpen,
  FolderX,
  MoreHorizontal,
  Pickaxe,
  Plus,
  Trash2,
  XCircle,
} from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Badge, Button, ContextMenu, EmptyState, SectionHeader, type ContextMenuItem } from "@/design-system/primitives";
import type { BuildRecord } from "@/core/ipc/bindings/BuildRecord";
import type { ImportPreview } from "@/core/ipc/bindings/ImportPreview";
import type { ProjectSummary } from "@/core/ipc/bindings/ProjectSummary";
import { errorText, mcstudioApi } from "../api";
import { ago, LOADER_LABEL } from "../lib/format";
import { useMcStudioStore } from "../store";
import { EnvironmentPanel } from "./EnvironmentPanel";
import { focusRing, ModIcon } from "./ui";

function BuildBadge({ record }: { record: BuildRecord | null }) {
  if (!record) return <span className="text-footnote text-text-subtle">Jamais compilé</span>;
  const look = {
    success: { Icon: CheckCircle2, tone: "text-success", label: "Compilé" },
    failed: { Icon: XCircle, tone: "text-danger", label: "Échec" },
    cancelled: { Icon: CircleSlash, tone: "text-text-subtle", label: "Interrompu" },
  }[record.status];
  return (
    <span className="inline-flex items-center gap-1 text-footnote text-text-muted">
      <look.Icon size={14} strokeWidth={1.75} className={look.tone} />
      {look.label} {ago(record.startedAt)}
    </span>
  );
}

function ProjectRow({
  project,
  onError,
}: {
  project: ProjectSummary;
  onError: (message: string) => void;
}) {
  const { open, upsert, forget } = useMcStudioStore.getState();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [busy, setBusy] = useState(false);
  const iconVersion = useMcStudioStore((s) => s.iconRevision[project.id] ?? 0);
  const meta = project.meta;
  const usable = project.health === "ok" && meta;

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      onError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const items: ContextMenuItem[] = [
    {
      id: "duplicate",
      label: "Dupliquer",
      icon: <Copy size={14} />,
      hint: "Copie sans builds ni caches",
      disabled: !usable,
      onSelect: () => void run(async () => upsert(await mcstudioApi.duplicateProject(project.id))),
    },
    {
      id: "remove",
      label: "Retirer de la liste",
      icon: <FolderX size={14} />,
      hint: "Les fichiers restent sur le disque",
      onSelect: () =>
        void run(async () => {
          await mcstudioApi.removeProject(project.id, false);
          forget(project.id);
        }),
    },
    { id: "sep", separator: true },
    {
      id: "trash",
      label: "Mettre à la Corbeille…",
      icon: <Trash2 size={14} />,
      danger: true,
      disabled: project.health === "missing",
      onSelect: () => setConfirmTrash(true),
    },
  ];

  const openMenu = (event: MouseEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setMenu({ x: box.left, y: box.bottom + 4 });
  };

  return (
    <li
      className="group border-b border-border last:border-b-0"
      onContextMenu={(event) => {
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <div className="flex items-center gap-4 px-4 py-3">
        {meta ? (
          <ModIcon root={project.path} modId={meta.modId} name={meta.name} version={iconVersion} />
        ) : (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-warning">
            <AlertTriangle size={16} strokeWidth={1.75} />
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-body font-medium">{meta?.name ?? project.path}</p>
            {meta && <span className="shrink-0 font-mono text-footnote text-text-subtle">{meta.modId}</span>}
          </div>
          {usable ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Badge>{LOADER_LABEL[meta.versions.loader]}</Badge>
              <Badge>Minecraft {meta.versions.minecraft}</Badge>
              <span className="text-footnote text-text-subtle">Modifié {ago(project.updatedAt)}</span>
              <BuildBadge record={project.lastBuild} />
            </div>
          ) : (
            <p className="text-footnote text-warning">
              {project.health === "missing"
                ? `Dossier introuvable : ${project.path}`
                : "project.json illisible : le projet semble corrompu."}
            </p>
          )}
        </div>
        <Button variant={usable ? "secondary" : "ghost"} disabled={!usable || busy} onClick={() => open(project.id)}>
          Ouvrir
        </Button>
        <button
          type="button"
          aria-label={`Actions pour ${meta?.name ?? "ce projet"}`}
          aria-haspopup="menu"
          onClick={openMenu}
          className={cn(
            "flex size-8 items-center justify-center rounded-md text-text-subtle transition-colors hover:bg-surface-2 hover:text-text",
            focusRing,
          )}
        >
          <MoreHorizontal size={16} />
        </button>
      </div>

      {confirmTrash && (
        <div role="alert" className="mx-4 mb-3 flex flex-wrap items-center gap-3 rounded-md border border-danger/40 bg-danger-soft px-3 py-2">
          <Trash2 size={14} className="text-danger" />
          <p className="flex-1 text-footnote">
            Le dossier <span className="selectable font-mono">{project.path}</span> part à la Corbeille (récupérable depuis
            Windows).
          </p>
          <Button size="sm" variant="ghost" onClick={() => setConfirmTrash(false)}>
            Annuler
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await mcstudioApi.removeProject(project.id, true);
                forget(project.id);
              })
            }
          >
            Confirmer la mise à la Corbeille
          </Button>
        </div>
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={items} label={`Actions du projet`} onClose={() => setMenu(null)} />
      )}
    </li>
  );
}

/** Ce que l'examen d'un projet existant a trouvé, à confirmer avant l'import. */
function ImportCard({
  preview,
  busy,
  onCancel,
  onImport,
}: {
  preview: ImportPreview;
  busy: boolean;
  onCancel: () => void;
  onImport: () => void;
}) {
  const rows: [string, string][] = preview.problem
    ? []
    : [
        ["Mod", `${preview.name} (${preview.modId}) · ${preview.modVersion}`],
        ["Minecraft", `${preview.minecraft} · ${preview.loader ? LOADER_LABEL[preview.loader] : "?"} ${preview.loaderVersion}`],
        ["Paquet", preview.mainClass ? `${preview.package}.${preview.mainClass}` : preview.package],
        ...(preview.mappingsVersion ? ([["Yarn", preview.mappingsVersion]] as [string, string][]) : []),
        ...(preview.gradle ? ([["Gradle", preview.gradle]] as [string, string][]) : []),
      ];
  return (
    <section
      aria-label="Importer un projet existant"
      className={cn("mb-4 space-y-3 rounded-lg border bg-surface-1 px-4 py-3", preview.problem ? "border-danger/40" : "border-border")}
    >
      <div>
        <p className="text-body-sm font-medium">{preview.problem ? "Import impossible" : "Importer ce projet ?"}</p>
        <p className="selectable truncate font-mono text-caption text-text-subtle" title={preview.path}>
          {preview.path}
        </p>
      </div>
      {preview.problem ? (
        <p className="text-footnote text-danger">{preview.problem}</p>
      ) : (
        <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1 text-footnote">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-text-subtle">{label}</dt>
              <dd className="selectable truncate font-mono text-text-muted">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {preview.notes.map((note) => (
        <p key={note} className="text-caption text-warning">
          {note}
        </p>
      ))}
      {!preview.problem && (
        <p className="text-caption text-text-subtle">
          Seul <span className="font-mono">.mcstudio/project.json</span> est ajouté ; les fichiers du projet ne sont pas
          modifiés.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {preview.problem ? "Fermer" : "Annuler"}
        </Button>
        {!preview.problem && (
          <Button size="sm" variant="primary" disabled={busy} onClick={onImport}>
            Importer
          </Button>
        )}
      </div>
    </section>
  );
}

export function ProjectList({ onCreate }: { onCreate: () => void }) {
  const projects = useMcStudioStore((s) => s.projects);
  const loaded = useMcStudioStore((s) => s.loaded);
  const loadError = useMcStudioStore((s) => s.error);
  const [error, setError] = useState<string | null>(null);

  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importing, setImporting] = useState(false);

  /** Un projet Mod Studio s'ouvre ; un autre projet de mod est d'abord examiné. */
  const openExisting = async () => {
    const folder = await openDialog({ directory: true, title: "Ouvrir ou importer un projet de mod" });
    if (typeof folder !== "string") return;
    setError(null);
    setPreview(null);
    try {
      const found = await mcstudioApi.inspectImport(folder);
      if (found.existing) {
        useMcStudioStore.getState().upsert(await mcstudioApi.openProject(folder));
      } else {
        setPreview(found);
      }
    } catch (e) {
      setError(errorText(e));
    }
  };

  const confirmImport = async () => {
    if (!preview) return;
    setImporting(true);
    try {
      useMcStudioStore.getState().upsert(await mcstudioApi.importProject(preview.path));
      setPreview(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setImporting(false);
    }
  };

  const shownError = error ?? loadError;

  return (
    <div className="mx-auto max-w-[960px] px-8 py-8">
      <SectionHeader
        title="Mod Studio"
        description="De vrais projets Fabric, Forge et NeoForge : générés, compilés par Gradle, prêts à tester."
        actions={
          <>
            <Button
              onClick={() => void openExisting()}
              icon={<FolderOpen size={14} strokeWidth={1.75} />}
              title="Un projet Mod Studio, ou un projet Fabric, Forge ou NeoForge existant à importer"
            >
              Ouvrir ou importer
            </Button>
            <Button variant="primary" onClick={onCreate} icon={<Plus size={14} strokeWidth={2} />}>
              Nouveau projet
            </Button>
          </>
        }
      />

      <EnvironmentPanel />

      {preview && (
        <ImportCard preview={preview} busy={importing} onCancel={() => setPreview(null)} onImport={() => void confirmImport()} />
      )}

      {shownError && (
        <p role="alert" className="mb-4 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-footnote">
          {shownError}
        </p>
      )}

      {!loaded ? (
        <div aria-busy className="overflow-hidden rounded-lg border border-border">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-b-0">
              <div className="size-10 rounded-md bg-surface-2" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-48 rounded-xs bg-surface-2" />
                <div className="h-3 w-72 rounded-xs bg-surface-1" />
              </div>
            </div>
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="rounded-lg border border-border">
          <EmptyState
            icon={<Pickaxe size={28} strokeWidth={1.5} />}
            title="Aucun projet de mod"
            description="Un projet Mod Studio est un vrai dossier Gradle. Choisissez la version de Minecraft et le loader, Mod Studio écrit le reste."
            action={
              <Button variant="primary" onClick={onCreate} icon={<Plus size={14} strokeWidth={2} />}>
                Créer mon premier mod
              </Button>
            }
          />
        </div>
      ) : (
        <ul aria-label="Projets de mods" className="overflow-hidden rounded-lg border border-border bg-surface-1">
          {projects.map((project) => (
            <ProjectRow key={project.id} project={project} onError={setError} />
          ))}
        </ul>
      )}
    </div>
  );
}
