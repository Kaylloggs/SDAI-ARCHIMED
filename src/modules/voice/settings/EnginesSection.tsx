import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Play, RefreshCw } from "lucide-react";
import { Badge, Button, Select } from "@/design-system/primitives";
import { voiceApi, type VoiceModelEntry, type VoiceOption, type VoiceProviderStatus } from "../api";
import { Group, LocationTag, Row, Slider, TextInput } from "../components/controls";
import { isWindows } from "../engines/stt";
import { systemVoices } from "../engines/tts";
import { sttLocation, ttsLocation } from "../lib/privacy";
import { STT_ENGINES, TTS_ENGINES, type SttEngineId, type TtsEngineId, type VoiceSettings } from "../lib/settings";
import { orchestrator } from "../runtime/instance";
import { message as errorText, ModelInstallButton, recommended, useModelCatalog } from "./install";
import { ToolRows } from "./InstallParts";
import type { SectionId } from "./sections";
import { useVoiceSettings } from "./useVoiceSettings";

const message = (e: unknown) => (e as { message?: string })?.message ?? String(e);

/** Fournisseur dont la clé sert à ce moteur (null : aucune clé). */
const KEYED: Partial<Record<SttEngineId | TtsEngineId, string>> = { openai: "openai", groq: "groq", elevenlabs: "elevenlabs" };

function useProviders() {
  const [providers, setProviders] = useState<VoiceProviderStatus[]>([]);
  useEffect(() => {
    void voiceApi.providers().then(setProviders).catch(() => undefined);
  }, []);
  return providers;
}

function useInstalled(kind: "stt" | "tts") {
  const [models, setModels] = useState<VoiceModelEntry[] | null>(null);
  useEffect(() => {
    void voiceApi
      .models()
      .then((list) => setModels(list.filter((m) => m.kind === kind && m.status === "installed")))
      .catch(() => setModels([]));
  }, [kind]);
  return models;
}

function KeyNotice({ engine, providers, go }: { engine: string; providers: VoiceProviderStatus[]; go: (id: SectionId) => void }) {
  const provider = KEYED[engine as SttEngineId];
  const status = providers.find((p) => p.id === provider);
  if (!provider || !status || status.hasKey) return null;
  return (
    <p className="flex items-center gap-2 py-2.5 text-footnote text-warning">
      Clé {status.name} absente.
      <Button size="sm" variant="ghost" onClick={() => go("installs")}>
        Ajouter la clé
      </Button>
    </p>
  );
}

function engineOptions<T extends string>(engines: Record<T, { label: string }>, location: (id: T) => "local" | "cloud", disabled?: (id: T) => string | null) {
  return (Object.keys(engines) as T[]).map((id) => {
    const why = disabled?.(id) ?? null;
    return {
      value: id,
      label: engines[id].label,
      hint: why ?? (location(id) === "local" ? "Sur l'ordinateur" : "En ligne"),
      disabled: Boolean(why),
    };
  });
}

export function SttSection({ go }: { go: (id: SectionId) => void }) {
  const { settings, update } = useVoiceSettings();
  const providers = useProviders();
  const installed = useInstalled("stt");
  const [prepare, setPrepare] = useState<{ busy: boolean; result: string | null; error: boolean }>({ busy: false, result: null, error: false });
  const stt = settings.stt;
  const location = (engine: SttEngineId): "local" | "cloud" => sttLocation({ ...settings, stt: { ...stt, engine } } as VoiceSettings);
  const windowsOnly = (id: SttEngineId) => (id === "windows" && !isWindows() ? "Windows uniquement" : null);

  const test = async () => {
    setPrepare({ busy: true, result: null, error: false });
    const started = performance.now();
    try {
      await voiceApi.prepareStt(stt.model, settings.general.language, settings.performance.priority);
      setPrepare({ busy: false, result: `Modèle chargé en ${((performance.now() - started) / 1000).toFixed(1)} s.`, error: false });
    } catch (e) {
      setPrepare({ busy: false, result: message(e), error: true });
    }
  };

  return (
    <>
      <Group title="Reconnaissance vocale" description="Ce qui transforme votre voix en texte. Une reconnaissance locale garde le son sur l'ordinateur.">
        <Row label="Moteur" hint={STT_ENGINES[stt.engine].hint}>
          <div className="flex items-center gap-2">
            <LocationTag location={location(stt.engine)} compact />
            <Select
              label="Moteur de reconnaissance"
              value={stt.engine}
              options={engineOptions(STT_ENGINES, location, windowsOnly)}
              onChange={(engine) => update("stt", { engine: engine as SttEngineId })}
              className="w-56"
            />
          </div>
        </Row>

        {stt.engine === "whisper" &&
          (installed === null ? (
            <p className="py-3 text-footnote text-text-subtle">Recherche des modèles installés…</p>
          ) : installed.length === 0 ? (
            <SuggestModel kind="stt" empty="Aucun modèle Whisper installé sur cette machine." go={go} />
          ) : (
            <>
              <Row label="Modèle Whisper" hint="Les modèles plus gros sont plus précis et plus lents.">
                <Select
                  label="Modèle Whisper"
                  value={installed.some((m) => m.id === stt.model) ? stt.model : ""}
                  placeholder="Choisir un modèle installé"
                  options={installed.map((m) => ({ value: m.id, label: m.name, hint: `${m.sizeMb} Mo` }))}
                  onChange={(model) => update("stt", { model })}
                  className="w-56"
                />
              </Row>
              <div className="flex items-center gap-3 py-3">
                <Button size="sm" variant="ghost" onClick={() => void test()} disabled={prepare.busy} icon={prepare.busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} strokeWidth={1.75} />}>
                  Charger le modèle
                </Button>
                {prepare.result && (
                  <p role={prepare.error ? "alert" : "status"} className={prepare.error ? "text-footnote text-danger" : "text-footnote text-success"}>
                    {prepare.result}
                  </p>
                )}
              </div>
            </>
          ))}

        {(stt.engine === "openai" || stt.engine === "groq" || stt.engine === "elevenlabs" || stt.engine === "custom") && (
          <Row label="Modèle du service" hint="Laisser vide pour le modèle conseillé.">
            <TextInput
              label="Modèle du service"
              value={stt.cloudModel}
              placeholder={stt.engine === "openai" ? "gpt-4o-mini-transcribe" : stt.engine === "groq" ? "whisper-large-v3-turbo" : stt.engine === "elevenlabs" ? "scribe_v1" : "whisper-1"}
              onChange={(cloudModel) => update("stt", { cloudModel })}
            />
          </Row>
        )}
        {(stt.engine === "voicebox" || stt.engine === "custom") && (
          <Row label="Adresse du serveur" hint={stt.engine === "voicebox" ? "Voicebox écoute par défaut sur http://127.0.0.1:17493." : "Adresse de l'API compatible OpenAI (…/v1)."}>
            <TextInput label="Adresse du serveur" type="url" value={stt.baseUrl} onChange={(baseUrl) => update("stt", { baseUrl })} />
          </Row>
        )}
        <KeyNotice engine={stt.engine} providers={providers} go={go} />
        {stt.engine === "windows" && <SystemSpeech text="La langue de reconnaissance doit être installée dans Windows (Paramètres › Heure et langue › Voix)." />}
        {stt.engine === "voicebox" && <ToolRows only="voicebox" />}

        <Row
          label="Moteur de secours"
          hint={settings.privacy.allowCloudFallback ? "Utilisé si le moteur principal échoue." : "Utilisé si le moteur principal échoue. Un secours en ligne demande l'autorisation dans Confidentialité."}
        >
          <Select
            label="Moteur de secours"
            value={stt.fallback ?? ""}
            options={[{ value: "", label: "Aucun" }, ...engineOptions(STT_ENGINES, location, (id) => (id === "windows" ? "Pas de secours possible" : id === stt.engine ? "Moteur principal" : null))]}
            onChange={(fallback) => update("stt", { fallback: (fallback || null) as SttEngineId | null })}
            className="w-56"
          />
        </Row>
      </Group>
    </>
  );
}

function useVoices(settings: VoiceSettings) {
  const { engine, baseUrl } = settings.tts;
  const language = settings.general.language;
  const [state, setState] = useState<{ voices: VoiceOption[]; loading: boolean; error: string | null }>({ voices: [], loading: true, error: null });

  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    const request =
      engine === "system"
        ? systemVoices().then((list) => {
            const prefix = language.split("-")[0]!.toLowerCase();
            return list
              .filter((v) => v.lang.toLowerCase().startsWith(prefix))
              .map((v) => ({ id: v.voiceURI, name: v.name, language: v.lang, custom: false }));
          })
        : voiceApi.voices(engine, engine === "custom" ? baseUrl : null);
    void request
      .then((voices) => setState({ voices, loading: false, error: null }))
      .catch((e) => setState({ voices: [], loading: false, error: message(e) }));
  }, [engine, baseUrl, language]);

  useEffect(load, [load]);
  return { ...state, reload: load };
}

export function TtsSection({ go }: { go: (id: SectionId) => void }) {
  const { settings, update } = useVoiceSettings();
  const providers = useProviders();
  const { voices, loading, error, reload } = useVoices(settings);
  const [sample, setSample] = useState("Bonjour, je suis ARCHIMED. Que puis-je faire pour vous ?");
  const tts = settings.tts;
  const engine = TTS_ENGINES[tts.engine];
  const location = (id: TtsEngineId): "local" | "cloud" => ttsLocation({ ...settings, tts: { ...tts, engine: id } } as VoiceSettings);
  const custom = voices.filter((v) => v.custom);

  const listen = () => {
    const voice = orchestrator();
    voice.resetVoice();
    voice.say(sample, "high", "reply", "voice");
  };

  return (
    <>
      <Group title="Voix de l'assistant" description="Ce qui lit les réponses à voix haute. La réponse s'entend dès la première phrase prête.">
        <Row label="Moteur" hint={engine.hint}>
          <div className="flex items-center gap-2">
            <LocationTag location={location(tts.engine)} compact />
            <Select
              label="Moteur de voix"
              value={tts.engine}
              options={engineOptions(TTS_ENGINES, location)}
              onChange={(value) => update("tts", { engine: value as TtsEngineId, voice: null, speaker: null })}
              className="w-56"
            />
          </div>
        </Row>
        <Row
          label="Voix"
          hint={
            error
              ? error
              : !loading && voices.length === 0
                ? tts.engine === "piper"
                  ? "Aucune voix Piper installée."
                  : tts.engine === "system"
                    ? "Aucune voix système pour cette langue : ajoutez-en une (bouton ci-dessous)."
                    : "Ce moteur ne propose pas de liste de voix : indiquez son nom ci-dessous."
                : undefined
          }
        >
          <div className="flex items-center gap-1">
            {tts.engine === "piper" && !loading && voices.length === 0 ? (
              <SuggestModel kind="tts" compact go={go} onDone={reload} />
            ) : tts.engine === "custom" ? (
              <TextInput label="Nom de la voix" value={tts.voice ?? ""} placeholder="ff_siwis" onChange={(voice) => update("tts", { voice: voice || null })} />
            ) : (
              <Select
                label="Voix"
                value={tts.voice ?? ""}
                placeholder={loading ? "Chargement…" : "Voix par défaut"}
                options={[{ value: "", label: "Voix par défaut" }, ...voices.map((v) => ({ value: v.id, label: v.name, hint: v.custom ? "Voix personnelle" : (v.language ?? undefined) }))]}
                onChange={(voice) => update("tts", { voice: voice || null })}
                disabled={loading}
                className="w-56"
              />
            )}
            <Button size="sm" variant="ghost" onClick={reload} aria-label="Recharger la liste des voix" className="px-1.5">
              <RefreshCw size={13} strokeWidth={1.75} className={loading ? "animate-spin motion-reduce:animate-none" : undefined} />
            </Button>
          </div>
        </Row>
        <KeyNotice engine={tts.engine} providers={providers} go={go} />
        {tts.engine === "system" && <SystemSpeech text="Ajoutez des voix (dont les voix naturelles) dans les réglages de voix du système." />}
        {tts.engine === "voicebox" && <ToolRows only="voicebox" />}

        <Row label="Vitesse">
          <Slider label="Vitesse" value={tts.speed} min={0.6} max={2} step={0.05} onChange={(speed) => update("tts", { speed })} format={(v) => `×${v.toFixed(2)}`} />
        </Row>
        {engine.pitch && (
          <Row label="Hauteur">
            <Slider label="Hauteur" value={tts.pitch} min={0.5} max={1.5} step={0.05} onChange={(pitch) => update("tts", { pitch })} format={(v) => `×${v.toFixed(2)}`} />
          </Row>
        )}
        {engine.emotion && tts.engine !== "elevenlabs" && (
          <Row label="Ton et émotion" hint="Consigne libre : « calme et chaleureux », « enjoué », « posé, voix basse ».">
            <TextInput label="Ton et émotion" value={tts.emotion} placeholder="calme et chaleureux" onChange={(emotion) => update("tts", { emotion })} />
          </Row>
        )}
        {tts.engine === "elevenlabs" && (
          <>
            <Row label="Stabilité" hint="Bas : plus expressive et variable. Haut : plus régulière.">
              <Slider label="Stabilité" value={tts.stability} min={0} max={1} step={0.05} onChange={(stability) => update("tts", { stability })} />
            </Row>
            <Row label="Style" hint="Accentue le style de la voix d'origine (plus lent à générer).">
              <Slider label="Style" value={tts.style} min={0} max={1} step={0.05} onChange={(style) => update("tts", { style })} />
            </Row>
          </>
        )}
        {(tts.engine === "openai" || tts.engine === "elevenlabs" || tts.engine === "custom") && (
          <Row label="Modèle du service" hint="Laisser vide pour le modèle conseillé.">
            <TextInput
              label="Modèle de voix"
              value={tts.model}
              placeholder={tts.engine === "openai" ? "gpt-4o-mini-tts" : tts.engine === "elevenlabs" ? "eleven_flash_v2_5" : "kokoro"}
              onChange={(model) => update("tts", { model })}
            />
          </Row>
        )}
        {tts.engine === "custom" && (
          <Row label="Adresse du serveur" hint="API compatible OpenAI (…/v1) : Kokoro-FastAPI, LocalAI, openedai-speech…">
            <TextInput label="Adresse du serveur de voix" type="url" value={tts.baseUrl} onChange={(baseUrl) => update("tts", { baseUrl })} />
          </Row>
        )}
        <Row label="Voix de secours" hint="Si la voix principale ne répond pas, la réponse est dite quand même.">
          <Select
            label="Voix de secours"
            value={tts.fallback ?? ""}
            options={[{ value: "", label: "Aucune" }, ...engineOptions(TTS_ENGINES, location, (id) => (id === tts.engine ? "Moteur principal" : null))]}
            onChange={(fallback) => update("tts", { fallback: (fallback || null) as TtsEngineId | null })}
            className="w-56"
          />
        </Row>
        <div className="flex items-center gap-2 py-3">
          <TextInput label="Phrase d'essai" value={sample} onChange={setSample} onEnter={listen} className="flex-1" />
          <Button size="sm" variant="secondary" onClick={listen} icon={<Play size={13} strokeWidth={1.75} />}>
            Écouter
          </Button>
        </div>
      </Group>

      {(tts.engine === "voicebox" || tts.engine === "elevenlabs") && (
        <Group
          title="Voix personnelles"
          description="Une voix clonée se crée dans Voicebox (sur votre machine) ou dans votre compte ElevenLabs, jamais par ARCHIMED. Ne clonez que votre propre voix, ou celle d'une personne qui vous a donné son accord explicite."
        >
          {custom.length > 0 ? (
            <ul className="divide-y divide-border">
              {custom.map((v) => (
                <li key={v.id} className="flex items-center gap-2 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-body-sm">{v.name}</span>
                  {tts.voice === v.id ? (
                    <Badge tone="success">
                      <Check size={11} strokeWidth={2} /> Utilisée
                    </Badge>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => update("tts", { voice: v.id })}>
                      Utiliser
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-3 text-footnote text-text-subtle">
              {tts.engine === "voicebox" || tts.engine === "elevenlabs"
                ? "Aucune voix personnelle dans ce moteur pour l'instant."
                : "Choisissez Voicebox ou ElevenLabs comme moteur pour utiliser vos voix personnelles."}
            </p>
          )}
        </Group>
      )}
    </>
  );
}

/** Modèle conseillé pour cette machine, installé et mis en service d'un clic. */
function SuggestModel({
  kind,
  empty,
  compact,
  go,
  onDone,
}: {
  kind: "stt" | "tts";
  empty?: string;
  compact?: boolean;
  go: (id: SectionId) => void;
  onDone?: () => void;
}) {
  const { settings } = useVoiceSettings();
  const { models, progress } = useModelCatalog();
  const [error, setError] = useState<string | null>(null);
  const pick = models ? recommended(models, kind, settings.general.language) : null;
  const status = pick ? (progress[pick.id]?.status ?? pick.status) : null;
  useEffect(() => {
    if (status === "installed") onDone?.();
  }, [status, onDone]);
  if (!pick) {
    return (
      <Button size="sm" variant="secondary" onClick={() => go("installs")}>
        Voir les modèles
      </Button>
    );
  }
  const button = <ModelInstallButton entry={pick} progress={progress[pick.id]} onError={setError} compact={compact} />;
  if (compact) return button;
  return (
    <div className="space-y-1 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-footnote text-warning">
          {empty} Conseillé ici : {pick.name}.
        </p>
        {button}
      </div>
      {error && (
        <p role="alert" className="text-footnote text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Accès direct aux réglages de voix du système (langues, voix naturelles). */
function SystemSpeech({ text }: { text: string }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3 py-3">
      <p className="min-w-0 flex-1 text-footnote text-text-subtle">{error ?? text}</p>
      <Button size="sm" variant="ghost" onClick={() => void voiceApi.openSystemSpeech().catch((e) => setError(errorText(e)))}>
        Ouvrir les réglages de voix
      </Button>
    </div>
  );
}
