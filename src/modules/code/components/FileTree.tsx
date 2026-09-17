import { useCallback, useEffect, useState } from "react";
import {
  ChevronRight,
  File as FileIcon,
  Folder,
  FolderOpen,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/core/lib/cn";
import { FILE_DRAG_TYPE } from "@/core/chat";
import { useDragSource } from "@/core/dnd";
import { Button } from "@/design-system/primitives";
import { codeApi, type FileEntry } from "../api";

type Props = {
  root: string;
  activePath: string | null;
  onOpenFile: (entry: FileEntry) => void;
  onChangeRoot: () => void;
};

type NodeProps = {
  entry: FileEntry;
  depth: number;
  activePath: string | null;
  onOpenFile: (entry: FileEntry) => void;
};

function FileNode({ entry, depth, activePath, onOpenFile }: NodeProps) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    if (!entry.isDir) {
      onOpenFile(entry);
      return;
    }
    const next = !open;
    setOpen(next);
    if (next && children === null) {
      setLoading(true);
      try {
        setChildren(await codeApi.listDir(entry.path));
      } catch {
        setChildren([]);
      } finally {
        setLoading(false);
      }
    }
  };

  const active = !entry.isDir && entry.path === activePath;
  const drag = useDragSource(entry.isDir ? null : { type: FILE_DRAG_TYPE, payload: entry.path, label: entry.name });

  return (
    <li>
      <div
        role="treeitem"
        aria-expanded={entry.isDir ? open : undefined}
        aria-selected={active}
        tabIndex={0}
        onPointerDown={drag.onPointerDown}
        onClick={() => void toggle()}
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
        <ul>
          {children.map((child) => (
            <FileNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              activePath={activePath}
              onOpenFile={onOpenFile}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function FileTree({ root, activePath, onOpenFile, onChangeRoot }: Props) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await codeApi.listDir(root));
      setError(null);
    } catch (e) {
      setError((e as { message?: string }).message ?? "Dossier illisible");
    } finally {
      setLoading(false);
    }
  }, [root]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <aside className="flex w-[clamp(180px,18%,264px)] shrink-0 flex-col border-r border-border bg-bg-subtle">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-3">
        <span className="truncate text-caption font-medium text-text-subtle" title={root}>
          {root.split(/[\\/]/).filter(Boolean).at(-1) ?? root}
        </span>
        <div className="ml-auto flex items-center">
          <Button size="sm" variant="ghost" aria-label="Rafraîchir" onClick={() => void load()}>
            <RefreshCw size={13} strokeWidth={1.75} />
          </Button>
          <Button size="sm" variant="ghost" onClick={onChangeRoot}>
            Changer
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-1">
        {loading ? (
          <div className="flex justify-center py-6 text-text-subtle">
            <Loader2 size={14} className="animate-spin" />
          </div>
        ) : error ? (
          <p className="px-3 py-2 text-footnote text-danger">{error}</p>
        ) : (
          <ul role="tree" aria-label="Fichiers du projet">
            {entries.map((entry) => (
              <FileNode
                key={entry.path}
                entry={entry}
                depth={0}
                activePath={activePath}
                onOpenFile={onOpenFile}
              />
            ))}
          </ul>
        )}
      </div>

      <p className="shrink-0 border-t border-border px-3 py-1.5 text-caption text-text-subtle">
        Glissez un fichier vers le chat pour le cibler.
      </p>
    </aside>
  );
}
