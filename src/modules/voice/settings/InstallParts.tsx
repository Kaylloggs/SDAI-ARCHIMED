import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Download, ExternalLink, Play, Terminal } from "lucide-react";
import { useAdapters } from "@/core/engine/useAdapters";
import { Badge, Button } from "@/design-system/primitives";
import { voiceApi, type VoiceToolStatus } from "../api";
import { message, ModelInstallButton, recommended, ToolFeedback, useModelCatalog, useToolInstaller } from "./install";
import { useVoiceSettings } from "./useVoiceSettings";

type AgentOffer = { id: string; name: string; hint: string; install: boolean; page: string };

/** Agents proposés : installation par la voie officielle de chaque éditeur. */
export const AGENTS: AgentOffer[] = [
  {
    id: "claude",
    name: "Claude Code",
    hint: "Anthropic, recommandé. Installé par le script officiel ; se connecter avec un compte Claude ou une clé API.",
    install: true,
    page: "https://docs.claude.com/en/docs/claude-code/setup",
  },
  {
    id: "codex",
    name: "Codex",
    hint: "OpenAI. Installé avec npm (Node.js est installé d'abord s'il manque) ; se connecter avec un compte OpenAI.",
    install: true,
    page: "https://github.com/openai/codex",
  },
  {
    id: "antigravity",
    name: "Antigravity",
    hint: "Google. Installeur à télécharger sur le site de Google ; se connecter avec un compte Google.",
    install: false,
    page: "https://antigravity.google/download#antigravity-cli",
  },
];

function Line({ name, hint, status, children }: { name: string; hint: string; status: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <div className="min-w-0 flex-1 basis-72">
        <p className="flex items-center gap-2 text-body-sm text-text">
          {name}
          {status}
        </p>
        <p className="max-w-[62ch] text-footnote text-text-subtle">{hint}</p>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">{children}</div>
    </div>
  );
}

/** Claude Code, Codex, Antigravity : état, installation, connexion. */
export function AgentRows() {
  const { adapters, loading, refresh } = useAdapters();
  const [error, setError] = useState<string | null>(null);
  const installer = useToolInstaller(useCallback(() => void refresh(true), [refresh]));

  return (
    <div className="divide-y divide-border">
      {AGENTS.map((agent) => {
        const info = adapters.find((a) => a.id === agent.id);
        const state = installer.state(agent.id);
        return (
          <div key={agent.id}>
            <Line
              name={agent.name}
              hint={agent.hint}
              status={
                loading && !info ? null : info?.installed ? (
                  <Badge tone="success">
                    <Check size={11} strokeWidth={2} /> {info.version ? `Installé · ${info.version}` : "Installé"}
                  </Badge>
                ) : (
                  <Badge tone="neutral">Absent</Badge>
                )
              }
            >
              {info?.installed ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void voiceApi.agentTerminal(agent.id).catch((e) => setError(message(e)))}
                  icon={<Terminal size={13} strokeWidth={1.75} />}
                  title="Ouvre un terminal sur l'agent : connectez-vous en suivant ses instructions"
                >
                  Se connecter
                </Button>
              ) : agent.install ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={state.busy}
                  onClick={() => void installer.install(agent.id)}
                  icon={<Download size={13} strokeWidth={1.75} />}
                >
                  {state.busy ? "Installation…" : "Installer"}
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => void openUrl(agent.page)} icon={<ExternalLink size={13} strokeWidth={1.75} />}>
                  Télécharger
                </Button>
              )}
            </Line>
            <ToolFeedback state={state} />
          </div>
        );
      })}
      {error && (
        <p role="alert" className="py-2 text-footnote text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

const TOOL_HINTS: Record<string, string> = {
  ollama: "Fait tourner les modèles d'intelligence locale (hors ligne). Installé avec winget.",
  voicebox: "Studio de voix local : voix naturelles et vos voix personnelles. Dernière version vérifiée (SHA-256) depuis GitHub.",
};

/** Ollama et Voicebox : installer, lancer ; pour Ollama, le modèle conseillé. */
export function ToolRows({ only }: { only?: string }) {
  const { settings } = useVoiceSettings();
  const [tools, setTools] = useState<VoiceToolStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const catalog = useModelCatalog();

  const refresh = useCallback(() => {
    void voiceApi
      .tools()
      .then(setTools)
      .catch(() => setTools([]));
  }, []);
  useEffect(refresh, [refresh]);
  const installer = useToolInstaller(refresh);

  const launch = async (id: string) => {
    setError(null);
    try {
      await voiceApi.launchTool(id);
      // Le serveur met quelques secondes à répondre.
      setTimeout(refresh, 3000);
      setTimeout(refresh, 8000);
    } catch (e) {
      setError(message(e));
    }
  };

  const llm = catalog.models ? recommended(catalog.models, "llm", settings.general.language) : null;

  return (
    <div className="divide-y divide-border">
      {(tools ?? []).filter((t) => !only || t.id === only).map((tool) => {
        const state = installer.state(tool.id);
        return (
          <div key={tool.id}>
            <Line
              name={tool.name}
              hint={TOOL_HINTS[tool.id] ?? ""}
              status={
                tool.running ? (
                  <Badge tone="success">Lancé</Badge>
                ) : tool.installed ? (
                  <Badge tone="neutral">Installé, arrêté</Badge>
                ) : (
                  <Badge tone="neutral">Absent</Badge>
                )
              }
            >
              {tool.running ? null : tool.installed ? (
                tool.canLaunch && (
                  <Button size="sm" variant="secondary" onClick={() => void launch(tool.id)} icon={<Play size={13} strokeWidth={1.75} />}>
                    Lancer
                  </Button>
                )
              ) : tool.canInstall ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={state.busy}
                  onClick={() => void installer.install(tool.id)}
                  icon={<Download size={13} strokeWidth={1.75} />}
                >
                  {state.busy ? "Installation…" : "Installer"}
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => void openUrl(tool.page)} icon={<ExternalLink size={13} strokeWidth={1.75} />}>
                  Télécharger
                </Button>
              )}
              {tool.id === "ollama" && tool.running && llm && catalog.models && (
                <ModelInstallButton entry={llm} progress={catalog.progress[llm.id]} onError={setError} />
              )}
            </Line>
            <ToolFeedback state={state} />
          </div>
        );
      })}
      {tools === null && <p className="py-3 text-footnote text-text-subtle">Recherche…</p>}
      {error && (
        <p role="alert" className="py-2 text-footnote text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
