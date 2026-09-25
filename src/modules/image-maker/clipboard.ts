/** Presse-papiers : copier une version en PNG, coller une image depuis une autre application. */
import { convertFileSrc } from "@tauri-apps/api/core";
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

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Colle les images du presse-papiers comme nouvelles versions du projet ouvert. */
export async function pasteFrom(event: ClipboardEvent): Promise<boolean> {
  const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
  if (files.length === 0) return false;
  event.preventDefault();
  const s = useImageMaker.getState();
  for (const file of files) {
    await s.importData(await readAsDataUrl(file), file.name && file.name !== "image.png" ? file.name.replace(/\.[^.]+$/, "") : "");
  }
  return true;
}
