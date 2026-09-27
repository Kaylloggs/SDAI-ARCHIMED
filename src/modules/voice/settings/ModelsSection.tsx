import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Check, Download, FolderOpen, Loader2, Pause, Play, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { engineApi } from "@/core/engine/engine.api";
import { cn } from "@/core/lib/cn";
import { Badge, Button } from "@/design-system/primitives";
import { Channel, voiceApi, type HardwareInfo, type LocalChatEvent, type LocalServerStatus, type VoiceModelEntry, type VoiceModelProgress } from "../api";
import { AudioPlayer } from "../audio/player";
import { useVoiceSettings } from "./useVoiceSettings";

const message = (e: unknown) => (e as { message?: string })?.message ?? String(e);
const gb = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(mb >= 10_240 ? 0 : 1)} Go` : `${mb} Mo`);

const FIT: Record<VoiceModelEntry["fit"], { label: string; tone: "success" | "neutral" | "warning" | "danger" }> = {
  recommended: { label: "Recommandé", tone: "success" },
  optional: { label: "Optionnel", tone: "neutral" },
  notRecommended: { label: "Déconseillé", tone: "warning" },
  unsupported: { label: "Indisponible ici", tone: "danger" },
};

const TIER: Record<HardwareInfo["tier"], string> = { low: "Machine modeste", mid: "Machine intermédiaire", high: "Machine puissante" };

const KINDS: Array<{ kind: VoiceModelEntry["kind"]; title: string; description: string }> = [
  { kind: "stt", title: "Reconnaissance (Whisper)", description: "Transcrit votre voix sans rien envoyer en ligne. Nécessite l'outil whisper.cpp, installé automatiquement." },
  { kind: "tts", title: "Voix (Piper)", description: "Voix neuronales rapides, hors ligne. Nécessite l'outil Piper, installé automatiquement." },
  { kind: "llm", title: "Intelligence locale (Ollama)", description: "Petit modèle de langage qui répond aux questions simples et confie le reste à un agent. Nécessite Ollama." },
  { kind: "runtime", title: "Outils locaux", description: "Programmes qui font tourner les modèles. Installés avec le premier modèle qui en a besoin." },
];

function Meter({ value, label }: { value: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${label} : ${value} sur 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={cn("h-1.5 w-2.5 rounded-full", i < value ? "bg-text-muted" : "bg-surface-3")} />
      ))}
    </span>
  );
}

/** Test réel d'un modèle installé : chargement (Whisper), phrase dite (Piper), réponse (Ollama). */
async function testModel(entry: VoiceModelEntry, language: string): Promise<string> {
  const started = performance.now();
  const seconds = () => `${((performance.now() - started) / 1000).toFixed(1)} s`;
  if (entry.kind === "stt") {
    await voiceApi.prepareStt(entry.id, language);
    return `Chargé en ${seconds()}.`;
  }
  if (entry.kind === "tts") {
    const bytes = await voiceApi.synthesize({ engine: "piper", text: "Bonjour, voici ma voix.", voice: entry.id, language });
    const player = new AudioPlayer();
    const buffer = await player.decode(bytes);
    const ready = seconds();
    await player.play(buffer, 1);
    return `Phrase prête en ${ready}.`;
  }
  if (entry.kind === "llm") {
    let answer = "";
    const channel = new Channel<LocalChatEvent>();
    channel.onmessage = (event) => {
      if (event.type === "delta") answer += event.text;
    };
    await voiceApi.localChat(crypto.randomUUID(), entry.version, [{ role: "user", content: "Réponds en une phrase courte : bonjour !" }], channel);
    return `« ${answer.trim().slice(0, 80)} » en ${seconds()}.`;
  }
  return "Outil présent.";
}

function ModelRow({
  entry,
  progress,
  active,
  ollama,
  onChanged,
  onActivate,
  language,
}: {
  entry: VoiceModelEntry;
  progress: VoiceModelProgress | undefined;
  active: boolean;
  ollama: LocalServerStatus | null;
  onChanged: () => void;
  onActivate: (entry: VoiceModelEntry) => void;
  language: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ text: string; error: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const status = progress?.status ?? entry.status;
  const received = progress?.received ?? entry.received;
  const total = progress?.total ?? entry.total;
  const error = progress?.error ?? entry.error;
  const installed = status === "installed" || status === "updateAvailable";
  const running = status === "downloading" || status === "verifying" || status === "installing";
  const needsOllama = entry.kind === "llm" && !ollama?.running;
  const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null;

  const run = async (name: string, action: () => Promise<unknown>) => {
    setBusy(name);
    setResult(null);
    try {
      const outcome = await action();
      if (typeof outcome === "string") setResult({ text: outcome, error: false });
    } catch (e) {
      setResult({ text: message(e), error: true });
    } finally {
      setBusy(null);
      onChanged();
    }
  };

  return (
    <li className="space-y-2 py-3.5">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-80 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-body-sm font-medium text-text">{entry.name}</p>
            <Badge tone={FIT[entry.fit].tone}>{FIT[entry.fit].label}</Badge>
            {active && (
              <Badge tone="accent">
                <Check size={11} strokeWidth={2} /> Utilisé
              </Badge>
            )}
            {status === "updateAvailable" && <Badge tone="info">Mise à jour</Badge>}
          </div>
          <p className="max-w-[64ch] text-footnote text-text-muted">{entry.description}</p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-text-subtle">
            <span>{gb(entry.sizeMb)}</span>
            <span>RAM {gb(entry.ramMb)}</span>
            {entry.vramMb !== null && <span>VRAM {gb(entry.vramMb)}</span>}
            {entry.kind !== "runtime" && (
              <>
                <span className="inline-flex items-center gap-1">
                  Vitesse <Meter value={entry.speed} label="Vitesse" />
                </span>
                <span className="inline-flex items-center gap-1">
                  Qualité <Meter value={entry.quality} label="Qualité" />
                </span>
              </>
            )}
            {entry.languages.length > 0 && <span>{entry.languages.slice(0, 4).join(", ")}{entry.languages.length > 4 ? "…" : ""}</span>}
            <span>{entry.license}</span>
          </p>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {running ? (
            <Button size="sm" variant="ghost" onClick={() => void run("pause", () => voiceApi.pause(entry.id))} icon={<Pause size={13} strokeWidth={1.75} />}>
              Pause
            </Button>
          ) : installed ? (
            <>
              {status === "updateAvailable" && (
                <Button size="sm" variant="secondary" onClick={() => void run("download", () => voiceApi.download(entry.id))} icon={<RefreshCw size={13} strokeWidth={1.75} />}>
                  Mettre à jour
                </Button>
              )}
              {entry.kind !== "runtime" && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => void run("test", () => testModel(entry, language))}
                  icon={busy === "test" ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} strokeWidth={1.75} />}
                >
                  Tester
                </Button>
              )}
              {entry.kind !== "llm" && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => void run("verify", async () => (await voiceApi.verify(entry.id), "Fichiers intacts (empreintes SHA-256 vérifiées)."))}
                  aria-label={`Vérifier l'intégrité de ${entry.name}`}
                  className="px-1.5"
                >
                  {busy === "verify" ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} strokeWidth={1.75} />}
                </Button>
              )}
              {entry.path && (
                <Button size="sm" variant="ghost" onClick={() => void engineApi.openPath(entry.path!)} aria-label={`Ouvrir le dossier de ${entry.name}`} className="px-1.5">
                  <FolderOpen size={13} strokeWidth={1.75} />
                </Button>
              )}
              {confirmDelete ? (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                    Annuler
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => void run("delete", async () => (setConfirmDelete(false), await voiceApi.remove(entry.id)))}>
                    Supprimer
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)} aria-label={`Supprimer ${entry.name}`} className="px-1.5">
                  <Trash2 size={13} strokeWidth={1.75} />
                </Button>
              )}
              {entry.kind !== "runtime" && !active && (
                <Button size="sm" variant="secondary" onClick={() => onActivate(entry)}>
                  Utiliser
                </Button>
              )}
            </>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              disabled={entry.fit === "unsupported" || needsOllama || busy !== null}
              onClick={() => void run("download", () => voiceApi.download(entry.id))}
              icon={<Download size={13} strokeWidth={1.75} />}
              title={needsOllama ? "Lancez Ollama (ollama.com) pour installer ce modèle" : undefined}
            >
              {status === "paused" ? "Reprendre" : status === "failed" ? "Réessayer" : "Télécharger"}
            </Button>
          )}
        </div>
      </div>

      {(running || status === "paused") && (
        <div className="space-y-1">
          <div
            className="h-1 overflow-hidden rounded-full bg-surface-3"
            role="progressbar"
            aria-label={`Téléchargement de ${entry.name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent ?? undefined}
          >
            <div className="h-full origin-left rounded-full bg-accent transition-transform duration-[220ms]" style={{ transform: `scaleX(${(percent ?? 0) / 100})` }} />
          </div>
          <p className="text-caption text-text-subtle">
            {progress?.step ?? (status === "paused" ? "En pause" : status === "verifying" ? "Vérification des empreintes" : "Téléchargement")}
            {total > 0 && ` · ${gb(Math.round(received / 1_048_576))} sur ${gb(Math.round(total / 1_048_576))}`}
            {percent !== null && ` · ${percent} %`}
          </p>
        </div>
      )}
      {status === "failed" && error && <p role="alert" className="text-footnote text-danger">{error}</p>}
      {needsOllama && !installed && <p className="text-footnote text-text-subtle">Ollama n'est pas lancé sur cette machine (ollama.com).</p>}
      {result && (
        <p role={result.error ? "alert" : "status"} className={cn("text-footnote", result.error ? "text-danger" : "text-success")}>
          {result.text}
        </p>
      )}
    </li>
  );
}

export function ModelsSection() {
  const { settings, update } = useVoiceSettings();
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [models, setModels] = useState<VoiceModelEntry[] | null>(null);
  const [ollama, setOllama] = useState<LocalServerStatus | null>(null);
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
    void voiceApi.ollama().then(setOllama).catch(() => setOllama(null));
  }, []);

  useEffect(() => {
    void voiceApi.hardware().then(setHardware).catch(() => undefined);
    refresh();
    const stop = listen<VoiceModelProgress>("voice:model", (event) => {
      const next = event.payload;
      setProgress((current) => ({ ...current, [next.id]: next }));
      if (next.status === "installed" || next.status === "failed" || next.status === "paused") refresh();
    });
    return () => void stop.then((fn) => fn());
  }, [refresh]);

  const activeIds = useMemo(
    () => new Set([settings.stt.engine === "whisper" ? settings.stt.model : "", settings.tts.engine === "piper" ? (settings.tts.voice ?? "") : ""]),
    [settings.stt, settings.tts],
  );

  const activate = (entry: VoiceModelEntry) => {
    if (entry.kind === "stt") update("stt", { engine: "whisper", model: entry.id });
    if (entry.kind === "tts") update("tts", { engine: "piper", voice: entry.id, speaker: null });
    if (entry.kind === "llm") update("agent", { localModel: entry.version });
  };

  return (
    <>
      <section className="mb-8 rounded-md border border-border bg-surface-1 p-4" aria-label="Cet ordinateur">
        {hardware ? (
          <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
            <div className="min-w-0 space-y-0.5">
              <p className="text-body-sm font-semibold">{TIER[hardware.tier]}</p>
              <ul className="text-footnote text-text-muted">
                {hardware.reasons.map((reason) => (
                  <li key={reason} className="first-letter:uppercase">
                    {reason}
                  </li>
                ))}
              </ul>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-footnote">
              <dt className="text-text-subtle">Processeur</dt>
              <dd className="truncate text-text-muted">
                {hardware.cpu} · {hardware.cores} cœurs
              </dd>
              <dt className="text-text-subtle">Mémoire</dt>
              <dd className="text-text-muted">{gb(hardware.ramMb)}</dd>
              <dt className="text-text-subtle">Carte graphique</dt>
              <dd className="text-text-muted">
                {hardware.gpus.length === 0
                  ? "Non détectée"
                  : hardware.gpus.map((g) => `${g.name}${g.vramMb ? ` (${gb(g.vramMb)})` : ""}`).join(", ")}
              </dd>
              <dt className="text-text-subtle">Système</dt>
              <dd className="text-text-muted">
                {hardware.os} · {hardware.arch}
              </dd>
            </dl>
          </div>
        ) : (
          <p className="text-footnote text-text-subtle">Analyse de la machine…</p>
        )}
      </section>

      {error && (
        <p role="alert" className="mb-4 rounded-sm bg-danger-soft px-3 py-2 text-footnote text-text">
          {error}
        </p>
      )}

      {models === null ? (
        <div className="flex justify-center py-10 text-text-subtle">
          <Loader2 size={16} className="animate-spin" aria-label="Chargement des modèles" />
        </div>
      ) : (
        KINDS.map(({ kind, title, description }) => {
          const list = models.filter((m) => m.kind === kind);
          if (list.length === 0) return null;
          return (
            <section key={kind} className="pb-8" aria-label={title}>
              <div className="flex items-end justify-between gap-3 pb-2">
                <div>
                  <h2 className="text-title-3 font-semibold">{title}</h2>
                  <p className="max-w-[70ch] pt-0.5 text-footnote text-text-subtle">{description}</p>
                </div>
                {kind === "llm" && (
                  <Badge tone={ollama?.running ? "success" : "neutral"}>{ollama?.running ? `Ollama ${ollama.version ?? ""}`.trim() : "Ollama absent"}</Badge>
                )}
              </div>
              <ul className="divide-y divide-border rounded-md border border-border bg-surface-1 px-4">
                {list.map((entry) => (
                  <ModelRow
                    key={entry.id}
                    entry={entry}
                    progress={progress[entry.id]}
                    active={activeIds.has(entry.id) || (kind === "llm" && settings.agent.localModel === entry.version)}
                    ollama={ollama}
                    onChanged={refresh}
                    onActivate={activate}
                    language={settings.general.language}
                  />
                ))}
              </ul>
            </section>
          );
        })
      )}
      <p className="text-footnote text-text-subtle">
        Les modèles sont rangés dans le dossier de données d'ARCHIMED (models/stt, models/tts, models/runtime) ; ceux d'Ollama restent gérés par
        Ollama. Chaque fichier est vérifié par son empreinte SHA-256 publiée à la source.
      </p>
    </>
  );
}
