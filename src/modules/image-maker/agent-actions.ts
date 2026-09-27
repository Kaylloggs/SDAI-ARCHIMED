import { defineActions, findByName } from "@/core/modules";
import { imageMakerApi } from "./api";
import { useImageMaker } from "./store";

/** Actions d'Image Maker pour les agents (voix, MCP). */
export default defineActions([
  {
    name: "list_projects",
    description: "Liste les projets d'images (nom, nombre de versions).",
    risk: "read",
    run: async () => {
      const projects = await imageMakerApi.listProjects();
      return {
        ok: true,
        message: projects.length === 0 ? "Aucun projet d'images." : `${projects.length} projet${projects.length > 1 ? "s" : ""} : ${projects.map((p) => p.name).join(", ")}.`,
        data: { projects: projects.map((p) => ({ id: p.id, name: p.name, images: p.images })) },
      };
    },
  },
  {
    name: "prepare_image",
    description:
      "Prépare une demande d'image dans le studio (projet existant ou nouveau) : la consigne est remplie, la personne choisit le modèle et lance la génération (souvent payante).",
    params: {
      prompt: { type: "string", description: "Description de l'image, précise.", required: true },
      project: { type: "string", description: "Nom du projet ; absent ou introuvable : un nouveau projet est créé." },
    },
    risk: "write",
    run: async (args) => {
      const prompt = String(args.prompt).trim();
      const wanted = typeof args.project === "string" ? args.project.trim() : "";
      const store = useImageMaker.getState();
      const existing = wanted ? findByName(await imageMakerApi.listProjects(), wanted, (p) => p.name, (p) => p.id) : null;
      if (existing) await store.openProject(existing.id);
      else if (!(await store.createProject(wanted || prompt.slice(0, 40)))) return { ok: false, message: "Projet d'images impossible à créer." };
      const current = useImageMaker.getState();
      current.setPanel("create");
      current.setDraft({ prompt, structured: false });
      current.set({ focusPrompt: current.focusPrompt + 1 });
      return {
        ok: true,
        message: `Demande prête dans Image Maker (${current.project?.name ?? "nouveau projet"}). Choisissez le modèle puis « Générer ».`,
        data: { projectId: current.project?.id ?? null },
        open: { module: "image-maker" },
      };
    },
  },
]);
