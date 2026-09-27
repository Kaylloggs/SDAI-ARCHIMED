import { useSessionStore } from "@/core/engine/session.store";
import { defineActions, findByName } from "@/core/modules";

const STATUS: Record<string, string> = {
  idle: "en attente",
  starting: "démarrage",
  running: "en cours",
  awaiting: "attend une réponse",
  ended: "terminée",
  error: "erreur",
};

/** Actions du Chat pour les agents (voix, MCP). */
export default defineActions([
  {
    name: "list_conversations",
    description: "Liste les conversations du Chat, les plus récentes d'abord, avec leur état.",
    risk: "read",
    run: async () => {
      const sessions = useSessionStore
        .getState()
        .sessions.filter((s) => s.origin === "chat")
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 20);
      const waiting = sessions.filter((s) => s.status === "awaiting").length;
      return {
        ok: true,
        message: `${sessions.length} conversation${sessions.length > 1 ? "s" : ""}${waiting > 0 ? `, dont ${waiting} qui attend${waiting > 1 ? "ent" : ""} une réponse` : ""}.`,
        data: {
          conversations: sessions.map((s) => ({ id: s.id, title: s.title, agent: s.adapter, status: STATUS[s.status] ?? s.status, folder: s.cwd })),
        },
      };
    },
  },
  {
    name: "open_conversation",
    description: "Affiche une conversation du Chat.",
    params: { conversation: { type: "string", description: "Titre ou identifiant.", required: true } },
    risk: "read",
    run: async (args) => {
      const sessions = useSessionStore.getState().sessions.filter((s) => s.origin === "chat");
      const target = findByName(sessions, String(args.conversation), (s) => s.title, (s) => s.id);
      if (!target) return { ok: false, message: `Conversation introuvable ou ambiguë : « ${String(args.conversation)} ».` };
      useSessionStore.getState().setActive(target.id);
      return { ok: true, message: `Conversation « ${target.title} » affichée.`, open: { module: "chat" } };
    },
  },
  {
    name: "prepare_message",
    description: "Ouvre le Chat avec un message déjà écrit dans la zone de saisie ; la personne le relit et l'envoie.",
    params: { text: { type: "string", description: "Message à préparer.", required: true } },
    risk: "read",
    run: async (args) => ({
      ok: true,
      message: "Message prêt dans le Chat : relisez-le puis envoyez-le.",
      open: { module: "chat", params: { prompt: String(args.text) } },
    }),
  },
]);
