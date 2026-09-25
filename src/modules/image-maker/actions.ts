/**
 * Demandes à l'IA préparées depuis l'état du studio : ce que « Générer » et le bouton du
 * panneau Retoucher envoient, et pourquoi ils sont désactivés quand il manque quelque chose.
 */
import type { ImageAiOperation } from "@/core/ipc/bindings/ImageAiOperation";
import type { AiTask } from "./lib/capabilities";
import { splitList, composePrompt } from "./lib/prompt";
import { extendToRatio, parseRatio } from "./lib/ratio";
import { currentNode, useImageMaker, type State } from "./store";

export type Prepared = { operation: ImageAiOperation; task: AiTask } | { problem: string };

export function prepareCreate(state: State): Prepared {
  const draft = state.draft;
  const prompt = draft.structured ? composePrompt(draft.structure) : draft.prompt;
  if (!prompt.trim()) return { problem: "Décrivez l'image à créer." };
  return { operation: { type: "generate", references: draft.references }, task: "generate" };
}

/**
 * `final` : la demande part vraiment (le masque est alors encodé en PNG, ce qui coûte) ;
 * sinon on vérifie seulement qu'elle est complète, à chaque rendu du panneau.
 */
export function prepareEdit(state: State, final = false): Prepared {
  const draft = state.draft;
  const node = currentNode(state);
  if (!node) return { problem: "Ajoutez ou générez d'abord une image." };
  const source = node.id;
  const instruction = draft.instruction.trim();
  switch (draft.task) {
    case "inpaint": {
      if (!state.mask || state.mask.isEmpty) return { problem: "Sélectionnez la zone à modifier (outils de sélection à gauche)." };
      if (!instruction && draft.inpaintMode !== "remove") return { problem: "Décrivez ce qui doit apparaître dans la zone." };
      return {
        operation: { type: "inpaint", source, mask_png: final ? state.mask.toDataUrl() : "", mode: draft.inpaintMode },
        task: "inpaint",
      };
    }
    case "edit":
      if (!instruction) return { problem: "Décrivez la modification." };
      return { operation: { type: "edit", source, references: draft.references }, task: "edit" };
    case "outpaint": {
      const ratio = parseRatio(draft.extendRatio);
      const canvas = ratio ? extendToRatio(node.width, node.height, ratio, draft.anchor) : null;
      if (!canvas) return { problem: `L'image est déjà au format ${draft.extendRatio} : choisissez un autre format.` };
      return {
        operation: {
          type: "outpaint",
          source,
          width: canvas.width,
          height: canvas.height,
          offset_x: canvas.offsetX,
          offset_y: canvas.offsetY,
        },
        task: "outpaint",
      };
    }
    case "variation":
      return { operation: { type: "variation", source, keep: splitList(draft.keep) }, task: "variation" };
    case "restyle":
      if (!draft.style.trim()) return { problem: "Décrivez le style voulu." };
      return { operation: { type: "restyle", source, style: draft.style.trim() }, task: "restyle" };
    case "background":
      if (draft.backgroundAction === "replace" && !instruction) return { problem: "Décrivez le nouveau fond." };
      return { operation: { type: "background", source, action: draft.backgroundAction }, task: "background" };
    case "upscale":
      return { operation: { type: "upscale", source }, task: "upscale" };
    case "restore":
      return { operation: { type: "restore", source }, task: "restore" };
  }
}

/** Lance l'action du panneau actif (Ctrl+Entrée, bouton du panneau, bouton du haut). */
export async function run(kind: "create" | "edit"): Promise<void> {
  const state = useImageMaker.getState();
  const prepared = kind === "create" ? prepareCreate(state) : prepareEdit(state, true);
  if ("problem" in prepared) {
    state.notify("warning", prepared.problem);
    if (kind === "create") state.set({ panel: "create", focusPrompt: state.focusPrompt + 1 });
    return;
  }
  const jobs = await state.submit(prepared.operation, prepared.task);
  if (jobs && jobs.length > 0) {
    state.notify("info", jobs.length > 1 ? `${jobs.length} demandes dans la file.` : "Demande envoyée : suivez-la dans la file.");
  }
}
