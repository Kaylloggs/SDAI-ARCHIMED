import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const invokeCore = vi.fn();
vi.mock("@/core/ipc", () => ({ invokeCore: (...args: unknown[]) => invokeCore(...args) }));

const { onPasteFiles, pastedFiles } = await import("../paste");

/** FileReader minimal : l'environnement de test (Node) n'en a pas. */
beforeAll(() => {
  class Reader {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    error = null;
    readAsDataURL(blob: Blob) {
      void blob.arrayBuffer().then((buffer) => {
        this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`;
        this.onload?.();
      });
    }
  }
  vi.stubGlobal("FileReader", Reader);
});

afterEach(() => invokeCore.mockReset());

function paste(files: File[], text = "") {
  const preventDefault = vi.fn();
  const event = { clipboardData: { files, getData: () => text }, preventDefault } as unknown as ClipboardEvent;
  return { event, preventDefault };
}

describe("Ctrl+V de fichiers", () => {
  it("laisse passer un collage de texte", () => {
    const { event, preventDefault } = paste([], "bonjour");
    expect(pastedFiles(event)).toBeNull();
    expect(preventDefault).not.toHaveBeenCalled();
    expect(invokeCore).not.toHaveBeenCalled();
  });

  it("prend les vrais chemins des fichiers copiés dans l'Explorateur", async () => {
    invokeCore.mockResolvedValueOnce(["C:\\Users\\a\\rapport.pdf", "C:\\Users\\a\\photo.png"]);
    const { event, preventDefault } = paste([new File(["x"], "rapport.pdf", { type: "application/pdf" })]);
    await expect(pastedFiles(event)).resolves.toEqual(["C:\\Users\\a\\rapport.pdf", "C:\\Users\\a\\photo.png"]);
    expect(preventDefault).toHaveBeenCalled();
    expect(invokeCore).toHaveBeenCalledTimes(1);
    expect(invokeCore).toHaveBeenCalledWith("clipboard_file_paths");
  });

  it("enregistre une image copiée ailleurs et renvoie son chemin", async () => {
    invokeCore.mockResolvedValueOnce([]).mockResolvedValueOnce("C:\\data\\pasted\\20260925-image-collee.png");
    const { event } = paste([new File([new Uint8Array([137, 80, 78, 71])], "image.png", { type: "image/png" })]);
    await expect(pastedFiles(event)).resolves.toEqual(["C:\\data\\pasted\\20260925-image-collee.png"]);
    expect(invokeCore).toHaveBeenLastCalledWith("clipboard_save_file", { name: "image.png", data: "data:image/png;base64,iVBORw==" });
  });

  it("interroge Windows quand le presse-papiers n'a ni texte ni fichier", async () => {
    invokeCore.mockResolvedValueOnce(["D:\\doc.txt"]);
    const { event, preventDefault } = paste([]);
    await expect(pastedFiles(event)).resolves.toEqual(["D:\\doc.txt"]);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("signale un fichier trop lourd sans l'envoyer", async () => {
    invokeCore.mockResolvedValueOnce([]);
    const big = new File(["x"], "enorme.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: 60 * 1024 * 1024 });
    const onPaths = vi.fn();
    const onError = vi.fn();
    onPasteFiles(onPaths, onError)(paste([big]).event as never);
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0]?.[0]).toContain("trop lourd");
    expect(onPaths).not.toHaveBeenCalled();
    expect(invokeCore).toHaveBeenCalledTimes(1);
  });
});
