import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

/**
 * Fichiers déposés depuis l'explorateur Windows sur la fenêtre.
 * Hors Tauri (preview navigateur), le hook reste inerte.
 */
export function useOsFileDrop(onPaths: (paths: string[]) => void): boolean {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    try {
      void getCurrentWebview()
        .onDragDropEvent((event) => {
          if (event.payload.type === "over") setDragging(true);
          else if (event.payload.type === "leave") setDragging(false);
          else if (event.payload.type === "drop") {
            setDragging(false);
            const paths = event.payload.paths ?? [];
            if (paths.length > 0) onPaths(paths);
          }
        })
        .then((fn) => {
          if (cancelled) fn();
          else unlisten = fn;
        })
        .catch(() => undefined);
    } catch {
      // API indisponible hors Tauri
    }

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [onPaths]);

  return dragging;
}

/** Type de glisser (`@/core/dnd`) d'un fichier depuis l'arbre du module Code. */
export const FILE_DRAG_TYPE = "file";
