import { allModules, defineActions, findByName, type ModuleTutorial } from "@/core/modules";
import createModule from "./content/create-module";
import start from "./content/start";
import { CREATE_MODULE_TOPIC, START_TOPIC, useTutorialStore } from "./store";

type Guide = { id: string; title: string; tutorial: ModuleTutorial };

/** Tutoriels lisibles : premiers pas, chaque module qui en a un, créer un module. */
function guides(): Guide[] {
  return [
    { id: START_TOPIC, title: "Premiers pas", tutorial: start },
    ...allModules.filter((m) => m.tutorial).map((m) => ({ id: m.id, title: m.name, tutorial: m.tutorial! })),
    { id: CREATE_MODULE_TOPIC, title: "Créer un module", tutorial: createModule },
  ];
}

const guide = (ref: unknown) => findByName(guides(), String(ref ?? ""), (g) => g.title, (g) => g.id);
const missing = (ref: unknown) => ({ ok: false, message: `Aucun tutoriel pour « ${String(ref)} ». Appelle list_tutorials.` });

/** Commandes du Tutoriel : lire ou afficher le mode d'emploi de l'application et de chaque module. */
export default defineActions([
  {
    name: "list_tutorials",
    description: "Tutoriels disponibles (premiers pas, un par module, créer un module) et ceux déjà terminés.",
    risk: "read",
    run: async () => {
      const done = useTutorialStore.getState().done;
      const list = guides().map((g) => ({ id: g.id, title: g.title, summary: g.tutorial.summary, steps: g.tutorial.steps.length, done: Boolean(done[g.id]) }));
      return { ok: true, message: `${list.length} tutoriels.`, data: { tutorials: list } };
    },
  },
  {
    name: "explain",
    description: "Mode d'emploi d'un module ou de l'application, étape par étape (pour l'expliquer à la personne).",
    params: { topic: { type: "string", description: "Module (nom ou identifiant), « start » ou « create-module ».", required: true } },
    risk: "read",
    run: async (args) => {
      const found = guide(args.topic);
      if (!found) return missing(args.topic);
      const { summary, steps, tips } = found.tutorial;
      return {
        ok: true,
        message: summary,
        data: { title: found.title, steps: steps.map((s) => ({ title: s.title, text: s.text, keys: s.keys ?? null })), tips: tips ?? [] },
      };
    },
  },
  {
    name: "show_tutorial",
    description: "Affiche un tutoriel à l'écran, à une étape donnée si besoin (1 pour la première).",
    params: {
      topic: { type: "string", description: "Module (nom ou identifiant), « start » ou « create-module ».", required: true },
      step: { type: "number", description: "Étape à afficher (1 pour la première)." },
    },
    risk: "read",
    run: async (args) => {
      const found = guide(args.topic);
      if (!found) return missing(args.topic);
      const store = useTutorialStore.getState();
      if (typeof args.step === "number") {
        const step = Math.min(found.tutorial.steps.length, Math.max(1, Math.round(args.step))) - 1;
        store.setStep(found.id, step);
      }
      return { ok: true, message: `Tutoriel ${found.title} affiché.`, open: { module: "tutorial", params: { topic: found.id } } };
    },
  },
  {
    name: "set_tutorial_done",
    description: "Marque un tutoriel comme terminé, ou le recommence depuis le début (done à false).",
    params: {
      topic: { type: "string", description: "Module, « start » ou « create-module ».", required: true },
      done: { type: "boolean", description: "false : recommencer (true par défaut)." },
    },
    risk: "write",
    run: async (args) => {
      const found = guide(args.topic);
      if (!found) return missing(args.topic);
      const store = useTutorialStore.getState();
      if (args.done === false) store.restart(found.id);
      else store.finish(found.id);
      return { ok: true, message: args.done === false ? `Tutoriel ${found.title} remis au début.` : `Tutoriel ${found.title} marqué comme terminé.` };
    },
  },
]);
