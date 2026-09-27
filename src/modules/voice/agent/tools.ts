import type { VoicePriority } from "@/core/bus/event-bus";
import { currentContext } from "@/core/context";
import { checkArgs, describeModule, loadActions, type LoadedModule, type ModuleActions } from "@/core/modules";
import { useUiStore } from "@/core/stores/ui.store";
import { voiceApi, type McpCall, type McpReply } from "../api";
import { privacyRows } from "../lib/privacy";
import { useVoiceStore } from "../store";
import type { VoiceOrchestrator } from "./orchestrator";

const PRIORITIES: VoicePriority[] = ["low", "normal", "high", "critical"];
const str = (value: unknown) => (typeof value === "string" ? value : "");
const priorityOf = (value: unknown, fallback: VoicePriority): VoicePriority =>
  PRIORITIES.includes(value as VoicePriority) ? (value as VoicePriority) : fallback;

export type ToolDeps = {
  orchestrator: VoiceOrchestrator;
  modules: () => LoadedModule[];
};

let actionsCache: { key: string; value: Promise<ModuleActions[]> } | null = null;

/** Actions des modules actifs (rechargées quand la liste des modules change). */
export function moduleActions(modules: LoadedModule[]): Promise<ModuleActions[]> {
  const key = modules.map((m) => m.id).join(",");
  if (actionsCache?.key !== key) actionsCache = { key, value: loadActions(modules) };
  return actionsCache.value;
}

/**
 * Exécute un outil demandé par un agent (serveur MCP d'ARCHIMED). Chaque résultat dit
 * exactement ce qui a été fait ; une action sensible attend l'accord de la personne.
 */
export async function runTool(call: McpCall, deps: ToolDeps): Promise<McpReply> {
  const args = (call.arguments ?? {}) as Record<string, unknown>;
  const { orchestrator } = deps;
  const modules = deps.modules();
  switch (call.tool) {
    case "speak": {
      const text = str(args.text).trim();
      if (!text) return { ok: false, text: "Texte vide." };
      orchestrator.say(text, priorityOf(args.priority, "normal"), "notice", "agent");
      return { ok: true, text: "Dit à voix haute." };
    }
    case "notify": {
      const text = str(args.text).trim();
      if (!text) return { ok: false, text: "Texte vide." };
      const priority = priorityOf(args.priority, "low");
      orchestrator.say(text, priority, "notice", "agent");
      return { ok: true, text: priority === "low" ? "Notification en attente d'un moment calme." : "Notification transmise." };
    }
    case "get_voice_state": {
      const store = useVoiceStore.getState();
      const rows = privacyRows(store.settings, store.settings.agent.adapter);
      return {
        ok: true,
        text: `Voix : ${store.status}. Reconnaissance ${store.settings.stt.engine}, voix ${store.settings.tts.engine}.`,
        data: {
          status: store.status,
          session: store.session?.id ?? null,
          stt: store.settings.stt.engine,
          tts: store.settings.tts.engine,
          privacy: Object.fromEntries(rows.map((r) => [r.stage, r.location])),
        },
      };
    }
    case "get_context": {
      const context = currentContext();
      const active = modules.find((m) => m.id === context.activeModule);
      return {
        ok: true,
        text: `Module affiché : ${active?.name ?? context.activeModule}.`,
        data: { ...context, activeModuleName: active?.name ?? context.activeModule },
      };
    }
    case "list_modules": {
      const withActions = await moduleActions(modules);
      const list = modules.map((module) => {
        const entry = withActions.find((e) => e.module.id === module.id);
        return entry ? describeModule(entry) : describeModule({ module, actions: [] });
      });
      return { ok: true, text: `${list.length} modules actifs.`, data: { modules: list } };
    }
    case "open_module": {
      const id = str(args.module);
      const module = modules.find((m) => m.id === id);
      if (!module) return { ok: false, text: `Module inconnu ou désactivé : ${id}.` };
      const params = args.params && typeof args.params === "object" ? (args.params as Record<string, unknown>) : null;
      if (params) useUiStore.getState().openModule(id, params);
      else useUiStore.getState().navigate(id);
      return { ok: true, text: `${module.name} est affiché.` };
    }
    case "run_action": {
      const moduleId = str(args.module);
      const actionName = str(args.action);
      const params = (args.arguments && typeof args.arguments === "object" ? args.arguments : {}) as Record<string, unknown>;
      const entry = (await moduleActions(modules)).find((e) => e.module.id === moduleId);
      const action = entry?.actions.find((a) => a.name === actionName);
      if (!entry || !action) {
        return { ok: false, text: `Action inconnue : ${moduleId}.${actionName}. Appelle list_modules pour voir les actions disponibles.` };
      }
      const problem = checkArgs(action, params);
      if (problem) return { ok: false, text: problem };
      if (action.risk === "destructive") {
        const question = action.confirm?.(params) ?? `${entry.module.name} : ${action.description} Je continue ?`;
        const answer = await orchestrator.confirm(question, entry.module.name);
        if (answer === "no") return { ok: false, text: "La personne a refusé : rien n'a été fait." };
      }
      try {
        const result = await action.run(params, {
          context: currentContext(),
          openModule: (id, p) => (p ? useUiStore.getState().openModule(id, p) : useUiStore.getState().navigate(id)),
        });
        if (result.open) {
          const { module, params: openParams } = result.open;
          if (openParams) useUiStore.getState().openModule(module, openParams);
          else useUiStore.getState().navigate(module);
        }
        return { ok: result.ok, text: result.message, data: result.data ?? null };
      } catch (e) {
        return { ok: false, text: `Échec de ${entry.module.name} : ${(e as { message?: string }).message ?? String(e)}` };
      }
    }
    case "start_task": {
      const prompt = str(args.prompt).trim();
      if (!prompt) return { ok: false, text: "Consigne vide." };
      try {
        const task = await orchestrator.startTask(prompt, {
          agent: str(args.agent) || undefined,
          cwd: str(args.cwd) || null,
          title: str(args.title) || undefined,
        });
        return {
          ok: true,
          text: `Tâche confiée (${task.id}) dans une conversation du module Chat. Elle est suivie : le résultat sera annoncé.`,
          data: { taskId: task.id, conversationId: task.conversationId },
        };
      } catch (e) {
        return { ok: false, text: (e as { message?: string }).message ?? "Tâche impossible à lancer." };
      }
    }
    case "task_status": {
      const id = str(args.taskId);
      const tasks = orchestrator.tasks().filter((t) => !id || t.id === id);
      if (id && tasks.length === 0) return { ok: false, text: `Tâche inconnue : ${id}.` };
      const text = tasks.length === 0 ? "Aucune tâche confiée." : tasks.map((t) => `${t.title} : ${t.status}${t.summary ? ` — ${t.summary}` : ""}`).join("\n");
      return { ok: true, text, data: { tasks } };
    }
    default:
      return { ok: false, text: `Outil inconnu : ${call.tool}.` };
  }
}

/** Répond au serveur MCP (jamais d'exception : l'agent attend une réponse). */
export async function handleCall(call: McpCall, deps: ToolDeps): Promise<void> {
  let reply: McpReply;
  try {
    reply = await runTool(call, deps);
  } catch (e) {
    reply = { ok: false, text: `Erreur d'ARCHIMED : ${(e as { message?: string }).message ?? String(e)}` };
  }
  await voiceApi.mcpRespond(call.callId, reply).catch(() => undefined);
}
