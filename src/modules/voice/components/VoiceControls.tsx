import { LogOut, Mic, MicOff, Pause, Play, Square } from "lucide-react";
import { Button, Kbd } from "@/design-system/primitives";
import { busy } from "../lib/status";
import { shortcutLabel } from "../lib/shortcuts";
import { orchestrator } from "../runtime/instance";
import { useVoiceStore } from "../store";

/** Contrôles de la session vocale (panneau de la pastille et page du module). */
export function VoiceControls() {
  const status = useVoiceStore((s) => s.status);
  const micOn = useVoiceStore((s) => s.micOn);
  const hasSession = useVoiceStore((s) => s.session !== null);
  const mode = useVoiceStore((s) => s.settings.general.mode);
  const shortcuts = useVoiceStore((s) => s.settings.shortcuts);
  const voice = orchestrator();
  const keys = shortcutLabel(mode === "push" ? shortcuts.pushToTalk : shortcuts.toggle);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        {hasSession && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void voice.endSession()}
            icon={<LogOut size={13} strokeWidth={1.75} />}
            title="Termine la conversation : l'agent oublie son contexte, l'historique reste consultable"
          >
            Terminer
          </Button>
        )}
        <span className="flex-1" />
        {status === "paused" ? (
          <Button size="sm" variant="ghost" onClick={() => voice.continueSpeech()} icon={<Play size={13} strokeWidth={1.75} />}>
            Reprendre
          </Button>
        ) : (
          status === "speaking" && (
            <Button size="sm" variant="ghost" onClick={() => voice.pauseSpeech()} icon={<Pause size={13} strokeWidth={1.75} />}>
              Pause
            </Button>
          )
        )}
        {busy(status) && (
          <Button size="sm" variant="ghost" onClick={() => voice.cancel()} icon={<Square size={12} strokeWidth={2} />}>
            Arrêter
          </Button>
        )}
        <Button
          size="sm"
          variant={micOn ? "secondary" : "primary"}
          onClick={() => void voice.toggle()}
          icon={micOn ? <MicOff size={13} strokeWidth={1.75} /> : <Mic size={13} strokeWidth={1.75} />}
          aria-pressed={micOn}
        >
          {micOn ? "Couper le micro" : hasSession ? "Écouter" : "Commencer"}
        </Button>
      </div>
      <p className="flex items-center justify-end gap-1 text-caption text-text-subtle">
        {mode === "push" ? "Maintenir" : "Micro"}
        {keys.map((key) => (
          <Kbd key={key}>{key}</Kbd>
        ))}
      </p>
    </div>
  );
}
