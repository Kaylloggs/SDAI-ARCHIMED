import { useEffect, useRef, useState } from "react";
import { Mic, Square, Volume2 } from "lucide-react";
import { Button, Select } from "@/design-system/primitives";
import { MicCapture, listDevices } from "../audio/capture";
import { earcon } from "../audio/player";
import { Group, Row, Segmented, Slider, Switch, TextInput } from "../components/controls";
import { sttLocation } from "../lib/privacy";
import type { ListenMode } from "../lib/settings";
import { orchestrator } from "../runtime/instance";
import { useVoiceSettings } from "./useVoiceSettings";

const LANGUAGES = [
  { value: "fr-FR", label: "Français (France)" },
  { value: "fr-CA", label: "Français (Canada)" },
  { value: "fr-BE", label: "Français (Belgique)" },
  { value: "fr-CH", label: "Français (Suisse)" },
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "es-ES", label: "Español" },
  { value: "de-DE", label: "Deutsch" },
  { value: "it-IT", label: "Italiano" },
  { value: "pt-BR", label: "Português (Brasil)" },
];

const MODES: Array<{ value: ListenMode; label: string; title: string }> = [
  { value: "toggle", label: "Clic", title: "Un clic ou le raccourci ouvre et coupe le micro" },
  { value: "push", label: "Maintenir", title: "Le micro n'écoute que tant que le raccourci est maintenu" },
  { value: "wake", label: "Mot d'éveil", title: "Le micro reste ouvert ; seules les phrases qui commencent par le mot d'éveil sont traitées" },
];

export function GeneralSection() {
  const { settings, update } = useVoiceSettings();
  const g = settings.general;
  const wakeNeedsLocal = g.mode === "wake" && sttLocation(settings) !== "local";
  return (
    <>
      <Group title="Conversation">
        <Row label="Langue" hint="Langue parlée, reconnue et répondue.">
          <Select label="Langue" value={g.language} options={LANGUAGES} onChange={(language) => update("general", { language })} className="w-56" />
        </Row>
        <Row label="Ouverture du micro" hint={MODES.find((m) => m.value === g.mode)?.title}>
          <Segmented label="Ouverture du micro" value={g.mode} options={MODES} onChange={(mode) => update("general", { mode })} />
        </Row>
        <Row label="Conversation continue" hint="Le micro reste ouvert après chaque réponse : vous enchaînez, et vous pouvez couper la parole à l'assistant.">
          <Switch label="Conversation continue" checked={g.continuous} onChange={(continuous) => update("general", { continuous })} />
        </Row>
        <Row label="Annonces pendant les longues tâches" hint="Où en est une tâche confiée à un agent, sans avoir à demander.">
          <Segmented
            label="Annonces"
            value={g.progress}
            options={[
              { value: "off", label: "Aucune" },
              { value: "short", label: "Brèves" },
              { value: "detailed", label: "Détaillées" },
            ]}
            onChange={(progress) => update("general", { progress })}
          />
        </Row>
        <Row
          label="Dire les demandes de permission"
          hint="Désactivé : rien n'est lu, un son retentit et le panneau s'ouvre avec les boutons Oui / Non. Vous pouvez toujours répondre à la voix."
        >
          <Switch label="Dire les demandes de permission" checked={g.speakPermissions} onChange={(speakPermissions) => update("general", { speakPermissions })} />
        </Row>
        <Row label="Sons d'état" hint="Un son discret quand le micro s'ouvre, se coupe, ou en cas d'erreur.">
          <Switch label="Sons d'état" checked={g.sounds} onChange={(sounds) => update("general", { sounds })} />
        </Row>
        <Row label="Transcription en direct" hint="Afficher ce que vous dites pendant que vous parlez.">
          <Switch label="Transcription en direct" checked={g.liveTranscript} onChange={(liveTranscript) => update("general", { liveTranscript })} />
        </Row>
      </Group>

      <Group
        title="Mot d'éveil"
        description="En mode « Mot d'éveil », le micro reste ouvert et seules les phrases qui commencent par ce mot sont traitées. Après une réponse, vous avez 20 secondes pour enchaîner sans le redire."
      >
        <Row label="Mot d'éveil" hint="Un mot rare évite les déclenchements par erreur (« Archimède », « Ok Archimède »).">
          <TextInput label="Mot d'éveil" value={g.wakeWord} onChange={(wakeWord) => update("general", { wakeWord })} className="w-48" />
        </Row>
        {wakeNeedsLocal && (
          <p role="alert" className="py-2.5 text-footnote text-warning">
            Le mot d'éveil demande une reconnaissance locale (Windows ou Whisper local) : avec un service en ligne, tout ce qui est dit près
            du micro partirait sur Internet. Le micro ne s'ouvrira pas tout seul tant que la reconnaissance est en ligne.
          </p>
        )}
      </Group>
    </>
  );
}

/** Test du micro : niveau réel et détection de la voix au réglage de sensibilité choisi. */
function MicTest({ deviceId, sensitivity, echoCancellation, noiseSuppression }: { deviceId: string | null; sensitivity: number; echoCancellation: boolean; noiseSuppression: boolean }) {
  const [running, setRunning] = useState(false);
  const [detected, setDetected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const capture = useRef<MicCapture | null>(null);

  const stop = () => {
    capture.current?.stop();
    capture.current = null;
    setRunning(false);
  };

  useEffect(() => stop, []);
  useEffect(() => {
    capture.current?.setSensitivity(sensitivity);
  }, [sensitivity]);

  const start = async () => {
    setError(null);
    setDetected(false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const mic = new MicCapture({
      onLevel: (level) => {
        if (bar.current) bar.current.style.transform = `scaleX(${Math.min(1, level).toFixed(3)})`;
      },
      onSpeechStart: () => {
        setDetected(true);
        clearTimeout(timer);
        timer = setTimeout(() => setDetected(false), 1200);
      },
      onUtterance: () => undefined,
      onError: (message) => setError(message),
    });
    try {
      await mic.start({ deviceId, sensitivity, echoCancellation, noiseSuppression, segmentation: "vad" });
      capture.current = mic;
      setRunning(true);
    } catch {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-2 py-3">
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant={running ? "secondary" : "ghost"}
          onClick={() => (running ? stop() : void start())}
          icon={running ? <Square size={12} strokeWidth={2} /> : <Mic size={13} strokeWidth={1.75} />}
        >
          {running ? "Arrêter le test" : "Tester le micro"}
        </Button>
        <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3" aria-hidden>
          <span ref={bar} className="absolute inset-0 origin-left scale-x-0 rounded-full bg-accent" />
        </span>
        <span className="w-28 text-right text-footnote text-text-muted" aria-live="polite">
          {running ? (detected ? "Voix détectée" : "Parlez…") : ""}
        </span>
      </div>
      {error && <p role="alert" className="text-footnote text-danger">{error}</p>}
    </div>
  );
}

export function AudioSection() {
  const { settings, update } = useVoiceSettings();
  const [devices, setDevices] = useState<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }>({ inputs: [], outputs: [] });
  const [testing, setTesting] = useState(false);
  const mic = settings.microphone;
  const speaker = settings.speaker;

  useEffect(() => {
    const refresh = () => void listDevices().then(setDevices);
    refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", refresh);
  }, []);

  const deviceOptions = (list: MediaDeviceInfo[], fallback: string) => [
    { value: "", label: fallback },
    ...list
      .filter((d) => d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications")
      .map((d, i) => ({ value: d.deviceId, label: d.label || `Appareil ${i + 1}` })),
  ];

  const testSpeaker = () => {
    setTesting(true);
    earcon("notice", 0.25 * Math.min(1, speaker.volume));
    orchestrator().resetVoice();
    orchestrator().say("Voici le son de la voix d'ARCHIMED.", "high", "reply", "voice");
    setTimeout(() => setTesting(false), 1500);
  };

  const namesHidden = devices.inputs.length > 0 && devices.inputs.every((d) => !d.label);

  return (
    <>
      <Group
        title="Micro"
        description={
          namesHidden
            ? "Les noms des micros apparaissent après la première autorisation d'accès au micro (lancez un test)."
            : "Choisir un micro précis évite qu'un casque débranché fasse basculer l'écoute sur un autre appareil."
        }
      >
        <Row label="Appareil">
          <Select
            label="Micro"
            value={mic.deviceId ?? ""}
            options={deviceOptions(devices.inputs, "Micro par défaut du système")}
            onChange={(deviceId) => update("microphone", { deviceId: deviceId || null })}
            className="w-64"
          />
        </Row>
        <Row label="Sensibilité" hint="Plus haut : une voix basse suffit. Plus bas : le bruit ambiant ne déclenche rien.">
          <Slider label="Sensibilité" value={mic.sensitivity} min={0} max={1} step={0.05} onChange={(sensitivity) => update("microphone", { sensitivity })} format={(v) => `${Math.round(v * 100)} %`} />
        </Row>
        <Row label="Annulation d'écho" hint="Empêche le micro de reprendre la voix de l'assistant (indispensable sans casque).">
          <Switch label="Annulation d'écho" checked={mic.echoCancellation} onChange={(echoCancellation) => update("microphone", { echoCancellation })} />
        </Row>
        <Row label="Réduction du bruit">
          <Switch label="Réduction du bruit" checked={mic.noiseSuppression} onChange={(noiseSuppression) => update("microphone", { noiseSuppression })} />
        </Row>
        <MicTest deviceId={mic.deviceId} sensitivity={mic.sensitivity} echoCancellation={mic.echoCancellation} noiseSuppression={mic.noiseSuppression} />
      </Group>

      <Group title="Haut-parleur">
        <Row label="Sortie" hint="Les voix du système utilisent toujours la sortie par défaut de Windows.">
          <Select
            label="Sortie audio"
            value={speaker.deviceId ?? ""}
            options={deviceOptions(devices.outputs, "Sortie par défaut du système")}
            onChange={(deviceId) => update("speaker", { deviceId: deviceId || null })}
            className="w-64"
          />
        </Row>
        <Row label="Volume de la voix">
          <Slider label="Volume" value={speaker.volume} min={0.2} max={1.5} step={0.05} onChange={(volume) => update("speaker", { volume })} format={(v) => `${Math.round(v * 100)} %`} />
        </Row>
        <div className="py-3">
          <Button size="sm" variant="ghost" onClick={testSpeaker} disabled={testing} icon={<Volume2 size={13} strokeWidth={1.75} />}>
            Écouter un exemple
          </Button>
        </div>
      </Group>
    </>
  );
}
