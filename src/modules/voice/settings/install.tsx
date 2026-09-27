import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Check, Download, Loader2 } from "lucide-react";
import { Badge, Button } from "@/design-system/primitives";
import { voiceApi, type VoiceInstallProgress, type VoiceModelEntry, type VoiceModelProgress } from "../api";
import type { VoiceSettings } from "../lib/settings";
import { useVoiceStore } from "../store";

export const message = (e: unknown) => (e as { message?: string })?.message ?? String(e);
export const size = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} Go` : `${mb} Mo`);

/** Catalogue des modèles, tenu à jour par les téléchargements (`voice:model`). */
export function useModelCatalog() {
  const [models, setModels] = useState<VoiceModelEntry[] | null>(null);
  const [progress, setProgress] = useState<Record<string, VoiceModelProgress>>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void voiceApi
      .models()
      .then((list) => {
        setModels(list);
        setError(null);
      })
      .catch((e) => setError(message(e)));
  }, []);

  useEffect(() => {
    refresh();
    const stop = listen<VoiceModelProgress>("voice:model", ({ payload }) => {
      setProgress((current) => ({ ...current, [payload.id]: payload }));
      if (payload.status === "installed" || payload.status === "failed" || payload.status === "paused") refresh();
    });
    return () => void stop.then((fn) => fn());
  }, [refresh]);

  return { models, progress, error, refresh };
}

const installed = (m: VoiceModelEntry) => m.status === "installed" || m.status === "updateAvailable";

/**
 * Modèle conseillé pour cette machine : recommandé d'abord (le meilleur), sinon optionnel (le
 * plus léger) ; les voix suivent la langue choisie.
 */
export function recommended(models: VoiceModelEntry[], kind: VoiceModelEntry["kind"], language: string): VoiceModelEntry | null {
  const lang = language.split("-")[0]!.toLowerCase();
  const list = models.filter(
    (m) => m.kind === kind && m.fit !== "unsupported" && m.fit !== "notRecommended" && (kind !== "tts" || m.languages.some((l) => l.toLowerCase().startsWith(lang))),
  );
  const best = list.filter((m) => m.fit === "recommended").sort((a, b) => b.quality - a.quality || a.sizeMb - b.sizeMb)[0];
  return best ?? list.sort((a, b) => a.sizeMb - b.sizeMb)[0] ?? null;
}

/** Réglages qui mettent un modèle en service. */
export function activation(entry: VoiceModelEntry): (s: VoiceSettings) => VoiceSettings {
  switch (entry.kind) {
    case "stt":
      return (s) => ({ ...s, stt: { ...s.stt, engine: "whisper", model: entry.id } });
    case "tts":
      return (s) => ({ ...s, tts: { ...s.tts, engine: "piper", voice: entry.id, speaker: null } });
    case "llm":
      return (s) => ({ ...s, agent: { ...s.agent, localModel: entry.version } });
    default:
      return (s) => s;
  }
}

export function isActive(entry: VoiceModelEntry, settings: VoiceSettings): boolean {
  if (entry.kind === "stt") return settings.stt.engine === "whisper" && settings.stt.model === entry.id;
  if (entry.kind === "tts") return settings.tts.engine === "piper" && settings.tts.voice === entry.id;
  if (entry.kind === "llm") return settings.agent.localModel === entry.version;
  return false;
}

/** Installe (en tâche de fond) puis met en service ; tout de suite si déjà installé. */
export async function installAndUse(entry: VoiceModelEntry): Promise<void> {
  const store = useVoiceStore.getState();
  if (installed(entry)) {
    store.setSettings(activation(entry));
    return;
  }
  store.patch({ activateOnInstall: { ...store.activateOnInstall, [entry.id]: activation(entry) } });
  await voiceApi.download(entry.id);
}

/** Bouton d'un modèle : installer et utiliser, avancement, ou « Utilisé ». */
export function ModelInstallButton({
  entry,
  progress,
  onError,
  compact,
}: {
  entry: VoiceModelEntry;
  progress?: VoiceModelProgress;
  onError?: (text: string) => void;
  compact?: boolean;
}) {
  const settings = useVoiceStore((s) => s.settings);
  const status = progress?.status ?? entry.status;
  const running = status === "downloading" || status === "verifying" || status === "installing";
  if (installed(entry) && status !== "downloading" && isActive(entry, settings)) {
    return (
      <Badge tone="success">
        <Check size={11} strokeWidth={2} /> Utilisé
      </Badge>
    );
  }
  if (running) {
    const total = progress?.total ?? entry.total;
    const percent = total > 0 ? Math.round(((progress?.received ?? entry.received) / total) * 100) : null;
    return (
      <Button size="sm" variant="secondary" disabled icon={<Loader2 size={13} className="animate-spin" />}>
        {percent !== null ? `${percent} %` : "Installation"}
      </Button>
    );
  }
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={entry.fit === "unsupported"}
      onClick={() => void installAndUse(entry).catch((e) => onError?.(message(e)))}
      icon={installed(entry) ? undefined : <Download size={13} strokeWidth={1.75} />}
    >
      {installed(entry) ? "Utiliser" : compact ? "Installer" : `Installer et utiliser (${size(entry.sizeMb)})`}
    </Button>
  );
}

type ToolState = { busy: boolean; step: string | null; received: number; total: number; result: string | null; error: string | null };
const IDLE: ToolState = { busy: false, step: null, received: 0, total: 0, result: null, error: null };

/** Installations d'outils (Ollama, Voicebox, agents) avec leur avancement. */
export function useToolInstaller(onDone?: (id: string) => void) {
  const [state, setState] = useState<Record<string, ToolState>>({});

  useEffect(() => {
    const stop = listen<VoiceInstallProgress>("voice:install", ({ payload }) => {
      setState((s) => ({ ...s, [payload.id]: { ...(s[payload.id] ?? IDLE), busy: true, step: payload.step, received: payload.received, total: payload.total } }));
    });
    return () => void stop.then((fn) => fn());
  }, []);

  const install = useCallback(
    async (id: string) => {
      setState((s) => ({ ...s, [id]: { ...IDLE, busy: true, step: "Préparation" } }));
      try {
        const result = await voiceApi.installTool(id);
        setState((s) => ({ ...s, [id]: { ...IDLE, result } }));
      } catch (e) {
        setState((s) => ({ ...s, [id]: { ...IDLE, error: message(e) } }));
      } finally {
        onDone?.(id);
      }
    },
    [onDone],
  );

  return { state: (id: string) => state[id] ?? IDLE, install };
}

/** Avancement ou résultat d'une installation d'outil, sous sa ligne. */
export function ToolFeedback({ state }: { state: ToolState }) {
  if (state.busy) {
    const percent = state.total > 0 ? Math.min(100, Math.round((state.received / state.total) * 100)) : null;
    return (
      <div className="space-y-1 pb-3">
        {percent !== null && (
          <div className="h-1 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full origin-left rounded-full bg-accent transition-transform duration-[220ms]" style={{ transform: `scaleX(${percent / 100})` }} />
          </div>
        )}
        <p className="text-caption text-text-subtle" aria-live="polite">
          {state.step ?? "Installation"}
          {percent !== null ? ` · ${percent} %` : "…"}
        </p>
      </div>
    );
  }
  if (state.error) {
    return (
      <p role="alert" className="pb-3 text-footnote text-danger">
        {state.error}
      </p>
    );
  }
  if (state.result) {
    return (
      <p role="status" className="pb-3 text-footnote text-success">
        {state.result}
      </p>
    );
  }
  return null;
}
