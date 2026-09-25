import { describe, expect, it } from "vitest";
import type { ModelCapabilities } from "@/core/ipc/bindings/ModelCapabilities";
import type { ProviderModel } from "@/core/ipc/bindings/ProviderModel";
import type { ProviderId } from "@/core/ipc/bindings/ProviderId";
import { autoPick, blockers, needsOf, shortfalls } from "../lib/capabilities";
import { latestChild, layoutTree, lineage, parentOf } from "../lib/history";
import { MaskHistory, shapeMode, simplify } from "../lib/mask";
import { composePrompt, parseStructure, splitList } from "../lib/prompt";
import { clampRect, cropForRatio, extendToRatio, fitSize, nearestRatio, parseRatio, rectFromPoints } from "../lib/ratio";
import { priceText, usageText } from "../lib/format";

function caps(over: Partial<ModelCapabilities> = {}): ModelCapabilities {
  return {
    textToImage: true,
    imageInput: false,
    maxInputImages: null,
    nativeMask: false,
    aspectRatios: [],
    resolutions: [],
    maxImagesPerRequest: 1,
    seed: false,
    negativePrompt: false,
    transparentBackground: false,
    qualities: [],
    source: "api",
    ...over,
  };
}

function model(provider: ProviderId, id: string, over: Partial<ModelCapabilities> = {}): ProviderModel {
  return { provider, id, name: id, description: "", capabilities: caps(over), pricing: [], free: false };
}

describe("formats", () => {
  it("reads ratios and crops the largest centred rectangle", () => {
    expect(parseRatio("16:9")).toBeCloseTo(16 / 9);
    expect(parseRatio("4 x 3")).toBeCloseTo(4 / 3);
    expect(parseRatio("abc")).toBeNull();
    expect(parseRatio("0:3")).toBeNull();
    expect(cropForRatio(1000, 1000, 16 / 9)).toEqual({ x: 0, y: 218, width: 1000, height: 563 });
    expect(cropForRatio(1600, 900, 1)).toEqual({ x: 350, y: 0, width: 900, height: 900 });
  });

  it("extends the canvas without ever shrinking it and keeps the anchor", () => {
    expect(extendToRatio(1000, 1000, 16 / 9)).toEqual({ width: 1778, height: 1000, offsetX: 389, offsetY: 0 });
    expect(extendToRatio(1600, 900, 9 / 16, { x: 0.5, y: 0 })).toEqual({ width: 1600, height: 2844, offsetX: 0, offsetY: 0 });
    expect(extendToRatio(1600, 900, 16 / 9)).toBeNull();
    expect(extendToRatio(16384, 100, 0.5)).toBeNull();
  });

  it("clamps rectangles, keeps the ratio while dragging and fits sizes", () => {
    expect(clampRect({ x: -10, y: 5.4, width: 500, height: 20 }, 100, 50)).toEqual({ x: 0, y: 5, width: 100, height: 20 });
    const rect = rectFromPoints({ x: 10, y: 10 }, { x: 170, y: 20 }, 16 / 9);
    expect(rect.width / rect.height).toBeCloseTo(16 / 9);
    expect(rectFromPoints({ x: 50, y: 50 }, { x: 10, y: 20 }, null)).toEqual({ x: 10, y: 20, width: 40, height: 30 });
    expect(fitSize(4000, 2000, 2048)).toEqual({ width: 2048, height: 1024 });
    expect(fitSize(800, 600, 2048)).toEqual({ width: 800, height: 600 });
    expect(nearestRatio(1920, 1080)).toBe("16:9");
    expect(nearestRatio(1080, 1350)).toBe("3:4");
  });
});

describe("history tree", () => {
  const nodes = [
    { id: "a", parent: null },
    { id: "b", parent: "a" },
    { id: "c", parent: "b" },
    { id: "d", parent: "a" },
    { id: "e", parent: null },
    { id: "f", parent: "gone" },
  ];

  it("keeps a branch on its parent's row and opens a row per extra child", () => {
    const { cells, rows, cols } = layoutTree(nodes);
    const at = (id: string) => cells.find((c) => c.id === id);
    expect(at("a")).toMatchObject({ col: 0, row: 0 });
    expect(at("b")).toMatchObject({ col: 1, row: 0 });
    expect(at("c")).toMatchObject({ col: 2, row: 0 });
    expect(at("d")).toMatchObject({ col: 1, row: 1 });
    expect(at("e")).toMatchObject({ col: 0, row: 2 });
    expect(at("f")).toMatchObject({ col: 0, row: 3, parent: null });
    expect(rows).toBe(4);
    expect(cols).toBe(3);
  });

  it("walks to the parent, the latest child and the lineage", () => {
    expect(parentOf(nodes, "c")?.id).toBe("b");
    expect(parentOf(nodes, "a")).toBeUndefined();
    expect(latestChild(nodes, "a")?.id).toBe("d");
    expect(lineage(nodes, "c").map((n) => n.id)).toEqual(["a", "b", "c"]);
  });
});

describe("capabilities and Auto mode", () => {
  it("says why a model does not fit, and what is only a wish", () => {
    expect(blockers(caps(), needsOf("edit"))).toEqual(["il ne reçoit pas d'image"]);
    expect(blockers(caps({ imageInput: true, maxInputImages: 1 }), needsOf("inpaint"))).toEqual(["il reçoit au plus 1 image"]);
    expect(blockers(caps({ textToImage: false, imageInput: true }), needsOf("generate"))).toEqual(["il part toujours d'une image"]);
    expect(needsOf("generate", { references: 2 })).toMatchObject({ textToImage: false, imageInput: true, inputImages: 2 });
    expect(shortfalls(caps({ aspectRatios: ["1:1"] }), needsOf("generate", { ratio: "16:9", transparent: true }))).toEqual([
      "le format 16:9 n'est pas proposé",
      "pas de fond transparent natif",
    ]);
  });

  it("keeps the person's model when it fits, otherwise the first compatible one", () => {
    const candidates = [
      { provider: "openrouter" as const, state: "connected" as const, models: [model("openrouter", "text-only"), model("openrouter", "editor", { imageInput: true })] },
      { provider: "gemini" as const, state: "apiKeyMissing" as const, models: [model("gemini", "g", { imageInput: true })] },
      { provider: "higgsfield" as const, state: "disconnected" as const, models: [model("higgsfield", "h", { imageInput: true, aspectRatios: ["16:9"] })] },
    ];
    const needs = needsOf("edit", { ratio: "16:9" });
    const choice = autoPick(candidates, needs, { provider: "openrouter", model: "text-only" });
    // `h` remplit aussi le souhait de format ; Gemini n'a pas de clé.
    expect(choice?.model.id).toBe("h");
    expect(choice?.reasons).toContain("propose le format 16:9");
    const kept = autoPick(candidates, needsOf("edit"), { provider: "openrouter", model: "editor" });
    expect(kept?.model.id).toBe("editor");
    expect(autoPick(candidates, needsOf("inpaint"), null)?.model.id).toBe("editor");
    expect(autoPick([candidates[1]!], needsOf("generate"), null)).toBeNull();
  });
});

describe("prompt structure", () => {
  it("composes fields in order and reads a structured suggestion", () => {
    expect(composePrompt({ style: "aquarelle.", subject: "Un phare ", lighting: "" })).toBe("Un phare. aquarelle");
    const parsed = parseStructure("subject: Un phare\nLumière : aube rose\nnope\nstyle:");
    expect(parsed).toEqual({ subject: "Un phare", lighting: "aube rose" });
    expect(parseStructure("un simple texte")).toEqual({ subject: "un simple texte" });
    expect(splitList("le visage, la pose ; le décor\n")).toEqual(["le visage", "la pose", "le décor"]);
  });
});

describe("selection mask", () => {
  it("undoes, redoes and ignores what a replace or a clear made useless", () => {
    const history = new MaskHistory();
    expect(history.obviouslyEmpty).toBe(true);
    history.push({ kind: "rect", mode: "replace", x: 0, y: 0, width: 5, height: 5 });
    history.push({ kind: "ellipse", mode: "add", x: 2, y: 2, width: 5, height: 5 });
    history.push({ kind: "rect", mode: "replace", x: 1, y: 1, width: 2, height: 2 });
    expect(history.effective()).toHaveLength(1);
    history.push({ kind: "clear" });
    expect(history.effective()).toHaveLength(0);
    expect(history.obviouslyEmpty).toBe(true);
    expect(history.undo()).toBe(true);
    expect(history.effective()).toHaveLength(1);
    expect(history.redo()).toBe(true);
    expect(history.canRedo).toBe(false);
    history.undo();
    history.push({ kind: "stroke", mode: "subtract", points: [], size: 4 });
    expect(history.canRedo).toBe(false);
    expect(shapeMode(true, false)).toBe("add");
    expect(shapeMode(false, true)).toBe("subtract");
    expect(shapeMode(false, false)).toBe("replace");
  });

  it("thins hand-drawn points but keeps the last one", () => {
    const points = [0, 0.5, 1, 4, 4.2, 9].map((x) => ({ x, y: 0 }));
    expect(simplify(points, 2).map((p) => p.x)).toEqual([0, 4, 9]);
  });
});

describe("costs", () => {
  it("only shows what the provider reported", () => {
    expect(usageText({ costUsd: null, inputTokens: null, outputTokens: null, note: null })).toBe("Coût non communiqué par le fournisseur.");
    expect(usageText({ costUsd: 0.04, inputTokens: null, outputTokens: null, note: null })).toMatch(/0,04/);
    expect(priceText({ label: "Image produite", costUsd: 0.03, unit: "image" })).toMatch(/par image$/);
    expect(usageText(null)).toBeNull();
  });
});
