import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ImageIcon, ImagePlus, Images, PlugZap, Plus, Trash2, UserRound } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Button, EmptyState, SectionHeader } from "@/design-system/primitives";
import type { ImageProjectSummary } from "@/core/ipc/bindings/ImageProjectSummary";
import { usable } from "../lib/capabilities";
import { PROVIDER_NAMES, PROVIDERS, ago, stateLook } from "../lib/format";
import { useImageMaker } from "../store";
import { StateDot } from "./ModelPicker";
import { checker, focusRing } from "./ui";

const EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff"];

export async function pickImages() {
  const picked = await openDialog({
    multiple: true,
    title: "Importer des images",
    filters: [{ name: "Images", extensions: EXTENSIONS }],
  });
  const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
  if (paths.length > 0) await useImageMaker.getState().importPaths(paths);
}

function ProjectTile({ project }: { project: ImageProjectSummary }) {
  const [confirm, setConfirm] = useState(false);
  const { openProject, deleteProject } = useImageMaker.getState();
  return (
    <li className="group relative">
      <button
        type="button"
        onClick={() => void openProject(project.id)}
        className={cn("block w-full overflow-hidden rounded-lg border border-border bg-surface-1 text-left transition-colors hover:border-border-strong", focusRing)}
      >
        <div className={cn("relative aspect-[4/3] w-full", checker)}>
          {project.cover ? (
            <img src={convertFileSrc(project.cover)} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-text-subtle">
              <ImageIcon size={28} strokeWidth={1.25} />
            </div>
          )}
        </div>
        <div className="space-y-0.5 px-3 py-2.5">
          <p className="truncate text-body-sm font-medium text-text">{project.name}</p>
          <p className="text-footnote text-text-subtle">
            {project.images} version{project.images > 1 ? "s" : ""} · {ago(project.updatedAt)}
          </p>
        </div>
      </button>
      <button
        type="button"
        aria-label={confirm ? `Confirmer : mettre « ${project.name} » à la Corbeille` : `Mettre « ${project.name} » à la Corbeille`}
        onClick={() => (confirm ? void deleteProject(project.id) : setConfirm(true))}
        onBlur={() => setConfirm(false)}
        className={cn(
          "glass absolute right-2 top-2 flex h-7 items-center gap-1 rounded-full px-2 text-footnote transition-opacity",
          confirm ? "text-danger opacity-100" : "text-text-muted opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
          focusRing,
        )}
      >
        <Trash2 size={14} />
        {confirm && "Confirmer"}
      </button>
    </li>
  );
}

export function ProjectList() {
  const projects = useImageMaker((s) => s.projects);
  const loaded = useImageMaker((s) => s.projectsLoaded);
  const statuses = useImageMaker((s) => s.statuses);
  const { createProject, set } = useImageMaker.getState();
  const connected = PROVIDERS.filter((p) => usable(statuses[p]?.state));

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <SectionHeader
        title="Image Maker"
        description="Créer, retoucher et agrandir des images avec l'IA, sans jamais perdre l'original."
        actions={
          <>
            <Button icon={<UserRound size={14} />} onClick={() => set({ dialog: "account" })}>
              Avec votre compte
            </Button>
            <Button icon={<Images size={14} />} onClick={() => void pickImages()}>
              Importer
            </Button>
            <Button variant="primary" icon={<Plus size={14} />} onClick={() => void createProject("")}>
              Nouveau projet
            </Button>
          </>
        }
      />

      <button
        type="button"
        onClick={() => set({ dialog: "connections" })}
        className={cn(
          "mb-8 flex w-full flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-surface-1 px-4 py-3 text-left transition-colors hover:border-border-strong",
          focusRing,
        )}
      >
        <PlugZap size={16} className={connected.length > 0 ? "text-success" : "text-warning"} />
        {PROVIDERS.map((p) => (
          <span key={p} className="flex items-center gap-1.5 text-footnote text-text-muted">
            <StateDot provider={p} />
            {PROVIDER_NAMES[p]}
            <span className="text-text-subtle">{stateLook(statuses[p]).label}</span>
          </span>
        ))}
        <span className="ml-auto text-footnote font-medium text-accent">
          {connected.length > 0 ? "Gérer les connexions" : "Ajouter une clé ou un compte"}
        </span>
      </button>

      {!loaded ? (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4" aria-hidden>
          {[0, 1, 2].map((i) => (
            <li key={i} className="aspect-[4/3.9] animate-pulse rounded-lg bg-surface-1" />
          ))}
        </ul>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={<ImagePlus size={32} strokeWidth={1.25} />}
          title="Aucun projet pour l'instant"
          description="Décrivez une image à créer, ou glissez des images depuis l'Explorateur : chaque retouche devient une version, l'original reste intact."
          action={
            <Button icon={<Images size={14} />} onClick={() => void pickImages()}>
              Importer des images
            </Button>
          }
        />
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
          {projects.map((project) => (
            <ProjectTile key={project.id} project={project} />
          ))}
        </ul>
      )}
    </div>
  );
}
