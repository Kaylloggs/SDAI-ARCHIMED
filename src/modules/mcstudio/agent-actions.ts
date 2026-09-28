import { bus } from "@/core/bus/event-bus";
import { defineActions, findByName, type ActionContext } from "@/core/modules";
import type { BlockSound } from "@/core/ipc/bindings/BlockSound";
import type { ContentResult } from "@/core/ipc/bindings/ContentResult";
import type { LoaderId } from "@/core/ipc/bindings/LoaderId";
import type { ProjectSummary } from "@/core/ipc/bindings/ProjectSummary";
import type { RecipeRequest } from "@/core/ipc/bindings/RecipeRequest";
import { mcstudioApi } from "./api";
import { modIdProblem, suggestMainClass, suggestModId, suggestPackage, suggestRegistryName } from "./lib/naming";
import { LOADERS, pickTarget } from "./lib/target";
import { useMcStudioStore } from "./store";

const nameOf = (p: ProjectSummary) => p.meta?.name ?? p.id;

async function project(ref: unknown, fallback: string | null): Promise<ProjectSummary | null> {
  const store = useMcStudioStore.getState();
  if (!store.loaded) await store.refresh();
  const projects = useMcStudioStore.getState().projects;
  const wanted = typeof ref === "string" && ref.trim() ? ref.trim() : fallback;
  if (!wanted) return null;
  return findByName(projects, wanted, nameOf, (p) => p.id);
}

const notFound = { ok: false, message: "Projet de mod introuvable ou ambigu. Appelle list_projects." };

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const failure = (e: unknown) => ({ ok: false, message: (e as { message?: string })?.message ?? String(e) });

/**
 * Projet visé : celui nommé, sinon celui ouvert dans Mod Studio (à jour tout de suite, même
 * juste après `create_project`), sinon celui du contexte publié.
 */
async function targetProject(args: Record<string, unknown>, ctx: ActionContext): Promise<ProjectSummary | null> {
  const current = ctx.context.modules["mcstudio"]?.details?.["projectId"];
  return project(args.project, useMcStudioStore.getState().openId ?? (typeof current === "string" ? current : null));
}

/** Nom de registre donné, sinon déduit du nom anglais (« Ruby Sword » → `ruby_sword`). */
const registryId = (value: unknown, fallback: string) => suggestRegistryName(text(value) || fallback);

const written = (result: ContentResult) => [...result.created, ...result.modified];

const projectParam = { project: { type: "string" as const, description: "Nom ou identifiant ; par défaut le projet ouvert." } };

/** Annonce la fin d'une compilation lancée par un agent (la voix la dit si elle est active). */
function announceWhenDone(id: string, name: string): void {
  const unsubscribe = useMcStudioStore.subscribe((state) => {
    const session = state.builds[id];
    if (!session || session.running || !session.record) return;
    unsubscribe();
    const ok = session.record.status === "success";
    bus.emit("voice.speak", { text: `${name} : ${session.record.summary}`, priority: ok ? "normal" : "high", source: "module" });
  });
}

/** Actions de Mod Studio pour les agents (voix, MCP). */
export default defineActions([
  {
    name: "list_projects",
    description: "Liste les projets de mods Minecraft (version, chargeur, état).",
    risk: "read",
    run: async () => {
      const store = useMcStudioStore.getState();
      if (!store.loaded) await store.refresh();
      const projects = useMcStudioStore.getState().projects.map((p) => ({
        id: p.id,
        name: nameOf(p),
        minecraft: p.meta?.versions.minecraft ?? null,
        loader: p.meta?.versions.loader ?? null,
        path: p.path,
      }));
      return {
        ok: true,
        message: projects.length === 0 ? "Aucun projet de mod." : `${projects.length} projet${projects.length > 1 ? "s" : ""} : ${projects.map((p) => p.name).join(", ")}.`,
        data: { projects },
      };
    },
  },
  {
    name: "open_project",
    description: "Affiche un projet de mod dans Mod Studio.",
    params: { project: { type: "string", description: "Nom ou identifiant du projet.", required: true } },
    risk: "read",
    run: async (args) => {
      const target = await project(args.project, null);
      if (!target) return notFound;
      useMcStudioStore.getState().open(target.id);
      return { ok: true, message: `${nameOf(target)} est ouvert.`, open: { module: "mcstudio" } };
    },
  },
  {
    name: "create_project",
    description:
      "Crée un nouveau projet de mod Minecraft complet (Gradle, sources Java, ressources) prêt à compiler, puis l'ouvre dans Mod Studio. À utiliser pour toute demande de créer un mod.",
    params: {
      name: { type: "string", description: "Nom du mod (« Dragon Realms »).", required: true },
      loader: { type: "string", enum: LOADERS, description: "Mod loader ; fabric par défaut." },
      minecraft: { type: "string", description: "Version de Minecraft (« 1.21.1 ») ; par défaut la plus récente prise en charge." },
      description: { type: "string", description: "Une phrase qui décrit le mod." },
      author: { type: "string", description: "Auteur (sert au nom de package Java)." },
      example: { type: "boolean", description: "Ajoute un objet, un bloc et deux recettes d'exemple (vrai par défaut)." },
    },
    risk: "write",
    run: async (args) => {
      const name = text(args.name);
      const modId = suggestModId(name);
      const problem = modIdProblem(modId);
      if (!name || problem) return { ok: false, message: `Nom de mod inutilisable : ${problem ?? "nom vide"}.` };
      const loader = (LOADERS.includes(args.loader as LoaderId) ? args.loader : "fabric") as LoaderId;
      try {
        const catalog = await mcstudioApi.versionCatalog();
        const target = pickTarget(catalog, loader, text(args.minecraft) || null);
        if (typeof target === "string") return { ok: false, message: target };
        const [versions, parentDir] = await Promise.all([mcstudioApi.resolveVersions(target.profileId, target.minecraft), mcstudioApi.defaultParentDir()]);
        const author = text(args.author);
        const created = await mcstudioApi.createProject({
          name,
          modId,
          package: suggestPackage(author, modId),
          mainClass: suggestMainClass(name),
          author,
          description: text(args.description),
          parentDir,
          versions,
          license: "none",
          withExample: args.example !== false,
          javaHome: null,
        });
        const store = useMcStudioStore.getState();
        store.upsert(created);
        store.open(created.id);
        return {
          ok: true,
          message: `Projet ${name} créé pour Minecraft ${target.minecraft} avec ${loader}.`,
          data: { projectId: created.id, modId, path: created.path, minecraft: target.minecraft, loader },
          open: { module: "mcstudio" },
        };
      } catch (e) {
        return failure(e);
      }
    },
  },
  {
    name: "add_item",
    description: "Ajoute un objet au mod (enregistrement, modèle, texture provisoire, traductions).",
    params: {
      ...projectParam,
      name_en: { type: "string", description: "Nom en anglais (« Ruby »).", required: true },
      name_fr: { type: "string", description: "Nom en français (« Rubis »)." },
      id: { type: "string", description: "Nom de registre (« ruby ») ; déduit du nom anglais sinon." },
    },
    risk: "write",
    run: async (args, ctx) => {
      const target = await targetProject(args, ctx);
      if (!target) return notFound;
      const nameEn = text(args.name_en);
      try {
        const result = await mcstudioApi.addItem(target.id, { id: registryId(args.id, nameEn), nameEn, nameFr: text(args.name_fr) || nameEn });
        return { ok: true, message: `Objet ${nameEn} ajouté à ${nameOf(target)}.`, data: { files: written(result) } };
      } catch (e) {
        return failure(e);
      }
    },
  },
  {
    name: "add_block",
    description: "Ajoute un bloc au mod (bloc, objet associé, modèles, texture provisoire, butin, traductions).",
    params: {
      ...projectParam,
      name_en: { type: "string", description: "Nom en anglais (« Ruby Block »).", required: true },
      name_fr: { type: "string", description: "Nom en français." },
      id: { type: "string", description: "Nom de registre ; déduit du nom anglais sinon." },
      hardness: { type: "number", description: "Dureté (pierre : 1.5, fer : 5)." },
      resistance: { type: "number", description: "Résistance aux explosions (pierre : 6)." },
      sound: { type: "string", enum: ["stone", "metal", "wood"], description: "Sons du bloc." },
    },
    risk: "write",
    run: async (args, ctx) => {
      const target = await targetProject(args, ctx);
      if (!target) return notFound;
      const nameEn = text(args.name_en);
      const sound = (["stone", "metal", "wood"].includes(args.sound as string) ? args.sound : "stone") as BlockSound;
      try {
        const result = await mcstudioApi.addBlock(target.id, {
          id: registryId(args.id, nameEn),
          nameEn,
          nameFr: text(args.name_fr) || nameEn,
          hardness: typeof args.hardness === "number" ? args.hardness : 1.5,
          resistance: typeof args.resistance === "number" ? args.resistance : 6,
          sound,
        });
        return { ok: true, message: `Bloc ${nameEn} ajouté à ${nameOf(target)}.`, data: { files: written(result) } };
      } catch (e) {
        return failure(e);
      }
    },
  },
  {
    name: "add_recipe",
    description:
      "Ajoute une recette au mod, au format de la version du projet. `recipe` : { type: \"shaped\", id, pattern: [\"AAA\", \" B \"], key: { A: \"monmod:ruby\" }, result, count } | { type: \"shapeless\", id, ingredients, result, count } | { type: \"smelting\", id, ingredient, result, experience, cookingTime }.",
    params: { ...projectParam, recipe: { type: "object", description: "Recette (voir la description).", required: true } },
    risk: "write",
    run: async (args, ctx) => {
      const target = await targetProject(args, ctx);
      if (!target) return notFound;
      const recipe = args.recipe as RecipeRequest;
      if (!recipe || !["shaped", "shapeless", "smelting"].includes(recipe.type)) return { ok: false, message: "Recette invalide : type shaped, shapeless ou smelting." };
      try {
        const result = await mcstudioApi.addRecipe(target.id, recipe);
        return { ok: true, message: `Recette ${recipe.id} ajoutée à ${nameOf(target)}.`, data: { files: written(result) } };
      } catch (e) {
        return failure(e);
      }
    },
  },
  {
    name: "build_project",
    description: "Compile un projet de mod avec Gradle (jar dans dist/). Rend la main tout de suite ; le résultat est annoncé à la fin.",
    params: { project: { type: "string", description: "Nom ou identifiant ; par défaut le projet ouvert." } },
    risk: "write",
    run: async (args, ctx) => {
      const target = await targetProject(args, ctx);
      if (!target) return notFound;
      const store = useMcStudioStore.getState();
      if (store.builds[target.id]?.running) return { ok: false, message: `${nameOf(target)} est déjà en cours de compilation.` };
      store.open(target.id);
      await store.startBuild(target.id, "build", false);
      announceWhenDone(target.id, nameOf(target));
      return {
        ok: true,
        message: `Compilation de ${nameOf(target)} lancée. Le résultat sera annoncé.`,
        data: { projectId: target.id },
        open: { module: "mcstudio" },
      };
    },
  },
]);
