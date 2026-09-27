import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { bus } from "@/core/bus/event-bus";
import { useSessionStore } from "@/core/engine/session.store";
import { useChat } from "@/core/engine/useChat";
import { useEnabledModules } from "@/core/modules";
import { voiceApi, type McpCall } from "../api";
import { handleCall } from "../agent/tools";
import { matches, parseShortcut } from "../lib/shortcuts";
import { sttLocation } from "../lib/privacy";
import { useVoiceStore } from "../store";
import { orchestrator } from "./instance";

/**
 * Couche vocale, montée en permanence (slot `app.background`) : elle survit aux changements
 * de module. Exécute les outils demandés par les agents, fait parler les modules, suit les
 * tâches confiées, écoute les raccourcis clavier.
 */
export default function VoiceRuntime() {
  const chat = useChat();
  const modules = useEnabledModules();
  const settings = useVoiceStore((s) => s.settings);
  const loaded = useVoiceStore((s) => s.loaded);
  const voice = orchestrator();
  voice.chat = chat;
  voice.modules = modules;
  const modulesRef = useRef(modules);
  modulesRef.current = modules;

  useEffect(() => {
    void useVoiceStore.getState().load();
  }, []);

  // Outils MCP : l'interface est prête tant que ce composant est monté.
  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    void listen<McpCall>("voice:mcp-call", (event) => {
      void handleCall(event.payload, { orchestrator: voice, modules: () => modulesRef.current });
    }).then((unlisten) => {
      if (cancelled) unlisten();
      else stop = unlisten;
    });
    void voiceApi.bridgeReady(true).catch(() => undefined);
    return () => {
      cancelled = true;
      stop?.();
      void voiceApi.bridgeReady(false).catch(() => undefined);
    };
  }, [voice]);

  // N'importe quel module peut faire parler l'assistant (`bus.emit("voice.speak", …)`).
  useEffect(
    () =>
      bus.on("voice.speak", ({ text, priority, source }) => {
        voice.say(text, priority ?? "normal", "notice", source ?? "module");
      }),
    [voice],
  );

  // Tâches confiées : fin de tour → annonce du résultat.
  useEffect(
    () =>
      bus.on("engine.turn.completed", ({ conversationId, answer }) => {
        const conversation = useSessionStore.getState().sessions.find((s) => s.id === conversationId);
        const turn = [...(conversation?.timeline ?? [])].reverse().find((i) => i.kind === "turn");
        voice.finishTask(conversationId, turn?.kind === "turn" ? turn.ok : true, answer);
      }),
    [voice],
  );

  // Une tâche suivie attend une permission : on prévient (priorité haute).
  useEffect(() => {
    const warned = new Set<string>();
    return useSessionStore.subscribe((state) => {
      const tasks = useVoiceStore.getState().session?.tasks.filter((t) => t.status === "running") ?? [];
      for (const task of tasks) {
        const conversation = state.sessions.find((s) => s.id === task.conversationId);
        const prompt = conversation?.pendingPromptId;
        if (conversation?.status === "awaiting" && prompt && !warned.has(prompt)) {
          warned.add(prompt);
          voice.say(`La tâche « ${task.title} » attend ta permission dans le module Chat.`, "high", "notice", "task");
        }
      }
    });
  }, [voice]);

  // Réglages modifiés : la voix est recréée à la phrase suivante, l'écoute redémarre (micro ouvert).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useVoiceStore.subscribe((state, prev) => {
      const next = state.settings;
      const before = prev.settings;
      if (next === before) return;
      if (next.tts !== before.tts || next.speaker !== before.speaker || next.general.language !== before.general.language) {
        voice.resetVoice();
      }
      const listening =
        next.stt !== before.stt ||
        next.microphone !== before.microphone ||
        next.privacy !== before.privacy ||
        next.performance !== before.performance ||
        next.general.language !== before.general.language;
      if (listening && state.micOn) {
        clearTimeout(timer);
        timer = setTimeout(() => void voice.restartEngines(), 700);
      }
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [voice]);

  // Raccourcis clavier : bascule et « appuyer pour parler ».
  useEffect(() => {
    const toggle = parseShortcut(settings.shortcuts.toggle);
    const push = parseShortcut(settings.shortcuts.pushToTalk);
    let holding = false;
    const down = (event: KeyboardEvent) => {
      if (matches(toggle, event)) {
        event.preventDefault();
        void voice.toggle();
      } else if (matches(push, event)) {
        event.preventDefault();
        if (!holding) {
          holding = true;
          voice.pushStart();
        }
      }
    };
    const up = (event: KeyboardEvent) => {
      if (holding && (event.key === " " || event.key.toLowerCase() === push?.key)) {
        holding = false;
        voice.pushEnd();
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [voice, settings.shortcuts.toggle, settings.shortcuts.pushToTalk]);

  // Mot d'éveil : l'écoute démarre avec l'application, seulement si la reconnaissance est locale.
  useEffect(() => {
    if (!loaded || settings.general.mode !== "wake") return;
    if (sttLocation(settings) !== "local") {
      useVoiceStore.getState().patch({
        error: "Mot d'éveil : choisissez une reconnaissance locale (Windows ou Whisper), sinon tout ce que vous dites partirait en ligne.",
      });
      return;
    }
    void voice.start();
    // Démarrage unique au chargement ou au changement de mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, settings.general.mode]);

  useEffect(() => () => void voice.stop(), [voice]);

  return null;
}
