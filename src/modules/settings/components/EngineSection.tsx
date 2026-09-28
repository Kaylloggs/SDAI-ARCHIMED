import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Download, ExternalLink, FolderPlus, FolderSearch, Loader2, RefreshCw, RotateCcw, Terminal } from "lucide-react";
import { ENGINE_INSTALL_EVENT, engineApi, type EngineInstallStep } from "@/core/engine/engine.api";
import type { AdapterInfo } from "@/core/engine/types";
import { useAdapters } from "@/core/engine/useAdapters";
import { Badge, Button } from "@/design-system/primitives";

type Offer = { hint: string; install: boolean; page: string };

/** Agents connus : installation par la voie officielle de chaque éditeur. */
const OFFERS: Record<string, Offer> = {
  claude: {
    hint: "Anthropic, recommandé. Installé par le script officiel ; connexion avec un compte Claude ou une clé API.",
    install: true,
    page: "https://docs.claude.com/en/docs/claude-code/setup",
  },
  codex: {
    hint: "OpenAI. Installé avec npm (Node.js est installé d'abord s'il manque) ; connexion avec un compte OpenAI.",
    install: true,
    page: "https://github.com/openai/codex",
  },
  antigravity: {
    hint: "Google. Installeur à télécharger sur le site de Google ; connexion avec un compte Google.",
    install: false,
    page: "https://antigravity.google/download#antigravity-cli",
  },
};

const message = (e: unknown) => (e as { message?: string })?.message ?? String(e);

type Job = { busy: boolean; step: string | null; result: string | null; error: string | null };
const IDLE: Job = { busy: false, step: null, result: null, error: null };

function AgentRow({
  adapter,
  job,
  onInstall,
  onChanged,
}: {
  adapter: AdapterInfo;
  job: Job;
  onInstall: () => void;
  onChanged: () => Promise<void>;
}) {
  const offer = OFFERS[adapter.id];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await run();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const pickBinary = () =>
    act(async () => {
      const selected = await open({
        title: `Choisir l'exécutable de ${adapter.name}`,
        filters: [{ name: "Exécutable", extensions: ["exe", "cmd", "bat", ""] }],
      });
      if (typeof selected !== "string") return;
      await engineApi.setBinaryOverride(adapter.id, selected);
      await onChanged();
    });

  const resetBinary = () =>
    act(async () => {
      await engineApi.setBinaryOverride(adapter.id, null);
      await onChanged();
    });

  const problem = error ?? job.error;
  return (
    <div className="py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-72">
          <p className="flex flex-wrap items-center gap-2 text-body-sm text-text">
            {adapter.name}
            {adapter.installed ? (
              <Badge tone="success">
                <Check size={11} strokeWidth={2} /> {adapter.version ? `Installé · ${adapter.version}` : "Installé"}
              </Badge>
            ) : (
              <Badge tone="neutral">Absent</Badge>
            )}
          </p>
          <p className="max-w-[62ch] text-footnote text-text-subtle">{offer?.hint ?? (adapter.installed ? "CLI ajoutée par un fichier d'adaptateur." : adapter.hint)}</p>
          {adapter.binaryPath && <p className="break-all font-mono text-caption text-text-subtle">{adapter.binaryPath}</p>}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {adapter.installed ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void act(() => engineApi.openCliTerminal(adapter.id))}
                icon={<Terminal size={13} strokeWidth={1.75} />}
                title="Ouvre un terminal sur l'agent : connectez-vous en suivant ses instructions"
              >
                Se connecter
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void resetBinary()}
                aria-label={`Revenir à la détection automatique de ${adapter.name}`}
                title="Revenir à la détection automatique"
                className="px-1.5"
              >
                <RotateCcw size={13} strokeWidth={1.75} />
              </Button>
            </>
          ) : offer?.install ? (
            <Button size="sm" variant="primary" disabled={job.busy} onClick={onInstall} icon={job.busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} strokeWidth={1.75} />}>
              {job.busy ? "Installation…" : "Installer"}
            </Button>
          ) : offer ? (
            <Button size="sm" variant="secondary" onClick={() => void openUrl(offer.page)} icon={<ExternalLink size={13} strokeWidth={1.75} />}>
              Télécharger
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void pickBinary()}
            aria-label={`Choisir l'exécutable de ${adapter.name}`}
            title="Choisir l'exécutable (CLI installée hors PATH)"
            className="px-1.5"
          >
            <FolderSearch size={13} strokeWidth={1.75} />
          </Button>
        </div>
      </div>
      {job.busy && job.step && (
        <p role="status" className="pt-1.5 text-footnote text-text-muted">
          {job.step}…
        </p>
      )}
      {!job.busy && job.result && <p className="pt-1.5 text-footnote text-success">{job.result}</p>}
      {problem && (
        <p role="alert" className="pt-1.5 text-footnote text-danger">
          {problem}
        </p>
      )}
    </div>
  );
}

/**
 * Assistants IA : les CLI que le moteur pilote. Détection automatique (PATH et emplacements
 * connus), installation en un clic par la voie officielle, connexion dans leur propre terminal.
 */
export function EngineSection() {
  const { adapters, loading, refresh } = useAdapters();
  const [jobs, setJobs] = useState<Record<string, Job>>({});

  useEffect(() => {
    const stop = listen<EngineInstallStep>(ENGINE_INSTALL_EVENT, ({ payload }) => {
      setJobs((all) => ({ ...all, [payload.adapter]: { ...(all[payload.adapter] ?? IDLE), busy: true, step: payload.step } }));
    });
    return () => void stop.then((unlisten) => unlisten()).catch(() => undefined);
  }, []);

  const install = async (id: string) => {
    setJobs((all) => ({ ...all, [id]: { ...IDLE, busy: true, step: "Préparation" } }));
    try {
      const result = await engineApi.installCli(id);
      setJobs((all) => ({ ...all, [id]: { ...IDLE, result } }));
    } catch (e) {
      setJobs((all) => ({ ...all, [id]: { ...IDLE, error: message(e) } }));
    }
    await refresh(true);
  };

  if (loading && adapters.length === 0) {
    return (
      <div className="flex justify-center py-8 text-text-subtle">
        <Loader2 size={16} className="animate-spin" aria-label="Détection des CLI" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-end gap-1 pb-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void engineApi.openAdaptersDir().catch(() => undefined)}
          title="Déposez un fichier .toml pour ajouter n'importe quelle CLI (exemple fourni)"
          icon={<FolderPlus size={13} strokeWidth={1.75} />}
        >
          Ajouter une CLI…
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void refresh(true)} icon={<RefreshCw size={13} strokeWidth={1.75} />}>
          Rafraîchir
        </Button>
      </div>
      <div className="divide-y divide-border rounded-md border border-border bg-surface-1 px-4">
        {adapters.map((adapter) => (
          <AgentRow
            key={adapter.id}
            adapter={adapter}
            job={jobs[adapter.id] ?? IDLE}
            onInstall={() => void install(adapter.id)}
            onChanged={() => refresh(true)}
          />
        ))}
      </div>
    </div>
  );
}
