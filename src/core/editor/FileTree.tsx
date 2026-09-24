import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ChevronRight, File as FileIcon, Folder, FolderOpen, Loader2 } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { FILE_DRAG_TYPE } from "@/core/chat";
import { useDragSource } from "@/core/dnd";

export type TreeEntry = {
  name: string;
  path: string;
  isDir: boolean;
  /** Fichier ignoré (dépendances, builds) : affiché en retrait. */
  ignored?: boolean;
};

/** Changements sur disque : dossiers touchés, `revision` change à chaque lot. */
export type TreeChanges = { dirs: string[]; revision: number };

/** Comparaison de chemins Windows : casse et séparateurs ignorés. */
export const samePath = (a: string, b: string) =>
  a.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase() === b.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();

type Shared = {
  list: (path: string) => Promise<TreeEntry[]>;
  activePath: string | null;
  onOpenFile: (entry: TreeEntry) => void;
  onContextMenu?: (entry: TreeEntry, event: React.MouseEvent) => void;
  draggable: boolean;
};

const SharedContext = createContext<Shared | null>(null);
const ChangesContext = createContext<TreeChanges>({ dirs: [], revision: 0 });

function FileNode({ entry, depth }: { entry: TreeEntry; depth: number }) {
  const shared = useContext(SharedContext);
  const changes = useContext(ChangesContext);
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<TreeEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  // Dossier ouvert dont le contenu a changé sur disque : on le relit sans spinner.
  useEffect(() => {
    if (!shared || !entry.isDir || !open || children === null) return;
    if (!changes.dirs.some((dir) => samePath(dir, entry.path))) return;
    shared
      .list(entry.path)
      .then(setChildren)
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changes.revision]);

  const drag = useDragSource(
    shared?.draggable && !entry.isDir ? { type: FILE_DRAG_TYPE, payload: entry.path, label: entry.name } : null,
  );
  if (!shared) return null;

  const toggle = async () => {
    if (!entry.isDir) {
      shared.onOpenFile(entry);
      return;
    }
    const next = !open;
    setOpen(next);
    if (next && children === null) {
      setLoading(true);
      try {
        setChildren(await shared.list(entry.path));
      } catch {
        setChildren([]);
      } finally {
        setLoading(false);
      }
    }
  };

  const active = !entry.isDir && shared.activePath !== null && samePath(entry.path, shared.activePath);

  return (
    <li>
      <div
        role="treeitem"
        aria-expanded={entry.isDir ? open : undefined}
        aria-selected={active}
        tabIndex={0}
        onPointerDown={drag.onPointerDown}
        onClick={() => void toggle()}
        onContextMenu={
          shared.onContextMenu
            ? (event) => {
                event.preventDefault();
                shared.onContextMenu?.(entry, event);
              }
            : undefined
        }
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            void toggle();
          }
        }}
        style={{ paddingLeft: 6 + depth * 12 }}
        title={entry.path}
        className={cn(
          "flex h-7 cursor-pointer items-center gap-1.5 rounded-sm pr-2 text-body-sm transition-colors duration-[80ms]",
          active ? "bg-accent-soft text-text" : "text-text-muted hover:bg-surface-2 hover:text-text",
          entry.ignored && "opacity-50",
        )}
      >
        {entry.isDir ? (
          <>
            <ChevronRight
              size={12}
              strokeWidth={2}
              className={cn("shrink-0 text-text-subtle transition-transform", open && "rotate-90")}
            />
            {open ? (
              <FolderOpen size={13} strokeWidth={1.75} className="shrink-0 text-accent" />
            ) : (
              <Folder size={13} strokeWidth={1.75} className="shrink-0 text-text-subtle" />
            )}
          </>
        ) : (
          <>
            <span className="w-3 shrink-0" />
            <FileIcon size={13} strokeWidth={1.75} className="shrink-0 text-text-subtle" />
          </>
        )}
        <span className="truncate">{entry.name}</span>
        {loading && <Loader2 size={11} className="ml-auto animate-spin text-text-subtle" />}
      </div>

      {open && children && children.length > 0 && (
        <ul role="group">
          {children.map((child) => (
            <FileNode key={child.path} entry={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Arborescence de fichiers paresseuse (un dossier est lu à son ouverture), partagée par
 * les modules. La lecture passe par `list` : chaque module garde son propre backend.
 */
export function FileTree({
  root,
  list,
  activePath,
  onOpenFile,
  changes = { dirs: [], revision: 0 },
  reloadKey = 0,
  draggable = false,
  onContextMenu,
  label,
}: {
  root: string;
  /** Contenu d'un dossier (la racine comprise). */
  list: (path: string) => Promise<TreeEntry[]>;
  activePath: string | null;
  onOpenFile: (entry: TreeEntry) => void;
  changes?: TreeChanges;
  /** Change pour forcer une relecture complète (bouton Rafraîchir). */
  reloadKey?: number;
  /** Fichiers glissables vers le chat pour les cibler. */
  draggable?: boolean;
  /** Clic droit sur un fichier ou un dossier (renommer, supprimer…). */
  onContextMenu?: (entry: TreeEntry, event: React.MouseEvent) => void;
  label: string;
}) {
  const [entries, setEntries] = useState<TreeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (silent: boolean) => {
      if (!silent) setLoading(true);
      try {
        setEntries(await list(root));
        setError(null);
      } catch (e) {
        setError((e as { message?: string }).message ?? "Dossier illisible");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [root, list],
  );

  useEffect(() => {
    void load(false);
  }, [load, reloadKey]);

  useEffect(() => {
    if (changes.dirs.some((dir) => samePath(dir, root))) void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changes.revision]);

  if (loading) {
    return (
      <div className="flex justify-center py-6 text-text-subtle">
        <Loader2 size={14} className="animate-spin" />
      </div>
    );
  }
  if (error) return <p className="px-3 py-2 text-footnote text-danger">{error}</p>;

  return (
    <SharedContext.Provider value={{ list, activePath, onOpenFile, onContextMenu, draggable }}>
      <ChangesContext.Provider value={changes}>
        <ul role="tree" aria-label={label}>
          {entries.map((entry) => (
            <FileNode key={entry.path} entry={entry} depth={0} />
          ))}
        </ul>
      </ChangesContext.Provider>
    </SharedContext.Provider>
  );
}
