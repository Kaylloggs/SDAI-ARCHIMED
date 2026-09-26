import { useEffect, useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { FileTree as Tree, type TreeChanges } from "@/core/editor";
import { cn } from "@/core/lib/cn";
import { Button } from "@/design-system/primitives";
import { codeApi, samePath, type FileEntry } from "../api";

type Props = {
  root: string;
  activePath: string | null;
  onOpenFile: (entry: FileEntry) => void;
  onChangeRoot: () => void;
  /** Largeur en pixels (redimensionnable par le parent). */
  width: number;
  /** Bascule fichiers / recherche, en tête de colonne. */
  switcher?: ReactNode;
  /** Masquée (vue Recherche) : reste montée pour garder l'arbre ouvert et surveillé. */
  hidden?: boolean;
};

/** Arborescence du projet : l'arbre partagé (`@/core/editor`), lu et surveillé par le backend Code. */
export function FileTree({ root, activePath, onOpenFile, onChangeRoot, width, switcher, hidden }: Props) {
  const [changes, setChanges] = useState<TreeChanges>({ dirs: [], revision: 0 });
  const [reloadKey, setReloadKey] = useState(0);

  // Mise à jour automatique : le projet est surveillé, chaque lot de changements relit
  // la racine et les dossiers ouverts concernés.
  useEffect(() => {
    void codeApi.watchRoot(root).catch(() => undefined);
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void codeApi
      .onFsChanged((change) => {
        if (!samePath(change.root, root)) return;
        setChanges((current) => ({ dirs: change.dirs, revision: current.revision + 1 }));
      })
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [root]);

  return (
    <aside style={{ width }} className={cn("flex shrink-0 flex-col bg-bg-subtle", hidden && "hidden")}>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border pl-2 pr-1">
        {switcher}
        <span className="truncate text-caption font-medium text-text-subtle" title={root}>
          {root.split(/[\\/]/).filter(Boolean).at(-1) ?? root}
        </span>
        <div className="ml-auto flex items-center">
          <Button
            size="sm"
            variant="ghost"
            aria-label="Rafraîchir"
            title="Rafraîchir (automatique)"
            onClick={() => setReloadKey((key) => key + 1)}
          >
            <RefreshCw size={13} strokeWidth={1.75} />
          </Button>
          <Button size="sm" variant="ghost" onClick={onChangeRoot}>
            Changer
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-1">
        <Tree
          root={root}
          list={codeApi.listDir}
          activePath={activePath}
          onOpenFile={(entry) => onOpenFile(entry as FileEntry)}
          changes={changes}
          reloadKey={reloadKey}
          draggable
          label="Fichiers du projet"
        />
      </div>

      <p className="shrink-0 border-t border-border px-3 py-1.5 text-caption text-text-subtle">
        Glissez un fichier vers le chat pour le cibler.
      </p>
    </aside>
  );
}
