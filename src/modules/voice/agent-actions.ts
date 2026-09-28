import type { AutoMode } from "@/core/engine/types";
import { defineActions, findByName } from "@/core/modules";
import { voiceApi } from "./api";
import type { ListenMode, SttEngineId, TtsEngineId, VoiceSettings } from "./lib/settings";
import { useVoiceStore } from "./store";
import { SECTIONS, isSection } from "./settings/sections";

const STT: SttEngineId[] = ["windows", "whisper", "openai", "groq", "elevenlabs", "voicebox", "custom"];
const TTS: TtsEngineId[] = ["system", "piper", "openai", "elevenlabs", "voicebox", "custom"];
const AUTO: AutoMode[] = ["off", "smart", "full"];
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Réglages de la voix modifiables par commande, appliqués tout de suite. */
function patchSettings(settings: VoiceSettings, args: Record<string, unknown>, changed: string[]): VoiceSettings {
  const next = structuredClone(settings);
  const set = (label: string, apply: () => void) => {
    apply();
    changed.push(label);
  };
  if (typeof args.language === "string" && args.language.trim()) set("langue", () => (next.general.language = args.language as string));
  if (args.listen_mode === "toggle" || args.listen_mode === "push") set("écoute", () => (next.general.mode = args.listen_mode as ListenMode));
  if (typeof args.continuous === "boolean") set("conversation continue", () => (next.general.continuous = args.continuous as boolean));
  if (args.progress === "off" || args.progress === "short" || args.progress === "detailed") set("annonces", () => (next.general.progress = args.progress as VoiceSettings["general"]["progress"]));
  if (typeof args.sounds === "boolean") set("sons", () => (next.general.sounds = args.sounds as boolean));
  if (typeof args.speak_permissions === "boolean") set("demandes lues", () => (next.general.speakPermissions = args.speak_permissions as boolean));
  if (typeof args.captions === "boolean") set("sous-titres", () => (next.overlay.captions = args.captions as boolean));
  if (typeof args.immersive === "boolean") set("plein écran à chaque conversation", () => (next.overlay.immersive = args.immersive as boolean));
  if (typeof args.volume === "number") set("volume", () => (next.speaker.volume = clamp(args.volume as number, 0, 1)));
  if (typeof args.speed === "number") set("débit", () => (next.tts.speed = clamp(args.speed as number, 0.5, 2)));
  if (STT.includes(args.stt_engine as SttEngineId)) set("reconnaissance", () => (next.stt.engine = args.stt_engine as SttEngineId));
  if (TTS.includes(args.tts_engine as TtsEngineId)) set("voix", () => (next.tts.engine = args.tts_engine as TtsEngineId));
  if (typeof args.voice === "string") set("voix choisie", () => (next.tts.voice = (args.voice as string) || null));
  if (args.brain === "cli" || args.brain === "local") set("qui répond", () => (next.agent.brain = args.brain as VoiceSettings["agent"]["brain"]));
  if (typeof args.agent === "string" && args.agent.trim()) set("agent", () => ((next.agent.adapter = (args.agent as string).trim()), (next.agent.model = null)));
  if (typeof args.model === "string") set("modèle", () => (next.agent.model = (args.model as string) || null));
  if (AUTO.includes(args.auto_mode as AutoMode)) set("autonomie", () => (next.agent.autoMode = args.auto_mode as AutoMode));
  if (typeof args.route_by_complexity === "boolean") set("modèle selon la tâche", () => (next.agent.routeByComplexity = args.route_by_complexity as boolean));
  if (typeof args.local_only === "boolean") set("mode local", () => (next.privacy.localOnly = args.local_only as boolean));
  return next;
}

/** Commandes du module Voice : réglages, historique (les outils MCP `speak`, `notify`… existent à part). */
export default defineActions([
  {
    name: "open_settings",
    description: "Affiche une section des réglages de la voix (reconnaissance, voix, modèles locaux, confidentialité…).",
    params: {
      section: { type: "string", description: "Section à afficher.", enum: SECTIONS.map((s) => s.id), required: true },
    },
    risk: "read",
    run: async (args) => {
      const section = isSection(args.section) ? args.section : "general";
      const label = SECTIONS.find((s) => s.id === section)?.label ?? section;
      return { ok: true, message: `Réglages de la voix : ${label}.`, open: { module: "voice", params: { section } } };
    },
  },
  {
    name: "enable_local_mode",
    description: "Passe la reconnaissance et la voix sur l'ordinateur (rien ne part en ligne pour ces étapes).",
    risk: "write",
    run: async () => {
      // L'écoute redémarre d'elle-même avec les moteurs locaux (VoiceRuntime).
      useVoiceStore.getState().setSettings((s) => ({ ...s, privacy: { ...s.privacy, localOnly: true } }));
      return { ok: true, message: "Mode local activé : reconnaissance et voix sur l'ordinateur." };
    },
  },
  {
    name: "voice_settings",
    description: "Réglages actuels de la voix : langue, écoute, moteurs, agent, modèle, autonomie, confidentialité.",
    risk: "read",
    run: async () => {
      const { general, stt, tts, agent, privacy, speaker, overlay } = useVoiceStore.getState().settings;
      return {
        ok: true,
        message: `Voix en ${general.language}, reconnaissance ${stt.engine}, voix ${tts.engine}, agent ${agent.brain === "local" ? "local" : agent.adapter}, autonomie ${agent.autoMode}.`,
        data: { general, stt: { engine: stt.engine, model: stt.model }, tts: { engine: tts.engine, voice: tts.voice, speed: tts.speed }, agent, privacy, volume: speaker.volume, overlay },
      };
    },
  },
  {
    name: "update_voice_settings",
    description:
      "Change des réglages de la voix (seuls ceux donnés) : langue (fr-FR, en-US…), écoute toggle ou push, conversation continue, annonces off/short/detailed, sons, lire les demandes de permission, sous-titres, plein écran, volume (0 à 1), débit (0,5 à 2), moteurs de reconnaissance et de voix, voix, qui répond (cli ou local), agent, modèle, autonomie (off, smart, full), modèle selon la tâche, mode local.",
    params: {
      language: { type: "string" },
      listen_mode: { type: "string", enum: ["toggle", "push"] },
      continuous: { type: "boolean" },
      progress: { type: "string", enum: ["off", "short", "detailed"] },
      sounds: { type: "boolean" },
      speak_permissions: { type: "boolean" },
      captions: { type: "boolean" },
      immersive: { type: "boolean" },
      volume: { type: "number" },
      speed: { type: "number" },
      stt_engine: { type: "string", enum: STT },
      tts_engine: { type: "string", enum: TTS },
      voice: { type: "string" },
      brain: { type: "string", enum: ["cli", "local"] },
      agent: { type: "string", description: "claude, antigravity, codex…" },
      model: { type: "string" },
      auto_mode: { type: "string", enum: AUTO },
      route_by_complexity: { type: "boolean" },
      local_only: { type: "boolean" },
    },
    risk: "write",
    run: async (args) => {
      const changed: string[] = [];
      const next = patchSettings(useVoiceStore.getState().settings, args, changed);
      if (changed.length === 0) return { ok: false, message: "Rien à changer." };
      useVoiceStore.getState().setSettings(() => next);
      return { ok: true, message: `Réglages de la voix changés : ${changed.join(", ")}.` };
    },
  },
  {
    name: "voice_history",
    description: "Sessions vocales passées (titre, date, nombre d'échanges).",
    risk: "read",
    run: async () => {
      const sessions = await voiceApi.sessions();
      return { ok: true, message: `${sessions.length} session${sessions.length > 1 ? "s" : ""} vocale${sessions.length > 1 ? "s" : ""}.`, data: { sessions: sessions.slice(0, 30) } };
    },
  },
  {
    name: "delete_voice_session",
    description: "Supprime une session vocale de l'historique.",
    params: { session: { type: "string", description: "Identifiant ou titre (voice_history).", required: true } },
    risk: "destructive",
    confirm: () => "Supprimer cette session vocale de l'historique ?",
    run: async (args) => {
      const sessions = await voiceApi.sessions();
      const found = findByName(sessions, String(args.session), (s) => s.title, (s) => s.id);
      if (!found) return { ok: false, message: "Session introuvable (voice_history)." };
      await voiceApi.deleteSession(found.id);
      return { ok: true, message: "Session supprimée de l'historique." };
    },
  },
]);
