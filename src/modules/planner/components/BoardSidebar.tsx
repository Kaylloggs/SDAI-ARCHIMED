import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FileText, KanbanSquare, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Button } from "@/design-system/primitives";
import { usePlannerStore } from "../store";
import { progress } from "../lib/board";

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export function BoardSidebar() {
  const { boards, activeBoardId, setActive, createBoard, deleteBoard, renameBoard } = usePlannerStore();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [roadmapPath, setRoadmapPath] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const pickRoadmap = async () => {
    const selected = await open({
      title: "Lier un fichier roadmap",
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
    });
    if (typeof selected === "string") {
      setRoadmapPath(selected);
      if (!name.trim()) {
        const parts = selected.split(/[\\/]/).filter(Boolean);
        setName(parts.at(-2) ?? "Roadmap");
      }
    }
  };

  const submit = async () => {
    if (!name.trim() && !roadmapPath) return;
    const projectRoot = roadmapPath ? roadmapPath.replace(/[\\/](docs[\\/])?[^\\/]+$/i, "") : null;
    await createBoard({ name, roadmapPath, projectRoot });
    setCreating(false);
    setName("");
    setRoadmapPath(null);
  };

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-bg-subtle">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
        <span className="text-caption font-medium text-text-subtle">Tableaux</span>
        <Button size="sm" variant="ghost" aria-label="Nouveau tableau" onClick={() => setCreating((v) => !v)}>
          {creating ? <X size={14} strokeWidth={1.75} /> : <Plus size={14} strokeWidth={1.75} />}
        </Button>
      </div>

      {creating && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          className="space-y-2 border-b border-border p-3"
        >
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nom du tableau"
            className="h-8 w-full rounded-md border border-border bg-surface-1 px-2.5 text-body-sm outline-none placeholder:text-text-subtle focus:border-border-strong"
          />
          <button
            type="button"
            onClick={() => void pickRoadmap()}
            className={cn(
              "flex h-8 w-full items-center gap-2 rounded-md border px-2.5 text-left text-footnote transition-colors",
              roadmapPath
                ? "border-accent/40 bg-accent-soft text-accent"
                : "border-dashed border-border text-text-subtle hover:text-text-muted",
            )}
          >
            <FileText size={13} strokeWidth={1.75} className="shrink-0" />
            <span className="truncate">{roadmapPath ? fileName(roadmapPath) : "Lier un roadmap.md (optionnel)"}</span>
          </button>
          <p className="text-caption text-text-subtle">
            {roadmapPath
              ? "Les sections deviennent des colonnes ; cocher une carte met à jour le fichier."
              : "Sans roadmap : colonnes À faire / En cours / Terminé."}
          </p>
          <Button type="submit" variant="primary" size="sm" className="w-full">
            Créer
          </Button>
        </form>
      )}

      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {boards.map((board) => {
          const { done, total } = progress(board);
          const active = board.id === activeBoardId;
          return (
            <li key={board.id} className="group relative">
              {renaming === board.id ? (
                <input
                  autoFocus
                  defaultValue={board.name}
                  onBlur={(event) => {
                    renameBoard(board.id, event.target.value);
                    setRenaming(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                    if (event.key === "Escape") setRenaming(null);
                  }}
                  className="h-12 w-full rounded-sm border border-border-strong bg-surface-1 px-2 text-body-sm outline-none"
                />
              ) : (
                <button
                  onClick={() => setActive(board.id)}
                  onDoubleClick={() => setRenaming(board.id)}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "w-full rounded-sm px-2 py-2 text-left transition-colors",
                    active ? "bg-accent-soft" : "hover:bg-surface-2",
                  )}
                >
                  <span className="flex items-center gap-2 pr-6">
                    {board.roadmapPath ? (
                      <FileText size={13} strokeWidth={1.75} className="shrink-0 text-accent" />
                    ) : (
                      <KanbanSquare size={13} strokeWidth={1.75} className="shrink-0 text-text-subtle" />
                    )}
                    <span className={cn("truncate text-body-sm", active ? "text-text" : "text-text-muted")}>
                      {board.name}
                    </span>
                  </span>
                  <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-surface-3">
                    <span
                      className="block h-full rounded-full bg-accent transition-[width] duration-300"
                      style={{ width: total ? `${(done / total) * 100}%` : "0%" }}
                    />
                  </span>
                  <span className="mt-1 block text-caption text-text-subtle">
                    {done}/{total} tâche{total > 1 ? "s" : ""}
                  </span>
                </button>
              )}
              {renaming !== board.id && (
                <button
                  aria-label={confirmDelete === board.id ? `Confirmer la suppression de ${board.name}` : `Supprimer ${board.name}`}
                  onClick={() => {
                    if (confirmDelete === board.id) {
                      deleteBoard(board.id);
                      setConfirmDelete(null);
                    } else {
                      setConfirmDelete(board.id);
                      setTimeout(() => setConfirmDelete((id) => (id === board.id ? null : id)), 4000);
                    }
                  }}
                  className={cn(
                    "absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-xs transition-opacity",
                    confirmDelete === board.id
                      ? "bg-danger text-text opacity-100"
                      : "text-text-subtle opacity-0 hover:text-danger group-hover:opacity-100",
                  )}
                >
                  <Trash2 size={12} strokeWidth={1.75} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="border-t border-border px-3 py-1.5 text-caption text-text-subtle">
        Double-clic pour renommer.
      </p>
    </aside>
  );
}
