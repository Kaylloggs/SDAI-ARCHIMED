import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceOrchestrator } from "../agent/orchestrator";
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

  it("sont lues à voix haute par défaut", () => {
    expect(normalizeSettings({}).general.speakPermissions).toBe(true);
    expect(normalizeSettings({ general: { speakPermissions: false } }).general.speakPermissions).toBe(false);
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
});
