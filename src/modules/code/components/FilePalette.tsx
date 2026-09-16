import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { AnimatePresence, motion } from "motion/react";
import { File as FileIcon, Loader2 } from "lucide-react";
import { popIn } from "@/design-system/motion";
import { codeApi, type FileEntry } from "../api";

type Props = {
  open: boolean;
  root: string;
  onClose: () => void;
  onPick: (entry: FileEntry) => void;
};

/** Palette de fichiers (Ctrl+P), façon « Go to File » de VS Code. */
export function FilePalette({ open, root, onClose, onPick }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    const timer = setTimeout(() => {
      codeApi
        .searchFiles(root, query, 60)
        .then((entries) => alive && setResults(entries))
        .catch(() => alive && setResults([]))
        .finally(() => alive && setLoading(false));
    }, 120);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, query, root]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const relative = (path: string) =>
    path.startsWith(root) ? path.slice(root.length).replace(/^[\\/]/, "") : path;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center bg-scrim pt-[14vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            variants={popIn}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={(event) => event.stopPropagation()}
            className="glass w-[600px] overflow-hidden rounded-xl"
          >
            <Command label="Aller au fichier" shouldFilter={false}>
              <div className="flex items-center border-b border-border pr-3">
                <Command.Input
                  autoFocus
                  value={query}
                  onValueChange={setQuery}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") onClose();
                  }}
                  placeholder="Nom de fichier…"
                  className="h-12 flex-1 bg-transparent px-4 text-body text-text outline-none placeholder:text-text-subtle"
                />
                {loading && <Loader2 size={14} className="animate-spin text-text-subtle" />}
              </div>
              <Command.List className="max-h-[360px] overflow-y-auto p-2">
                {!loading && results.length === 0 && (
                  <p className="px-3 py-6 text-center text-body-sm text-text-subtle">
                    Aucun fichier.
                  </p>
                )}
                {results.map((entry) => (
                  <Command.Item
                    key={entry.path}
                    value={entry.path}
                    onSelect={() => {
                      onPick(entry);
                      onClose();
                    }}
                    className="flex h-9 cursor-pointer items-center gap-2.5 rounded-sm px-2 text-body-sm text-text-muted data-[selected=true]:bg-surface-2 data-[selected=true]:text-text"
                  >
                    <FileIcon size={14} strokeWidth={1.75} className="shrink-0" />
                    <span className="shrink-0">{entry.name}</span>
                    <span className="truncate text-footnote text-text-subtle">
                      {relative(entry.path)}
                    </span>
                  </Command.Item>
                ))}
              </Command.List>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
