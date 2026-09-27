import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Copy, ExternalLink, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useAdapters } from "@/core/engine/useAdapters";
import type { AutoMode } from "@/core/engine/types";
import { Badge, Button, Select } from "@/design-system/primitives";
import { voiceApi, type LocalServerStatus, type McpInfo, type VoiceProviderStatus } from "../api";
import { AgentRows, ToolRows } from "./InstallParts";
import { Group, LocationTag, Row, Segmented, Switch, TextInput } from "../components/controls";
import type { SectionId } from "./sections";
import { useVoiceSettings } from "./useVoiceSettings";

const message = (e: unknown) => (e as { message?: string })?.message ?? String(e);

const PROVIDER_HINTS: Record<string, string> = {
  openai: "Reconnaissance gpt-4o-transcribe et voix gpt-4o-mini-tts. platform.openai.com › API keys.",
  groq: "Whisper Large v3 Turbo, très rapide. console.groq.com › API Keys.",
  elevenlabs: "Voix expressives et vos voix personnelles, reconnaissance Scribe. elevenlabs.io › Profil › API Keys.",
  custom: "Clé facultative du serveur compatible OpenAI indiqué dans Reconnaissance ou Voix.",
};

/** Pages où créer une clé chez chaque fournisseur. */
const KEY_PAGES: Record<string, string> = {
  openai: "https://platform.openai.com/api-keys",
  groq: "https://console.groq.com/keys",
  elevenlabs: "https://elevenlabs.io/app/settings/api-keys",
};

export function ProviderRow({ provider, onChanged }: { provider: VoiceProviderStatus; onChanged: () => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!value.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await voiceApi.setKey(provider.id, value.trim());
      setValue("");
      onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5 py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-body-sm text-text">
            {provider.name}
            {provider.hasKey && (
              <Badge tone="success">
                <Check size={11} strokeWidth={2} /> {provider.masked ?? "Clé enregistrée"}
              </Badge>
            )}
          </p>
          <p className="text-footnote text-text-subtle">{PROVIDER_HINTS[provider.id]}</p>
        </div>
        {provider.hasKey ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void voiceApi.clearKey(provider.id).then(onChanged)}
            icon={<Trash2 size={13} strokeWidth={1.75} />}
          >
            Retirer
          </Button>
        ) : (
          <>
            {KEY_PAGES[provider.id] && (
              <Button size="sm" variant="ghost" onClick={() => void openUrl(KEY_PAGES[provider.id]!)} icon={<ExternalLink size={13} strokeWidth={1.75} />}>
                Obtenir une clé
              </Button>
            )}
            <TextInput label={`Clé ${provider.name}`} type="password" value={value} placeholder="Coller la clé" onChange={setValue} onEnter={() => void save()} className="w-56" />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void save()}
              disabled={busy || !value.trim()}
              icon={busy ? <Loader2 size={13} className="animate-spin" /> : undefined}
            >
              {busy ? "Vérification" : "Enregistrer"}
            </Button>
          </>
        )}
      </div>
      {error && <p role="alert" className="text-footnote text-danger">{error}</p>}
    </div>
  );
}

const AUTO_MODES: Array<{ value: AutoMode; label: string; title: string }> = [
  { value: "off", label: "Tout demander", title: "Chaque action de l'agent attend votre accord" },
  { value: "smart", label: "Sans risque seul", title: "Lectures et actions sans risque passent seules ; le reste est demandé" },
  { value: "full", label: "Tout accepter", title: "L'agent agit sans demander (déconseillé à la voix)" },
];

export function AgentsSection({ go }: { go: (id: SectionId) => void }) {
  const { settings, update } = useVoiceSettings();
  const { adapters, loading, refresh } = useAdapters();
  const [ollama, setOllama] = useState<LocalServerStatus | null>(null);
  const agent = settings.agent;
  const installed = adapters.filter((a) => a.installed);
  const current = adapters.find((a) => a.id === agent.adapter);

  useEffect(() => {
    void voiceApi.ollama().then(setOllama).catch(() => setOllama(null));
  }, []);

  return (
    <>
      <Group title="Qui répond" description="Un agent (CLI d'IA installée) sait agir : fichiers, commandes, modules. Le modèle local répond vite et hors ligne, et confie à l'agent ce qu'il ne sait pas faire.">
        <Row label="Intelligence" hint={agent.brain === "local" ? "Les questions simples restent sur l'ordinateur ; les actions partent vers l'agent." : "Chaque demande part vers l'agent choisi."}>
          <div className="flex items-center gap-2">
            <LocationTag location={agent.brain === "local" ? "local" : "cloud"} compact />
            <Segmented
              label="Intelligence"
              value={agent.brain}
              options={[
                { value: "cli", label: "Agent" },
                { value: "local", label: "Modèle local" },
              ]}
              onChange={(brain) => update("agent", { brain })}
            />
          </div>
        </Row>
        <Row label="Agent" hint={current && !current.installed ? (current.hint ?? "Non installé sur cette machine.") : "Détecté automatiquement parmi les CLI installées."}>
          <div className="flex items-center gap-1">
            <Select
              label="Agent"
              value={agent.adapter}
              placeholder={loading ? "Détection…" : "Choisir un agent"}
              options={adapters.map((a) => ({
                value: a.id,
                label: a.name,
                hint: a.installed ? (a.version ?? "Installé") : "Non installé",
                disabled: !a.installed,
              }))}
              onChange={(adapter) => update("agent", { adapter, model: null })}
              className="w-56"
            />
            <Button size="sm" variant="ghost" onClick={() => void refresh(true)} aria-label="Détecter à nouveau les CLI" className="px-1.5">
              <RefreshCw size={13} strokeWidth={1.75} className={loading ? "animate-spin motion-reduce:animate-none" : undefined} />
            </Button>
          </div>
        </Row>
        {current && current.models.length > 0 && (
          <Row label="Modèle de l'agent">
            <Select
              label="Modèle de l'agent"
              value={agent.model ?? ""}
              options={[{ value: "", label: "Modèle par défaut" }, ...current.models.map((m) => ({ value: m.id, label: m.label }))]}
              onChange={(model) => update("agent", { model: model || null })}
              className="w-56"
            />
          </Row>
        )}
        {ollama?.running && ollama.models.length > 0 ? (
          <Row label="Modèle local" hint="Modèle Ollama utilisé en mode « Modèle local ».">
            <Select
              label="Modèle local"
              value={agent.localModel}
              options={ollama.models.map((m) => ({ value: m, label: m }))}
              onChange={(localModel) => update("agent", { localModel })}
              className="w-56"
            />
          </Row>
        ) : (
          // Modèle local : Ollama à installer ou à lancer, puis le modèle conseillé, d'un clic.
          <ToolRows only="ollama" />
        )}
      </Group>

      <Group
        title="Agents sur cet ordinateur"
        description={
          installed.length === 0 && !loading
            ? "Aucun agent installé : installez-en un ici. La voix ne simule jamais un agent absent."
            : "Installer un autre agent, ou se reconnecter à l'un d'eux."
        }
        actions={
          <Button size="sm" variant="ghost" onClick={() => go("installs")}>
            Toutes les installations
          </Button>
        }
      >
        <AgentRows />
      </Group>

      <Group title="Actions de l'agent" description="Même règle qu'au clavier : la voix ne donne jamais plus de droits qu'un message écrit.">
        <Row label="Autonomie" hint={AUTO_MODES.find((m) => m.value === agent.autoMode)?.title}>
          <Segmented label="Autonomie de l'agent" value={agent.autoMode} options={AUTO_MODES} onChange={(autoMode) => update("agent", { autoMode })} />
        </Row>
      </Group>
    </>
  );
}

export function McpSection() {
  const { settings, update } = useVoiceSettings();
  const [info, setInfo] = useState<McpInfo | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(() => void voiceApi.mcpInfo().then(setInfo).catch(() => setInfo(null)), []);
  useEffect(refresh, [refresh]);

  const copy = async () => {
    if (!info?.config) return;
    await navigator.clipboard.writeText(info.config);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <>
      <Group
        title="Serveur MCP d'ARCHIMED"
        description="Les agents lancés par ARCHIMED reçoivent ces outils automatiquement : parler, notifier, lire le contexte, ouvrir un module, lancer une action, confier une tâche. Il n'écoute que sur cet ordinateur (127.0.0.1) et exige un jeton."
        actions={
          <Button size="sm" variant="ghost" onClick={refresh} icon={<RefreshCw size={13} strokeWidth={1.75} />}>
            Actualiser
          </Button>
        }
      >
        <Row label="État" hint={info?.url ?? undefined}>
          {info?.running ? <Badge tone="success">Actif · {info.calls} appel(s)</Badge> : <Badge tone="danger">Arrêté</Badge>}
        </Row>
        <Row label="Donner les outils aux agents" hint="Désactivé : les agents lancés par ARCHIMED ne voient plus ces outils (effet à la prochaine conversation).">
          <Switch label="Donner les outils aux agents" checked={settings.mcp.shareTools} onChange={(shareTools) => update("mcp", { shareTools })} />
        </Row>
        {info && info.tools.length > 0 && (
          <div className="py-3">
            <p className="pb-1.5 text-footnote text-text-muted">Outils</p>
            <ul className="flex flex-wrap gap-1">
              {info.tools.map((tool) => (
                <li key={tool} className="rounded-xs bg-surface-2 px-1.5 py-0.5 font-mono text-caption text-text-muted">
                  {tool}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Group>
      {info?.config && (
        <Group
          title="Utiliser depuis un autre agent"
          description="Collez ce bloc dans la configuration MCP d'un agent lancé hors d'ARCHIMED (Claude Code, Cursor…). Il contient le jeton d'accès : ne le partagez pas. Le jeton change à chaque démarrage d'ARCHIMED."
          actions={
            <Button size="sm" variant="secondary" onClick={() => void copy()} icon={copied ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={1.75} />}>
              {copied ? "Copié" : "Copier"}
            </Button>
          }
        >
          <pre className="-mx-4 overflow-x-auto px-4 py-3 font-mono text-caption text-text-muted">{info.config.replace(/Bearer [0-9a-f]{8}[0-9a-f]+/, (m) => `${m.slice(0, 15)}…`)}</pre>
        </Group>
      )}
    </>
  );
}
