import { bus } from "@/core/bus/event-bus";
import { defineActions, findByName, type ActionContext } from "@/core/modules";
import type { BlockSound } from "@/core/ipc/bindings/BlockSound";
import type { ContentResult } from "@/core/ipc/bindings/ContentResult";
import type { LoaderId } from "@/core/ipc/bindings/LoaderId";
import type { ProjectSummary } from "@/core/ipc/bindings/ProjectSummary";
import type { RecipeRequest } from "@/core/ipc/bindings/RecipeRequest";
import type { ImageModel } from "@/core/ipc/bindings/ImageModel";
import type { ImageProvider } from "@/core/ipc/bindings/ImageProvider";
import type { TextureInfo } from "@/core/ipc/bindings/TextureInfo";
import { mcstudioApi } from "./api";
import { defaultOptions, loadProvider, PIXEL_SIZES, squareTarget, targetKey } from "./lib/textures";
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

const TEXTURE_PROVIDERS: ImageProvider[] = ["openRouter", "gemini", "higgsfield", "higgsfieldAccount"];

/** Texture désignée par son nom affiché, son identifiant d'objet ou de bloc, ou son chemin. */
async function texture(projectId: string, ref: unknown): Promise<TextureInfo | null> {
  const list = await mcstudioApi.listTextures(projectId);
  const wanted = text(ref);
  if (!wanted) return null;
  const id = (t: TextureInfo) => ("id" in t.target ? t.target.id : t.target.kind === "asset" ? t.target.path : t.relative);
  return (
    list.find((t) => t.relative === wanted || t.path === wanted || targetKey(t.target) === wanted) ??
    findByName(list, wanted, (t) => `${t.label} ${id(t)}`, id)
  );
}

async function imageModels(provider: ImageProvider): Promise<ImageModel[]> {
  const list =
    provider === "gemini"
      ? await mcstudioApi.geminiImageModels()
      : provider === "higgsfield" || provider === "higgsfieldAccount"
        ? await mcstudioApi.higgsfieldImageModels(provider === "higgsfieldAccount")
        : await mcstudioApi.imageModels();
  return list.models;
}

/** Réglages de conversion : taille (8 à 256) ou image gardée telle quelle. */
function conversion(info: TextureInfo, args: Record<string, unknown>) {
  const options = defaultOptions(info.target, info);
  const size = Number(args.size);
  if (args.keep === true && squareTarget(info.target)) return { ...options, keep: true };
  if ((PIXEL_SIZES as readonly number[]).includes(size) && squareTarget(info.target)) return { ...options, size, keep: false };
  return options;
}

const textureParams = {
  ...projectParam,
  texture: { type: "string" as const, description: "Texture : nom affiché, identifiant d'objet ou de bloc, ou chemin (list_textures).", required: true },
  size: { type: "number" as const, description: "Pixel art de 8, 16, 32, 64, 128 ou 256 pixels (sinon la taille de la texture en place)." },
  keep: { type: "boolean" as const, description: "Garder l'image telle quelle, sans la convertir en pixel art." },
  apply: { type: "boolean" as const, description: "Écrire la texture dans le projet (true par défaut) ; false : proposition seulement." },
};

/** Écrit (ou garde en proposition) une texture reçue. */
async function finishTexture(projectId: string, info: TextureInfo, draft: { id: string; notes: string[] }, apply: boolean) {
  if (!apply) return { ok: true, message: `Proposition prête pour ${info.label} : à valider dans l'atelier de textures.`, data: { draftId: draft.id }, open: { module: "mcstudio" } };
  const applied = await mcstudioApi.applyTexture(projectId, draft.id);
  useMcStudioStore.getState().bumpIcon(projectId);
  return { ok: true, message: `Texture de ${info.label} écrite dans le projet.${draft.notes.length ? ` ${draft.notes.join(" ")}` : ""}`, data: { path: applied.relative } };
}

/** Commandes de Mod Studio : projets, contenu, compilation et test, fichiers, textures, sauvegardes. */
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
  {
    name: "run_game",
    description: "Lance Minecraft avec le mod (client de test, runClient) ou un serveur de test (server à true). Rend la main tout de suite.",
    params: { ...projectParam, server: { type: "boolean", description: "Serveur de test au lieu du jeu." } },
    risk: "write",
    run: async (args, ctx) => {
      const target = await targetProject(args, ctx);
      if (!target) return notFound;
      const store = useMcStudioStore.getState();
      store.open(target.id);
      void store.startBuild(target.id, args.server === true ? "runServer" : "runClient", false);
      return { ok: true, message: `${args.server === true ? "Serveur de test" : "Minecraft"} en cours de lancement avec ${nameOf(target)}.`, open: { module: "mcstudio" } };
    },
  },
  {
    name: "server_command",
    description: "Envoie une commande à la console du serveur de test (sans « / »), ou l'arrête (stop à true).",
    params: { ...projectParam, command: { type: "string", description: "Commande (ex. give @a diamond)." }, stop: { type: "boolean", description: "Arrêter le serveur." } },
    risk: "write",
    run: async (args, ctx) => {
      const target = await targetProject(args, ctx);
      if (!target) return notFound;
      if (args.stop === true) {
        await useMcStudioStore.getState().stopServer(target.id);
        return { ok: true, message: "Serveur de test arrêté." };
      }
      const command = text(args.command).replace(/^\//, "");
      if (!command) return { ok: false, message: "Donne la commande à envoyer." };
      await useMcStudioStore.getState().sendServerCommand(target.id, command);
      return { ok: true, message: `Commande envoyée : ${command}.` };
    },
  },
  {
    name: "cancel_build",
    description: "Arrête la compilation (ou le jeu de test) en cours.",
    params: projectParam,
    risk: "write",
    run: async (args, ctx) => {
      const target = await targetProject(args, ctx);
      if (!target) return notFound;
      await useMcStudioStore.getState().cancelBuild(target.id);
      return { ok: true, message: "Arrêté." };
    },
  },
  {
    name: "build_history",
    description: "Dernières compilations : état, durée, jar produit, erreurs trouvées.",
    params: projectParam,
    risk: "read",
    run: async (args, ctx) => {
      const target = await targetProject(args, ctx);
      if (!target) return notFound;
      const builds = (await mcstudioApi.listBuilds(target.id)).slice(-10);
      const last = builds.at(-1);
      return {
        ok: true,
        message: last ? `Dernière compilation : ${last.summary}` : "Aucune compilation.",
        data: { builds: builds.map((b) => ({ id: b.id, task: b.task, status: b.status, summary: b.summary, jar: b.jar, issues: b.issues.slice(0, 20) })) },
      };
    },
  },
  {
    name: "check_project",
    description: "Vérifie le projet sans compiler (JSON, modèles, textures manquantes, traductions) : liste des problèmes.",
    params: projectParam,
    risk: "read",
    run: async (args, ctx) => {
      const target = await targetProject(args, ctx);
      if (!target) return notFound;
      const report = await mcstudioApi.validate(target.id);
      return {
        ok: true,
        message: report.errors + report.warnings === 0 ? "Aucun problème trouvé." : `${report.errors} erreur${report.errors > 1 ? "s" : ""}, ${report.warnings} avertissement${report.warnings > 1 ? "s" : ""}.`,
        data: { issues: report.issues.slice(0, 50) },
      };
    },
  },
  {
    name: "project_stats",
    description: "Contenu du projet : objets, blocs, entités, recettes, textures, modèles, classes Java.",
    params: projectParam,
    risk: "read",
    run: async (args, ctx) => {
      const target = await targetProject(args, ctx);
      if (!target) return notFound;
      const stats = await mcstudioApi.projectStats(target.id);
      return { ok: true, message: `${stats.items} objets, ${stats.blocks} blocs, ${stats.recipes} recettes, ${stats.textures} textures.`, data: { ...stats, path: target.path } };
    },
  },
  {
    name: "list_files",
    description: "Liste un dossier du projet (chemin relatif, racine par défaut).",
    params: { ...projectParam, dir: { type: "string", description: "Dossier relatif au projet (ex. src/main/resources)." } },
    risk: "read",
    run: async (args, ctx) => {
      const target = await targetProject(args, ctx);
      if (!target) return notFound;
      const entries = (await mcstudioApi.listFiles(target.id, text(args.dir))).filter((e) => !e.ignored);
      return { ok: true, message: `${entries.length} élément${entries.length > 1 ? "s" : ""}.`, data: { entries: entries.map((e) => ({ name: e.name, path: e.path, dir: e.isDir, size: e.size })) } };
    },
  },
  {
    name: "read_file",
    description: "Lit un fichier du projet (chemin relatif).",
    params: { ...projectParam, path: { type: "string", description: "Chemin relatif au projet.", required: true } },
    risk: "read",
    run: async (args, ctx) => {
      const target = await targetProject(args, ctx);
      if (!target) return notFound;
      const file = await mcstudioApi.readFile(target.id, text(args.path));
      if (file.binary) return { ok: false, message: file.image ? "Image : pas de texte à lire." : "Fichier binaire." };
      return { ok: true, message: `${file.path} : ${file.content.split("\n").length} lignes.`, data: { path: file.path, content: file.content.slice(0, 40_000), truncated: file.truncated } };
    },
  },
  {
    name: "write_file",
    description: "Écrit un fichier texte du projet (créé ou remplacé), comme l'éditeur de Mod Studio.",
    params: {
      ...projectParam,
      path: { type: "string", description: "Chemin relatif au projet.", required: true },
      content: { type: "string", description: "Contenu complet.", required: true },
    },
    risk: "destructive",
    confirm: (args) => `Écrire ${String(args.path)} dans le projet ?`,
    run: async (args, ctx) => {
      const target = await targetProject(args, ctx);
      if (!target) return notFound;
      const path = text(args.path);
      const exists = await mcstudioApi.readFile(target.id, path).then(() => true, () => false);
      if (!exists) await mcstudioApi.createFile(target.id, path, false);
      await mcstudioApi.writeFile(target.id, path, String(args.content), null);
      return { ok: true, message: `${path} enregistré.` };
    },
  },
  {
    name: "create_folder",
    description: "Crée un dossier dans le projet (chemin relatif).",
    params: { ...projectParam, path: { type: "string", description: "Chemin relatif au projet.", required: true } },
    risk: "write",
    run: async (args, ctx) => {
      const target = await targetProject(args, ctx);
      if (!target) return notFound;
      await mcstudioApi.createFile(target.id, text(args.path), true);
      return { ok: true, message: `Dossier ${text(args.path)} créé.` };
    },
  },
  {
    name: "rename_file",
    description: "Renomme ou déplace un fichier ou un dossier du projet.",
    params: {
      ...projectParam,
      path: { type: "string", description: "Chemin relatif actuel.", required: true },
      to: { type: "string", description: "Nouveau chemin relatif.", required: true },
    },
    risk: "write",
    run: async (args, ctx) => {
      const target = await targetProject(args, ctx);
      if (!target) return notFound;
      await mcstudioApi.renameFile(target.id, text(args.path), text(args.to));
      return { ok: true, message: `${text(args.path)} renommé en ${text(args.to)}.` };
    },
  },
  {
    name: "trash_file",
    description: "Met un fichier ou un dossier du projet à la Corbeille.",
    params: { ...projectParam, path: { type: "string", description: "Chemin relatif au projet.", required: true } },
    risk: "destructive",
    confirm: (args) => `Mettre ${String(args.path)} à la Corbeille ?`,
    run: async (args, ctx) => {
      const target = await targetProject(args, ctx);
      if (!target) return notFound;
      await mcstudioApi.trashFile(target.id, text(args.path));
      return { ok: true, message: `${text(args.path)} mis à la Corbeille.` };
    },
  },
  {
    name: "list_textures",
    description: "Textures du mod (objets, blocs et faces, icône, interfaces, autres), existantes ou manquantes.",
    params: { ...projectParam, missing: { type: "boolean", description: "Seulement celles qui manquent." } },
    risk: "read",
    run: async (args, ctx) => {
      const target = await targetProject(args, ctx);
      if (!target) return notFound;
      const list = (await mcstudioApi.listTextures(target.id)).filter((t) => args.missing !== true || !t.exists);
      const missing = list.filter((t) => !t.exists).length;
      return {
        ok: true,
        message: `${list.length} texture${list.length > 1 ? "s" : ""}, ${missing} manquante${missing > 1 ? "s" : ""}.`,
        data: { textures: list.map((t) => ({ label: t.label, kind: t.target.kind, target: targetKey(t.target), path: t.relative, exists: t.exists, size: `${t.width}x${t.height}`, unused: t.unused })) },
      };
    },
  },
  {
    name: "generate_texture",
    description:
      "Dessine une texture par IA d'après une description (OpenRouter, Gemini ou Higgsfield avec la clé de la personne), la convertit (pixel art ou image gardée) et l'écrit dans le projet. Modèle gratuit par défaut ; un modèle payant demande allow_paid.",
    params: {
      ...textureParams,
      description: { type: "string", description: "Ce que montre la texture (« épée en rubis, garde dorée »).", required: true },
      provider: { type: "string", enum: TEXTURE_PROVIDERS, description: "Service (celui choisi dans l'atelier par défaut)." },
      model: { type: "string", description: "Modèle (nom ou identifiant) ; sinon le premier gratuit." },
      allow_paid: { type: "boolean", description: "Accord de la personne pour un modèle payant." },
    },
    risk: "write",
    run: async (args, ctx) => {
      const target = await targetProject(args, ctx);
      if (!target) return notFound;
      const info = await texture(target.id, args.texture);
      if (!info) return { ok: false, message: `Texture introuvable : « ${text(args.texture)} ». Appelle list_textures.` };
      const provider = TEXTURE_PROVIDERS.includes(args.provider as ImageProvider) ? (args.provider as ImageProvider) : loadProvider();
      const allowPaid = args.allow_paid === true;
      const models = await imageModels(provider).catch(() => [] as ImageModel[]);
      const usable = models.filter((m) => m.free || allowPaid);
      const model = text(args.model) ? findByName(usable, text(args.model), (m) => m.name, (m) => m.id) : usable[0];
      if (!model) return { ok: false, message: models.length === 0 ? `Aucun modèle ${provider} : ajoute la clé du service dans l'atelier de textures.` : allowPaid ? "Modèle introuvable." : "Aucun modèle gratuit : il faut l'accord de la personne pour un modèle payant (allow_paid)." };
      const options = conversion(info, args);
      const gui = info.target.kind === "gui" || info.target.kind === "asset" ? { width: options.width ?? 176, height: options.height ?? 166 } : null;
      const draft = await mcstudioApi.generateTexture(target.id, {
        target: info.target,
        description: text(args.description),
        provider,
        model: model.id,
        options,
        allowPaid,
        prompt: { style: "vanilla", extra: "", withReference: false, width: gui?.width ?? null, height: gui?.height ?? null, transparent: options.transparent },
        customPrompt: null,
        reference: null,
      });
      return finishTexture(target.id, info, draft, args.apply !== false);
    },
  },
  {
    name: "import_texture",
    description: "Utilise une image du disque comme texture (convertie en pixel art de la taille voulue, ou gardée telle quelle) et l'écrit dans le projet.",
    params: { ...textureParams, path: { type: "string", description: "Image (PNG, JPEG, WebP).", required: true } },
    risk: "write",
    run: async (args, ctx) => {
      const target = await targetProject(args, ctx);
      if (!target) return notFound;
      const info = await texture(target.id, args.texture);
      if (!info) return { ok: false, message: `Texture introuvable : « ${text(args.texture)} ». Appelle list_textures.` };
      const draft = await mcstudioApi.importTexture(target.id, info.target, text(args.path), conversion(info, args));
      return finishTexture(target.id, info, draft, args.apply !== false);
    },
  },
  {
    name: "delete_textures",
    description: "Supprime des textures du projet (par exemple celles qu'aucun modèle n'utilise).",
    params: { ...projectParam, textures: { type: "array", description: "Textures (noms, identifiants ou chemins relatifs).", required: true } },
    risk: "destructive",
    confirm: (args) => `Supprimer ${Array.isArray(args.textures) ? args.textures.length : 0} texture(s) du projet ?`,
    run: async (args, ctx) => {
      const target = await targetProject(args, ctx);
      if (!target) return notFound;
      const found = await Promise.all((args.textures as unknown[]).map((ref) => texture(target.id, ref)));
      const paths = found.filter((t): t is TextureInfo => Boolean(t?.exists)).map((t) => t.relative);
      if (paths.length === 0) return { ok: false, message: "Aucune de ces textures n'existe." };
      const count = await mcstudioApi.deleteTextures(target.id, paths);
      return { ok: true, message: `${count} texture${count > 1 ? "s" : ""} supprimée${count > 1 ? "s" : ""}.` };
    },
  },
  {
    name: "list_snapshots",
    description: "Points de restauration du projet (automatiques avant un portage ou une modification par l'IA, ou créés à la main).",
    params: projectParam,
    risk: "read",
    run: async (args, ctx) => {
      const target = await targetProject(args, ctx);
      if (!target) return notFound;
      const list = await mcstudioApi.listSnapshots(target.id);
      return { ok: true, message: `${list.length} point${list.length > 1 ? "s" : ""} de restauration.`, data: { snapshots: list.map((p) => ({ id: p.id, label: p.label, kind: p.kind, createdAt: p.createdAt, files: p.files.length })) } };
    },
  },
  {
    name: "create_snapshot",
    description: "Crée un point de restauration du projet (sauvegarde des sources).",
    params: { ...projectParam, label: { type: "string", description: "Nom du point." } },
    risk: "write",
    run: async (args, ctx) => {
      const target = await targetProject(args, ctx);
      if (!target) return notFound;
      const snap = await mcstudioApi.createSnapshot(target.id, text(args.label) || "Sauvegarde");
      return { ok: true, message: `Point de restauration « ${snap.label} » créé.`, data: { id: snap.id } };
    },
  },
  {
    name: "restore_snapshot",
    description: "Remet le projet dans l'état d'un point de restauration (ou supprime ce point, delete à true).",
    params: {
      ...projectParam,
      snapshot: { type: "string", description: "Point visé : identifiant ou nom (list_snapshots).", required: true },
      delete: { type: "boolean", description: "Supprimer le point au lieu de le restaurer." },
    },
    risk: "destructive",
    confirm: (args) => (args.delete === true ? `Supprimer le point « ${String(args.snapshot)} » ?` : `Restaurer le projet au point « ${String(args.snapshot)} » ?`),
    run: async (args, ctx) => {
      const target = await targetProject(args, ctx);
      if (!target) return notFound;
      const snap = findByName(await mcstudioApi.listSnapshots(target.id), text(args.snapshot), (p) => p.label, (p) => p.id);
      if (!snap) return { ok: false, message: "Point de restauration introuvable (list_snapshots)." };
      if (args.delete === true) await mcstudioApi.deleteSnapshot(target.id, snap.id);
      else await mcstudioApi.restoreSnapshot(target.id, snap.id);
      return { ok: true, message: args.delete === true ? `Point « ${snap.label} » supprimé.` : `Projet restauré au point « ${snap.label} ».` };
    },
  },
  {
    name: "export_project",
    description: "Exporte les sources du projet dans une archive .zip (à partager ou sauvegarder).",
    params: { ...projectParam, destination: { type: "string", description: "Fichier .zip ou dossier de destination.", required: true } },
    risk: "write",
    run: async (args, ctx) => {
      const target = await targetProject(args, ctx);
      if (!target) return notFound;
      const outcome = await mcstudioApi.exportZip(target.id, text(args.destination));
      return { ok: true, message: `Archive écrite : ${outcome.path} (${outcome.files} fichiers).${outcome.warnings.length ? ` À vérifier : ${outcome.warnings.join(" ")}` : ""}`, data: { path: outcome.path } };
    },
  },
  {
    name: "import_project",
    description: "Ajoute à Mod Studio un projet de mod existant (dossier Gradle Fabric, Forge ou NeoForge).",
    params: { path: { type: "string", description: "Dossier du projet.", required: true } },
    risk: "write",
    run: async (args) => {
      try {
        const imported = await mcstudioApi.importProject(text(args.path));
        const store = useMcStudioStore.getState();
        store.upsert(imported);
        store.open(imported.id);
        return { ok: true, message: `${nameOf(imported)} ajouté à Mod Studio.`, open: { module: "mcstudio" } };
      } catch (e) {
        return failure(e);
      }
    },
  },
  {
    name: "duplicate_project",
    description: "Duplique un projet de mod (copie complète à côté).",
    params: projectParam,
    risk: "write",
    run: async (args, ctx) => {
      const target = await targetProject(args, ctx);
      if (!target) return notFound;
      const copy = await mcstudioApi.duplicateProject(target.id);
      useMcStudioStore.getState().upsert(copy);
      return { ok: true, message: `Copie créée : ${nameOf(copy)}.`, data: { projectId: copy.id } };
    },
  },
  {
    name: "port_project",
    description: "Porte le projet vers une autre version de Minecraft (point de restauration créé avant) ; renvoie ce qu'il reste à adapter dans le code.",
    params: { ...projectParam, minecraft: { type: "string", description: "Version visée (« 1.21.4 »).", required: true } },
    risk: "destructive",
    confirm: (args) => `Porter le projet vers Minecraft ${String(args.minecraft)} ?`,
    run: async (args, ctx) => {
      const target = await targetProject(args, ctx);
      if (!target) return notFound;
      const outcome = await mcstudioApi.portProject(target.id, text(args.minecraft));
      useMcStudioStore.getState().upsert(outcome.summary);
      return {
        ok: true,
        message: `Projet porté vers ${text(args.minecraft)}.${outcome.warnings.length ? ` Attention : ${outcome.warnings.slice(0, 3).join(" ")}` : ""}`,
        data: { done: outcome.done, warnings: outcome.warnings, codePrompt: outcome.prompt, snapshot: outcome.snapshot },
      };
    },
  },
  {
    name: "remove_project",
    description: "Retire un projet de Mod Studio ; delete_files à true met aussi son dossier à la Corbeille.",
    params: { project: { type: "string", description: "Nom ou identifiant du projet.", required: true }, delete_files: { type: "boolean", description: "Mettre aussi les fichiers à la Corbeille." } },
    risk: "destructive",
    confirm: (args) => `Retirer le projet « ${String(args.project)} »${args.delete_files === true ? " et mettre ses fichiers à la Corbeille" : ""} ?`,
    run: async (args) => {
      const target = await project(args.project, null);
      if (!target) return notFound;
      await mcstudioApi.removeProject(target.id, args.delete_files === true);
      useMcStudioStore.getState().forget(target.id);
      return { ok: true, message: `${nameOf(target)} retiré${args.delete_files === true ? ", fichiers à la Corbeille" : ""}.` };
    },
  },
]);
