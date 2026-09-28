import { conversationMarkdown } from "@/core/chat/transcript";
import { engineApi } from "@/core/engine/engine.api";
import { useSessionStore, type ChatSession } from "@/core/engine/session.store";
import type { AdapterInfo, AutoMode } from "@/core/engine/types";
import { defineActions, findByName, type ActionContext, type ActionResult, type ChatControls } from "@/core/modules";

const STATUS: Record<string, string> = {
  idle: "en attente",
  starting: "démarrage",
  running: "en cours",
  awaiting: "attend une réponse",
  ended: "terminée",
  error: "erreur",
};

const AUTO_MODES: AutoMode[] = ["off", "smart", "full"];

const conversations = () => useSessionStore.getState().sessions.filter((s) => s.origin === "chat");

/** Conversation désignée par son titre ou son identifiant ; sans précision, celle affichée. */
function conversation(ref: unknown): ChatSession | null {
  const wanted = typeof ref === "string" ? ref.trim() : "";
  const list = conversations();
  if (!wanted) return list.find((s) => s.id === useSessionStore.getState().activeId) ?? null;
  return findByName(list, wanted, (s) => s.title, (s) => s.id);
}

const noConversation = (ref: unknown): ActionResult => ({
  ok: false,
  message: ref ? `Conversation introuvable ou ambiguë : « ${String(ref)} ». Appelle list_conversations.` : "Aucune conversation affichée : précise laquelle (list_conversations).",
});
const noEngine: ActionResult = { ok: false, message: "Le moteur des conversations n'est pas disponible ici." };

/** Exécute une commande qui a besoin du moteur et d'une conversation. */
async function withConversation(
  args: Record<string, unknown>,
  ctx: ActionContext,
  run: (chat: ChatControls, session: ChatSession) => Promise<ActionResult>,
): Promise<ActionResult> {
  if (!ctx.chat) return noEngine;
  const session = conversation(args.conversation);
  if (!session) return noConversation(args.conversation);
  return run(ctx.chat, session);
}

async function adapter(ref: unknown): Promise<AdapterInfo | null> {
  const adapters = (await engineApi.listAdapters().catch(() => [] as AdapterInfo[])).filter((a) => a.installed);
  return findByName(adapters, String(ref ?? ""), (a) => a.name, (a) => a.id);
}

function model(info: AdapterInfo, ref: unknown): string | null {
  if (typeof ref !== "string" || !ref.trim()) return null;
  return findByName(info.models, ref, (m) => m.label, (m) => m.id)?.id ?? null;
}

const lastAnswer = (session: ChatSession) => {
  const last = [...session.timeline].reverse().find((item) => item.kind === "assistant");
  return last && "text" in last ? String(last.text) : null;
};

const conversationParam = { type: "string" as const, description: "Titre ou identifiant (sinon la conversation affichée)." };

/** Commandes du Chat : conversations avec les agents, de la création à l'export. */
export default defineActions([
  {
    name: "list_conversations",
    description: "Liste les conversations du Chat, les plus récentes d'abord, avec leur état, leur agent et leur dossier.",
    risk: "read",
    run: async () => {
      const sessions = conversations()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 30);
      const waiting = sessions.filter((s) => s.status === "awaiting").length;
      return {
        ok: true,
        message: `${sessions.length} conversation${sessions.length > 1 ? "s" : ""}${waiting > 0 ? `, dont ${waiting} qui attend${waiting > 1 ? "ent" : ""} une réponse` : ""}.`,
        data: {
          conversations: sessions.map((s) => ({
            id: s.id,
            title: s.title,
            agent: s.adapter,
            model: s.model,
            status: STATUS[s.status] ?? s.status,
            folder: s.cwd,
            autoMode: s.autoMode,
            planMode: Boolean(s.options?.planMode),
          })),
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
      const target = conversation(args.conversation);
      if (!target) return noConversation(args.conversation);
      useSessionStore.getState().setActive(target.id);
      return { ok: true, message: `Conversation « ${target.title} » affichée.`, open: { module: "chat" } };
    },
  },
  {
    name: "read_conversation",
    description: "Lit une conversation : derniers messages de la personne et de l'agent, demande en attente.",
    params: { conversation: conversationParam, last: { type: "number", description: "Nombre de messages (10 par défaut)." } },
    risk: "read",
    run: async (args) => {
      const target = conversation(args.conversation);
      if (!target) return noConversation(args.conversation);
      const count = Math.min(50, Math.max(1, Math.round(Number(args.last) || 10)));
      const messages = target.timeline
        .filter((item) => item.kind === "user" || item.kind === "assistant")
        .slice(-count)
        .map((item) => ({ role: item.kind, text: "text" in item ? String(item.text).slice(0, 4000) : "" }));
      const pending = target.timeline.find((item) => item.kind === "prompt" && !item.resolvedBy);
      return {
        ok: true,
        message: `« ${target.title} » : ${STATUS[target.status] ?? target.status}.`,
        data: {
          id: target.id,
          status: target.status,
          messages,
          pendingPrompt: pending?.kind === "prompt" ? { id: pending.id, title: pending.prompt.title, options: pending.prompt.options.map((o) => ({ id: o.id, label: o.label })) } : null,
        },
      };
    },
  },
  {
    name: "new_conversation",
    description:
      "Crée une conversation avec un agent (Claude Code, Antigravity, Codex), dans un dossier, et envoie le premier message si donné. Pour un travail de code suivi par la voix, préférer start_task.",
    params: {
      message: { type: "string", description: "Premier message à envoyer." },
      agent: { type: "string", description: "Agent (claude, antigravity, codex) ; sinon celui par défaut." },
      model: { type: "string", description: "Modèle (nom ou identifiant)." },
      folder: { type: "string", description: "Dossier de travail." },
      title: { type: "string", description: "Titre de la conversation." },
      plan: { type: "boolean", description: "Mode plan : l'agent propose un plan avant de modifier quoi que ce soit." },
    },
    risk: "write",
    run: async (args, ctx) => {
      if (!ctx.chat) return noEngine;
      const adapters = (await engineApi.listAdapters().catch(() => [] as AdapterInfo[])).filter((a) => a.installed);
      // Comme le bouton « Nouvelle conversation » : agent, modèle et autonomie de celle affichée.
      const current = conversation(undefined);
      const chosen = args.agent
        ? findByName(adapters, String(args.agent), (a) => a.name, (a) => a.id)
        : (adapters.find((a) => a.id === current?.adapter) ?? adapters[0]);
      if (!chosen) return { ok: false, message: args.agent ? `Agent introuvable ou non installé : ${String(args.agent)}.` : "Aucun agent installé (Réglages › Assistants IA)." };
      const cwd = typeof args.folder === "string" && args.folder.trim() ? args.folder.trim() : await engineApi.defaultCwd().catch(() => null);
      const id = ctx.chat.createSession({
        adapter: chosen.id,
        model: model(chosen, args.model) ?? (current?.adapter === chosen.id ? current.model : (chosen.defaultModel ?? null)),
        cwd,
        autoMode: current?.autoMode ?? "off",
        origin: "chat",
        title: typeof args.title === "string" && args.title.trim() ? args.title.trim() : undefined,
        options: args.plan === true ? { planMode: true } : undefined,
      });
      const text = typeof args.message === "string" ? args.message.trim() : "";
      const session = useSessionStore.getState().sessions.find((s) => s.id === id);
      if (text && session) await ctx.chat.send(session, text);
      return {
        ok: true,
        message: `Conversation ouverte avec ${chosen.name}${text ? ", message envoyé" : ""}.`,
        data: { conversationId: id, agent: chosen.id, folder: cwd },
        open: { module: "chat" },
      };
    },
  },
  {
    name: "send_message",
    description: "Envoie un message dans une conversation (mis en file si l'agent travaille encore).",
    params: { conversation: conversationParam, text: { type: "string", description: "Message.", required: true } },
    risk: "write",
    run: (args, ctx) =>
      withConversation(args, ctx, async (chat, session) => {
        const text = String(args.text).trim();
        if (session.status === "running" || session.status === "starting" || session.status === "awaiting") {
          chat.enqueue(session, text);
          return { ok: true, message: `Message mis en file dans « ${session.title} » : envoyé à la fin du tour.` };
        }
        await chat.send(session, text);
        return { ok: true, message: `Message envoyé dans « ${session.title} ».`, open: { module: "chat" } };
      }),
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
  {
    name: "stop_conversation",
    description: "Arrête l'agent en pleine réponse (la conversation est gardée).",
    params: { conversation: conversationParam },
    risk: "write",
    run: (args, ctx) =>
      withConversation(args, ctx, async (chat, session) => {
        await chat.stop(session);
        return { ok: true, message: `Agent arrêté dans « ${session.title} ».` };
      }),
  },
  {
    name: "answer_prompt",
    description:
      "Répond à la demande en attente d'une conversation (permission, question, plan) : option choisie (ex. allow, always, deny) et texte libre si la question en attend.",
    params: {
      conversation: conversationParam,
      option: { type: "string", description: "Identifiant de l'option (voir read_conversation)." },
      text: { type: "string", description: "Réponse libre." },
    },
    risk: "destructive",
    confirm: (args) => `Répondre « ${String(args.option ?? args.text ?? "")} » à la demande de l'agent ?`,
    run: (args, ctx) =>
      withConversation(args, ctx, async (chat, session) => {
        const pending = session.timeline.find((item) => item.kind === "prompt" && !item.resolvedBy);
        if (pending?.kind !== "prompt") return { ok: false, message: `Aucune demande en attente dans « ${session.title} ».` };
        const optionId = typeof args.option === "string" && args.option ? args.option : null;
        if (optionId && !pending.prompt.options.some((o) => o.id === optionId)) {
          return { ok: false, message: `Option inconnue. Options : ${pending.prompt.options.map((o) => o.id).join(", ")}.` };
        }
        await chat.answer(session, pending.id, { optionId: optionId ?? undefined, text: typeof args.text === "string" ? args.text : undefined });
        return { ok: true, message: `Réponse transmise à l'agent de « ${session.title} ».` };
      }),
  },
  {
    name: "rename_conversation",
    description: "Renomme une conversation.",
    params: { conversation: conversationParam, title: { type: "string", description: "Nouveau titre.", required: true } },
    risk: "write",
    run: (args, ctx) =>
      withConversation(args, ctx, async (chat, session) => {
        chat.patch(session.id, { title: String(args.title).trim() });
        return { ok: true, message: `Conversation renommée en « ${String(args.title).trim()} ».` };
      }),
  },
  {
    name: "set_conversation_options",
    description: "Change l'agent, le modèle, le dossier de travail, le mode plan ou l'autonomie (off, smart, full) d'une conversation.",
    params: {
      conversation: conversationParam,
      agent: { type: "string", description: "Nouvel agent (il ne connaîtra pas les messages précédents)." },
      model: { type: "string", description: "Modèle (nom ou identifiant)." },
      folder: { type: "string", description: "Dossier de travail." },
      plan: { type: "boolean", description: "Mode plan." },
      auto_mode: { type: "string", enum: AUTO_MODES, description: "off : tout demander ; smart : accepter ce qui est sûr ; full : tout accepter." },
    },
    risk: "write",
    run: (args, ctx) =>
      withConversation(args, ctx, async (chat, session) => {
        const changed: string[] = [];
        let current = session;
        const refresh = () => (current = useSessionStore.getState().sessions.find((s) => s.id === session.id) ?? current);
        if (args.agent) {
          const info = await adapter(args.agent);
          if (!info) return { ok: false, message: `Agent introuvable ou non installé : ${String(args.agent)}.` };
          await chat.setAdapter(current, info.id, model(info, args.model) ?? info.defaultModel ?? null, info.name);
          changed.push(`agent ${info.name}`);
          refresh();
        } else if (args.model) {
          const info = await adapter(current.adapter);
          const id = info ? model(info, args.model) : null;
          if (!id) return { ok: false, message: `Modèle introuvable pour ${current.adapter} : ${String(args.model)}.` };
          await chat.setModel(current, id);
          changed.push(`modèle ${id}`);
          refresh();
        }
        if (typeof args.folder === "string" && args.folder.trim()) {
          await chat.setCwd(current, args.folder.trim());
          changed.push(`dossier ${args.folder.trim()}`);
          refresh();
        }
        if (typeof args.plan === "boolean") {
          await chat.setPlanMode(current, args.plan);
          changed.push(args.plan ? "mode plan" : "sans mode plan");
          refresh();
        }
        if (typeof args.auto_mode === "string") {
          await chat.setAutoMode(current, args.auto_mode as AutoMode);
          changed.push(`autonomie ${args.auto_mode}`);
        }
        if (changed.length === 0) return { ok: false, message: "Rien à changer : donne agent, model, folder, plan ou auto_mode." };
        return { ok: true, message: `« ${session.title} » : ${changed.join(", ")}.` };
      }),
  },
  {
    name: "copy_conversation",
    description: "Copie une conversation en Markdown dans le presse-papiers (comme le bouton Copier).",
    params: { conversation: conversationParam },
    risk: "write",
    run: async (args) => {
      const target = conversation(args.conversation);
      if (!target) return noConversation(args.conversation);
      const info = await adapter(target.adapter);
      const text = conversationMarkdown(target, info?.name ?? target.adapter);
      await navigator.clipboard.writeText(text);
      return { ok: true, message: `Conversation « ${target.title} » copiée.`, data: { characters: text.length } };
    },
  },
  {
    name: "last_answer",
    description: "Dernière réponse de l'agent dans une conversation (texte).",
    params: { conversation: conversationParam },
    risk: "read",
    run: async (args) => {
      const target = conversation(args.conversation);
      if (!target) return noConversation(args.conversation);
      const text = lastAnswer(target);
      return text ? { ok: true, message: text.slice(0, 600), data: { text } } : { ok: false, message: "Pas encore de réponse dans cette conversation." };
    },
  },
  {
    name: "delete_conversation",
    description: "Supprime une conversation (l'agent est arrêté).",
    params: { conversation: { type: "string", description: "Titre ou identifiant.", required: true } },
    risk: "destructive",
    confirm: (args) => `Supprimer la conversation « ${String(args.conversation)} » ?`,
    run: (args, ctx) =>
      withConversation(args, ctx, async (chat, session) => {
        await chat.remove(session);
        return { ok: true, message: `Conversation « ${session.title} » supprimée.` };
      }),
  },
]);
