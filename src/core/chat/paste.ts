import type { ClipboardEvent as ReactClipboardEvent } from "react";
import { invokeCore } from "@/core/ipc";

/** Au-delà, une image collée se joint plutôt depuis l'Explorateur (même limite que le backend). */
const MAX_BYTES = 50 * 1024 * 1024;

type Paste = ClipboardEvent | ReactClipboardEvent;

export function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Chemins des fichiers copiés dans l'Explorateur (vide sinon, ou hors Windows). */
export function clipboardFilePaths(): Promise<string[]> {
  return invokeCore<string[]>("clipboard_file_paths").catch(() => []);
}

/**
 * Fichiers d'un Ctrl+V, en chemins : ceux copiés dans l'Explorateur (leurs vrais chemins,
 * lus par le backend), sinon les images copiées ailleurs, enregistrées dans le dossier
 * `pasted/` de l'application.
 *
 * Renvoie `null` pour un collage de texte ordinaire (rien n'est intercepté). À appeler
 * pendant l'événement : le collage par défaut est empêché dès qu'il contient des fichiers.
 */
export function pastedFiles(event: Paste): Promise<string[]> | null {
  const data = event.clipboardData;
  if (!data) return null;
  const files = [...data.files];
  if (files.length === 0 && data.getData("text/plain")) return null;
  if (files.length > 0) event.preventDefault();
  return (async () => {
    // Fichiers de l'Explorateur : le navigateur n'en donne pas le chemin, Windows oui.
    const paths = await clipboardFilePaths();
    if (paths.length > 0) return paths;
    const saved: string[] = [];
    for (const file of files) {
      if (file.size > MAX_BYTES) throw new Error(`« ${file.name} » est trop lourd pour un collage : joignez-le depuis l'Explorateur.`);
      saved.push(await invokeCore<string>("clipboard_save_file", { name: file.name, data: await readAsDataUrl(file) }));
    }
    return saved;
  })();
}

/**
 * Gestionnaire `onPaste` pour une zone de saisie qui accepte des fichiers : le texte se colle
 * normalement, les fichiers arrivent dans `onPaths`.
 */
export function onPasteFiles(onPaths: (paths: string[]) => void, onError?: (message: string) => void) {
  return (event: ReactClipboardEvent) => {
    const pending = pastedFiles(event);
    if (!pending) return;
    pending.then(
      (paths) => paths.length > 0 && onPaths(paths),
      (error: unknown) => onError?.(error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? error)),
    );
  };
}
