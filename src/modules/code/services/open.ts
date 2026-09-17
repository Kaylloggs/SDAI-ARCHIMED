import { useUiStore } from "@/core/stores/ui.store";

/**
 * Service `code.open` : ouvrir un fichier ou un dossier dans le module Code depuis un autre
 * module (liens de fichiers des réponses d'IA). Contrat côté consommateur : `CodeOpenService`.
 */
export function openInCode(target: { path: string; isDir: boolean; root: string }): void {
  useUiStore.getState().openModule("code", {
    cwd: target.root,
    ...(target.isDir ? {} : { file: target.path }),
  });
}
