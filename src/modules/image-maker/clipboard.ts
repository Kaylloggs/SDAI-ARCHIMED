/** Presse-papiers : copier une version en PNG, coller une image depuis une autre application. */
import { convertFileSrc } from "@tauri-apps/api/core";
import type { ClipboardEvent as ReactClipboardEvent } from "react";
import { clipboardFilePaths, readAsDataUrl } from "@/core/chat";
import type { ImageNode } from "@/core/ipc/bindings/ImageNode";
import { useImageMaker } from "./store";

/** Le presse-papiers n'accepte que le PNG : les autres formats sont convertis au passage. */
async function asPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((png) => (png ? resolve(png) : reject(new Error("conversion PNG impossible"))), "image/png"),
  );
}

export async function copyImage(node: ImageNode): Promise<void> {
  const s = useImageMaker.getState();
  try {
    const response = await fetch(`${convertFileSrc(node.file)}?copy`);
    const png = await asPng(await response.blob());
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    s.notify("success", "Image copiée.");
  } catch {
    s.notify("warning", "Copie impossible : exportez l'image, ou glissez-la depuis l'historique.");
  }
}

export const IMAGE_FILE = /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i;

/** Nom d'une image collée, sans le « image.png » générique du navigateur. */
function pastedName(file: File): string {
  return file.name && file.name !== "image.png" ? file.name.replace(/\.[^.]+$/, "") : "";
}

/**
 * Colle les images du presse-papiers comme nouvelles versions du projet ouvert : images copiées
 * dans l'Explorateur (par leur chemin) ou copiées depuis une autre application.
 */
export async function pasteFrom(event: ClipboardEvent): Promise<boolean> {
  const data = event.clipboardData;
  const files = [...(data?.files ?? [])].filter((f) => f.type.startsWith("image/"));
  if (files.length === 0 && data?.getData("text/plain")) return false;
  if (files.length > 0) event.preventDefault();
  const s = useImageMaker.getState();
  const paths = await clipboardFilePaths();
  if (paths.length > 0) {
    const images = paths.filter((p) => IMAGE_FILE.test(p));
    if (images.length === 0) s.notify("warning", "Formats acceptés : PNG, JPEG, WebP, GIF, BMP, TIFF.");
    else await s.importPaths(images);
    return true;
  }
  if (files.length === 0) return false;
  for (const file of files) {
    await s.importData(await readAsDataUrl(file), pastedName(file));
  }
  return true;
}

/**
 * Ctrl+V dans une consigne : le texte se colle normalement ; une image (copiée dans
 * l'Explorateur ou ailleurs) rejoint le projet et s'ajoute aux images de référence.
 */
export function pasteIntoPrompt(event: ReactClipboardEvent): void {
  const data = event.clipboardData;
  const files = [...data.files].filter((f) => f.type.startsWith("image/"));
  if (files.length === 0 && data.getData("text/plain")) return;
  if (files.length > 0) event.preventDefault();
  void (async () => {
    const s = useImageMaker.getState();
    const paths = await clipboardFilePaths();
    if (paths.length > 0) {
      const images = paths.filter((p) => IMAGE_FILE.test(p));
      if (images.length === 0) s.notify("warning", "Seules des images peuvent servir de référence.");
      else await s.addReferenceImages({ paths: images });
      return;
    }
    if (files.length === 0) return;
    const images = await Promise.all(files.map(async (file) => ({ data: await readAsDataUrl(file), name: pastedName(file) })));
    await s.addReferenceImages({ images });
  })();
}
