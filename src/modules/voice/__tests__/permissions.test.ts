import { afterEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "@/core/engine/session.store";
import { VoiceOrchestrator } from "../agent/orchestrator";
import { runTool } from "../agent/tools";
import { DEFAULT_SETTINGS, normalizeSettings } from "../lib/settings";
import { useVoiceStore } from "../store";

const withSettings = (speakPermissions: boolean) =>
  useVoiceStore.getState().patch({
    settings: { ...DEFAULT_SETTINGS, general: { ...DEFAULT_SETTINGS.general, speakPermissions, sounds: false } },
    confirmation: null,
    panelOpen: false,
  });

describe("demandes de permission", () => {
  let voice: VoiceOrchestrator | null = null;
  afterEach(() => {
    voice?.dispose();
    voice = null;
    vi.restoreAllMocks();
  });

  it("ne sont pas lues par défaut, même dans des réglages enregistrés avant", () => {
    expect(normalizeSettings({}).general.speakPermissions).toBe(false);
    // Réglages d'une version précédente : l'ancienne valeur par défaut (lues) est oubliée.
    expect(normalizeSettings({ general: { speakPermissions: true } }).general.speakPermissions).toBe(false);
    // Choix fait depuis : gardé.
    expect(normalizeSettings({ revision: 2, general: { speakPermissions: true } }).general.speakPermissions).toBe(true);
    expect(normalizeSettings({ revision: 1 }).revision).toBe(2);
  });

  it("désactivées : rien n'est dit, le panneau s'ouvre avec la question et la réponse arrive par les boutons", async () => {
    withSettings(false);
    voice = new VoiceOrchestrator();
    const say = vi.spyOn(voice, "say").mockImplementation(() => undefined);
    const answer = voice.confirm("Supprimer le tableau Roadmap ?", "Planner");
    const state = useVoiceStore.getState();
    expect(say).not.toHaveBeenCalled();
    expect(state.panelOpen).toBe(true);
    expect(state.confirmation?.question).toBe("Supprimer le tableau Roadmap ?");
    voice.resolve(state.confirmation!.id, "yes");
    await expect(answer).resolves.toBe("yes");
    expect(useVoiceStore.getState().confirmation).toBeNull();

    voice.announcePermission("La tâche « Tests » attend ta permission dans le module Chat.", "task");
    expect(say).not.toHaveBeenCalled();
  });

  it("activées : la question est dite", () => {
    withSettings(true);
    voice = new VoiceOrchestrator();
    const say = vi.spyOn(voice, "say").mockImplementation(() => undefined);
    void voice.confirm("Lancer la commande ?", "agent");
    voice.announcePermission("La tâche attend ta permission.", "task");
    expect(say).toHaveBeenCalledTimes(2);
  });

  it("l'autonomie choisie s'applique tout de suite à la conversation en cours", async () => {
    withSettings(true);
    const settings = useVoiceStore.getState().settings;
    useVoiceStore.getState().patch({ settings: { ...settings, agent: { ...settings.agent, autoMode: "full" } } });
    useVoiceStore.setState({ session: { id: "v", title: "t", startedAt: 0, updatedAt: 0, turns: [], tasks: [], conversationId: "c1", agent: "claude", brain: "cli" } });
    useSessionStore.setState({ sessions: [{ id: "c1", autoMode: "smart", timeline: [], status: "idle" } as never] });
    voice = new VoiceOrchestrator();
    const setAutoMode = vi.fn(async () => undefined);
    voice.chat = { setAutoMode } as never;
    await voice.applyAutonomy();
    expect(setAutoMode).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }), "full");
    useSessionStore.setState({ sessions: [] });
    useVoiceStore.setState({ session: null });
  });

  it("« Tout accepter » : une action sensible d'un module passe sans question", async () => {
    withSettings(true);
    const settings = useVoiceStore.getState().settings;
    voice = new VoiceOrchestrator();
    const confirm = vi.spyOn(voice, "confirm").mockResolvedValue("no");
    const run = vi.fn(async () => ({ ok: true, message: "Supprimé." }));
    const planner = { id: "planner", name: "Planner", actions: () => Promise.resolve({ default: [{ name: "delete_board", description: "Supprime.", risk: "destructive", run }] }) };
    const deps = { orchestrator: voice, modules: () => [planner as never] };
    const call = { id: "1", tool: "run_action", arguments: { module: "planner", action: "delete_board", arguments: {} } };

    useVoiceStore.getState().patch({ settings: { ...settings, agent: { ...settings.agent, autoMode: "smart" } } });
    await expect(runTool(call as never, deps)).resolves.toMatchObject({ ok: false });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();

    useVoiceStore.getState().patch({ settings: { ...settings, agent: { ...settings.agent, autoMode: "full" } } });
    await expect(runTool(call as never, deps)).resolves.toMatchObject({ ok: true, text: "Supprimé." });
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});
