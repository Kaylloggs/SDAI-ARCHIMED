import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button, Kbd } from "@/design-system/primitives";
import { voiceApi } from "../api";
import { Group, LocationTag, Row, Segmented, Switch } from "../components/controls";
import { agentName } from "../lib/agents";
import { fullyOffline, privacyRows } from "../lib/privacy";
import { shortcutLabel } from "../lib/shortcuts";
import { useVoiceStore } from "../store";
import { useVoiceSettings } from "./useVoiceSettings";

const MODIFIERS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph"]);
const RESERVED = ["Ctrl+K", "Ctrl+C", "Ctrl+V", "Ctrl+X", "Ctrl+Z", "Ctrl+A", "Ctrl+S"];

/** Combinaison tapée → « Ctrl+Shift+Space ». `null` tant qu'il manque la touche principale. */
function comboOf(event: KeyboardEvent): string | null {
  if (MODIFIERS.has(event.key)) return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Meta");
  const key = event.code === "Space" ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  parts.push(key);
  return parts.join("+");
}

function ShortcutRecorder({ value, onChange, other, label }: { value: string; onChange: (value: string) => void; other: string; label: string }) {
  const [recording, setRecording] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecording(false);
        return;
      }
      const combo = comboOf(event);
      if (!combo) return;
      if (!event.ctrlKey && !event.altKey && !event.metaKey && !/^F\d+$/.test(event.key)) {
        setProblem("Ajoutez Ctrl ou Alt : une touche seule gênerait la saisie de texte.");
        return;
      }
      if (RESERVED.includes(combo)) {
        setProblem(`${shortcutLabel(combo).join(" ")} est déjà utilisé par l'application.`);
        return;
      }
      if (combo.toLowerCase() === other.toLowerCase()) {
        setProblem("Ce raccourci sert déjà à l'autre commande.");
        return;
      }
      setProblem(null);
      setRecording(false);
      onChange(combo);
    };
    // Phase de capture : le raccourci actuel ne se déclenche pas pendant l'enregistrement.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, onChange, other]);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        aria-label={`${label} : ${shortcutLabel(value).join(" ")}. Cliquer pour changer`}
        onClick={() => {
          setProblem(null);
          setRecording((r) => !r);
        }}
        className="flex h-7 min-w-40 cursor-pointer items-center justify-center gap-1 rounded-sm border border-border bg-surface-2 px-2 transition-colors duration-[80ms] hover:border-border-strong"
      >
        {recording ? (
          <span className="text-footnote text-text-muted">Tapez la combinaison… (Échap)</span>
        ) : (
          shortcutLabel(value).map((key) => <Kbd key={key}>{key}</Kbd>)
        )}
      </button>
      {problem && <p role="alert" className="text-caption text-warning">{problem}</p>}
    </div>
  );
}

export function ShortcutsSection() {
  const { settings, update } = useVoiceSettings();
  const s = settings.shortcuts;
  return (
    <Group title="Raccourcis clavier" description="Actifs partout dans ARCHIMED, quel que soit le module affiché.">
      <Row label="Ouvrir ou couper le micro" hint="Démarre une session si besoin.">
        <ShortcutRecorder label="Ouvrir ou couper le micro" value={s.toggle} other={s.pushToTalk} onChange={(toggle) => update("shortcuts", { toggle })} />
      </Row>
      <Row label="Maintenir pour parler" hint="L'assistant écoute tant que la combinaison est maintenue, et coupe sa propre parole.">
        <ShortcutRecorder label="Maintenir pour parler" value={s.pushToTalk} other={s.toggle} onChange={(pushToTalk) => update("shortcuts", { pushToTalk })} />
      </Row>
      <Row label="Commandes à la voix" hint="« Stop », « attends », « continue », « répète », « plus lentement », « qu'est-ce que tu fais ? », « ouvre… », « termine la session ».">
        <span />
      </Row>
    </Group>
  );
}

export function OverlaySection() {
  const { settings, update } = useVoiceSettings();
  const o = settings.overlay;
  return (
    <Group title="Pastille vocale" description="La pastille vit dans la barre de titre, à côté de la recherche, et reste visible dans tous les modules.">
      <Row label="Pastille compacte" hint="Seulement le micro et la vague, sans le libellé d'état.">
        <Switch label="Pastille compacte" checked={o.mini} onChange={(mini) => update("overlay", { mini })} />
      </Row>
      <Row label="Vague animée" hint="Désactivée, la vague garde une forme fixe par état. Suit aussi le réglage « Réduire les animations » du système.">
        <Switch label="Vague animée" checked={o.animations} onChange={(animations) => update("overlay", { animations })} />
      </Row>
      <Row label="Sous-titres" hint="Sous la pastille, ce que dit l'assistant et ce qu'il entend, panneau fermé.">
        <Switch label="Sous-titres" checked={o.captions} onChange={(captions) => update("overlay", { captions })} />
      </Row>
    </Group>
  );
}

export function PrivacySection() {
  const { settings, update } = useVoiceSettings();
  const [count, setCount] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const rows = privacyRows(settings, agentName(settings.agent.adapter));

  const refresh = () => void voiceApi.sessions().then((list) => setCount(list.length)).catch(() => setCount(null));
  useEffect(refresh, []);

  const clearHistory = async () => {
    setBusy(true);
    try {
      // La session en cours reste : elle est encore écrite à chaque échange.
      const current = useVoiceStore.getState().session?.id;
      const list = await voiceApi.sessions();
      await Promise.all(list.filter((s) => s.id !== current).map((s) => voiceApi.deleteSession(s.id)));
    } finally {
      setBusy(false);
      setConfirm(false);
      refresh();
    }
  };

  return (
    <>
      <Group
        title="Où passent vos données"
        description={fullyOffline(settings) ? "Tout se passe sur cet ordinateur : la voix fonctionne sans Internet." : "Les étapes « En ligne » envoient des données au service indiqué."}
      >
        {rows.map((row) => (
          <Row key={row.stage} label={row.stage} hint={row.detail}>
            <LocationTag location={row.location} />
          </Row>
        ))}
      </Group>

      <Group title="Protection">
        <Row label="Mode local" hint="Les moteurs en ligne sont remplacés par la reconnaissance et la voix de l'ordinateur. Aussi à la voix : « travaille en mode local ».">
          <Switch
            label="Mode local"
            checked={settings.privacy.localOnly}
            onChange={(localOnly) => update("privacy", { localOnly })}
          />
        </Row>
        <Row label="Secours en ligne" hint="Autoriser un moteur de secours en ligne quand le moteur local échoue. Désactivé, rien ne part en ligne sans que vous l'ayez choisi.">
          <Switch label="Secours en ligne" checked={settings.privacy.allowCloudFallback} onChange={(allowCloudFallback) => update("privacy", { allowCloudFallback })} />
        </Row>
      </Group>

      <Group
        title="Mémoire des conversations"
        description="Chaque session vocale est enregistrée sur cet ordinateur pour être relue. L'agent, lui, oublie tout à la fin de la session : sa conversation est supprimée. La mémoire vocale est séparée de la mémoire des autres modules."
      >
        <Row label="Historique" hint={count === null ? "…" : `${count} session${count > 1 ? "s" : ""} enregistrée${count > 1 ? "s" : ""}.`}>
          <div className="flex items-center gap-1">
            {confirm && (
              <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
                Annuler
              </Button>
            )}
            <Button
              size="sm"
              variant="danger"
              disabled={!count || busy}
              onClick={() => (confirm ? void clearHistory() : setConfirm(true))}
              icon={busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} strokeWidth={1.75} />}
            >
              {confirm ? "Confirmer la suppression" : "Tout supprimer"}
            </Button>
          </div>
        </Row>
      </Group>
    </>
  );
}

export function PermissionsSection() {
  const { settings, update } = useVoiceSettings();
  return (
    <>
      <Group
        title="Règle"
        description="Une commande vocale n'a jamais plus de droits qu'un message écrit. Chaque action d'un agent passe par les mêmes permissions que dans le Chat, et les actions sensibles des modules (supprimer, envoyer, payer) demandent toujours votre accord."
      >
        <Row label="Actions de l'agent sans confirmation" hint="Même réglage que l'autonomie dans le Chat, appliqué aux conversations vocales.">
          <Segmented
            label="Autonomie"
            value={settings.agent.autoMode}
            options={[
              { value: "off", label: "Aucune" },
              { value: "smart", label: "Sans risque" },
              { value: "full", label: "Toutes" },
            ]}
            onChange={(autoMode) => update("agent", { autoMode })}
          />
        </Row>
        <Row
          label="Dire les demandes de permission"
          hint="Désactivé : l'assistant ne lit plus la demande ; un son retentit et le panneau s'ouvre avec les boutons Oui / Non."
        >
          <Switch
            label="Dire les demandes de permission"
            checked={settings.general.speakPermissions}
            onChange={(speakPermissions) => update("general", { speakPermissions })}
          />
        </Row>
        <Row
          label="Répondre à une confirmation"
          hint="« Oui » accepte une fois, « oui toujours » accepte les demandes du même type jusqu'à la fin de la session, « non » refuse. Sans réponse en deux minutes : refusé."
        >
          <span />
        </Row>
        <Row label="Déclenchements involontaires" hint="Le micro ignore ce que dit l'assistant lui-même (écho) et, en mode mot d'éveil, toute phrase qui ne commence pas par le mot d'éveil.">
          <span />
        </Row>
      </Group>
    </>
  );
}

export function PerformanceSection() {
  const { settings, update } = useVoiceSettings();
  const p = settings.performance;
  return (
    <Group title="Moteurs locaux" description="Whisper et Piper tournent dans des processus séparés : ARCHIMED reste fluide pendant qu'ils travaillent.">
      <Row label="Priorité" hint="Basse : les autres logiciels passent d'abord (jeu, montage). Haute : réponses plus rapides sur une machine chargée.">
        <Segmented
          label="Priorité des moteurs"
          value={p.priority}
          options={[
            { value: "low", label: "Basse" },
            { value: "normal", label: "Normale" },
            { value: "high", label: "Haute" },
          ]}
          onChange={(priority) => update("performance", { priority })}
        />
      </Row>
      <Row label="Précharger au démarrage de l'écoute" hint="Le modèle Whisper est chargé dès l'ouverture du micro : la première phrase est transcrite sans attente.">
        <Switch label="Précharger" checked={p.preload} onChange={(preload) => update("performance", { preload })} />
      </Row>
      <Row label="Libérer la mémoire" hint="Arrête Whisper et Piper maintenant ; ils redémarrent à la prochaine phrase.">
        <Button size="sm" variant="ghost" onClick={() => void voiceApi.stopEngines()}>
          Arrêter les moteurs
        </Button>
      </Row>
    </Group>
  );
}
