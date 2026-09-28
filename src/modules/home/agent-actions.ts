import { useSessionStore } from "@/core/engine/session.store";
import { defineActions, findByName } from "@/core/modules";
import { useUiStore } from "@/core/stores/ui.store";

const recent = () => [...useSessionStore.getState().sessions].sort((a, b) => b.updatedAt - a.updatedAt);

/** Commandes de l'Accueil : reprendre un travail récent (les autres modules s'ouvrent avec leur commande `open`). */
export default defineActions([
  {
    name: "recent_work",
    description: "Travaux récents de tous les modules (conversations du Chat, de Code, de Mod Studio…), les plus récents d'abord.",
    risk: "read",
    run: async () => {
      const list = recent().slice(0, 10);
      return {
        ok: true,
        message: list.length === 0 ? "Aucun travail récent." : `Derniers travaux : ${list.slice(0, 5).map((s) => s.title).join(", ")}.`,
        data: { recent: list.map((s) => ({ id: s.id, title: s.title, module: s.origin, folder: s.cwd, updatedAt: s.updatedAt })) },
      };
    },
  },
  {
    name: "resume_work",
    description: "Reprend un travail récent dans son module (comme un clic sur l'accueil).",
    params: { work: { type: "string", description: "Titre ou identifiant (recent_work).", required: true } },
    risk: "read",
    run: async (args) => {
      const found = findByName(recent(), String(args.work), (s) => s.title, (s) => s.id);
      if (!found) return { ok: false, message: `Travail introuvable : « ${String(args.work)} ». Appelle recent_work.` };
      const ui = useUiStore.getState();
      if (found.origin === "code" && found.cwd) ui.openModule("code", { cwd: found.cwd });
      else if (found.origin !== "chat") ui.openModule(found.origin, { conversationId: found.id });
      else {
        useSessionStore.getState().setActive(found.id);
        ui.navigate("chat");
      }
      return { ok: true, message: `« ${found.title} » repris.` };
    },
  },
]);
