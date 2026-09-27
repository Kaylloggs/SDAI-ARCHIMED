import { bus } from "@/core/bus/event-bus";
import { defineActions, findByName } from "@/core/modules";
import type { ProjectSummary } from "@/core/ipc/bindings/ProjectSummary";
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
    name: "build_project",
    description: "Compile un projet de mod avec Gradle (jar dans dist/). Rend la main tout de suite ; le résultat est annoncé à la fin.",
    params: { project: { type: "string", description: "Nom ou identifiant ; par défaut le projet ouvert." } },
    risk: "write",
    run: async (args, ctx) => {
      const current = ctx.context.modules["mcstudio"]?.details?.["projectId"];
      const target = await project(args.project, typeof current === "string" ? current : null);
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
