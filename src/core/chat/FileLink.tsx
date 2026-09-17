import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Code2, Copy, ExternalLink, FolderOpen } from "lucide-react";
import { engineApi, type ResolvedPath } from "@/core/engine/engine.api";
import { useService } from "@/core/modules";
import { ContextMenu, Tooltip, type ContextMenuItem } from "@/design-system/primitives";
import { cleanPathText, isAbsolutePath, pathCandidates } from "./paths";

/**
 * Service optionnel `code.open` (fourni par le module Code) : ouvrir un fichier ou un dossier
 * dans l'éditeur. Sans lui, les liens ouvrent l'application par défaut.
 */
export type CodeOpenService = {
  openInCode: (target: { path: string; isDir: boolean; root: string }) => void;
};

type Resolved = Map<string, ResolvedPath>;

const ResolvedPathsContext = createContext<{ resolved: Resolved; cwd: string | null }>({
  resolved: new Map(),
  cwd: null,
});

/** Résout une fois (message terminé) les chemins cités et les rend disponibles aux liens. */
export function ResolvedPathsProvider({
  text,
  cwd,
  enabled,
  children,
}: {
  text: string;
  cwd: string | null;
  enabled: boolean;
  children: ReactNode;
}) {
  const [resolved, setResolved] = useState<Resolved>(() => new Map());

  useEffect(() => {
    if (!enabled) return;
    const candidates = pathCandidates(text);
    if (candidates.length === 0) return;
    let cancelled = false;
    const hints = candidates.filter(isAbsolutePath);
    engineApi
      .resolvePaths(candidates, cwd, hints)
      .then((results) => {
        if (cancelled) return;
        const map: Resolved = new Map();
        results.forEach((result, index) => {
          const candidate = candidates[index];
          if (result && candidate) map.set(candidate, result);
        });
        setResolved(map);
      })
      .catch(() => undefined); // hors Tauri ou erreur disque : texte simple
    return () => {
      cancelled = true;
    };
  }, [text, cwd, enabled]);

  return <ResolvedPathsContext.Provider value={{ resolved, cwd }}>{children}</ResolvedPathsContext.Provider>;
}

export function useResolvedPath(raw: string): ResolvedPath | null {
  return useContext(ResolvedPathsContext).resolved.get(cleanPathText(raw)) ?? null;
}

const normalize = (path: string) => path.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();

function parentDir(path: string): string {
  const index = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return index > 0 ? path.slice(0, index) : path;
}

/**
 * Lien vers un fichier cité par l'IA.
 * Clic : ouvre dans Code (ou l'application par défaut). Clic droit : menu d'actions.
 */
export function FileLink({ target, children }: { target: ResolvedPath; children: ReactNode }) {
  const { cwd } = useContext(ResolvedPathsContext);
  const code = useService<CodeOpenService>("code.open");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const run = (action: () => Promise<void>) => {
    setError(null);
    action().catch((e: unknown) => setError((e as { message?: string }).message ?? String(e)));
  };

  const inCwd = cwd !== null && normalize(target.path).startsWith(`${normalize(cwd)}/`);
  const root = target.isDir ? target.path : inCwd && cwd ? cwd : parentDir(target.path);

  const openInCode = code ? () => code.openInCode({ path: target.path, isDir: target.isDir, root }) : null;
  const reveal = () => run(() => (target.isDir ? engineApi.openPath(target.path) : engineApi.revealPath(target.path)));
  const openDefault = () => run(() => engineApi.openPath(target.path));

  const primary = () => {
    if (openInCode) openInCode();
    else if (target.isDir) reveal();
    else openDefault();
  };

  const items: ContextMenuItem[] = [
    ...(openInCode
      ? [{ id: "code", label: target.isDir ? "Ouvrir le dossier dans Code" : "Ouvrir dans Code", icon: <Code2 size={14} strokeWidth={1.75} />, onSelect: openInCode }]
      : []),
    ...(!target.isDir
      ? [{ id: "default", label: "Ouvrir avec l'application par défaut", icon: <ExternalLink size={14} strokeWidth={1.75} />, onSelect: openDefault }]
      : []),
    {
      id: "reveal",
      label: target.isDir ? "Ouvrir dans l'Explorateur" : "Afficher dans l'Explorateur",
      icon: <FolderOpen size={14} strokeWidth={1.75} />,
      onSelect: reveal,
    },
    { id: "sep", separator: true },
    {
      id: "copy",
      label: "Copier le chemin",
      icon: <Copy size={14} strokeWidth={1.75} />,
      onSelect: () => run(() => navigator.clipboard.writeText(target.path)),
    },
  ];

  return (
    <>
      <Tooltip
        side="bottom"
        label={
          error ? (
            <span className="text-danger">{error}</span>
          ) : openInCode ? (
            "Ouvrir dans Code · clic droit : plus d'actions"
          ) : (
            "Ouvrir · clic droit : plus d'actions"
          )
        }
      >
        <button
          type="button"
        onClick={primary}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ x: event.clientX, y: event.clientY });
        }}
        className="cursor-pointer rounded-xs text-left decoration-accent/60 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent [&>code]:text-accent"
      >
        {children}
      </button>
      </Tooltip>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} label={target.path} onClose={closeMenu} />}
    </>
  );
}
