import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Download, Loader2, Terminal } from "lucide-react";
import { Button, EmptyState } from "@/design-system/primitives";
import { INSTALL_LOG, jobagentApi } from "../api";
import { useJobAgentStore } from "../store";

/**
 * Premier écran du module : le moteur de recherche tourne dans son propre environnement
 * Python, installé une fois pour toutes dans le dossier de données d'ARCHIMED.
 */
export function EngineSetup() {
  const status = useJobAgentStore((state) => state.status);
  const refreshStatus = useJobAgentStore((state) => state.refreshStatus);
  const [installing, setInstalling] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const journal = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stop: (() => void) | null = null;
    void listen<string>(INSTALL_LOG, (event) => {
      setLines((current) => [...current.slice(-200), event.payload]);
      requestAnimationFrame(() => {
        journal.current?.scrollTo({ top: journal.current.scrollHeight });
      });
    }).then((off) => {
      stop = off;
    });
    return () => stop?.();
  }, []);

  const install = async () => {
    setInstalling(true);
    setError(null);
    setLines([]);
    try {
      await jobagentApi.installEngine();
      await refreshStatus();
    } catch (problem) {
      setError((problem as { message?: string }).message ?? "Installation impossible");
    } finally {
      setInstalling(false);
    }
  };

  const noPython = status !== null && !status.python;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
      <EmptyState
        icon={<Download size={28} strokeWidth={1.5} />}
        title={noPython ? "Python est nécessaire" : "Installer le moteur de recherche"}
        description={
          noPython
            ? "Le moteur interroge les plateformes d'emploi depuis un environnement Python isolé. Installez Python 3.10 ou plus récent depuis python.org, puis revenez ici."
            : "Une installation unique (environ deux minutes) crée un environnement isolé dans le dossier d'ARCHIMED. Aucun paquet n'est ajouté au Python du système."
        }
        action={
          <Button onClick={() => void install()} disabled={installing || noPython} variant="primary">
            {installing ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Installation…
              </>
            ) : (
              <>
                <Download size={14} /> Installer le moteur
              </>
            )}
          </Button>
        }
      />

      {error ? <p className="text-body-sm text-danger">{error}</p> : null}

      {lines.length > 0 && (
        <div
          ref={journal}
          className="max-h-56 w-full max-w-2xl overflow-y-auto rounded-md border border-border bg-surface-1 p-3 font-mono text-caption text-text-muted"
        >
          <p className="mb-1 flex items-center gap-1.5 text-text-subtle">
            <Terminal size={12} /> Journal d'installation
          </p>
          {lines.map((line, index) => (
            <p key={index} className="[overflow-wrap:anywhere]">
              {line}
            </p>
          ))}
        </div>
      )}

      {status?.missing.length ? (
        <p className="text-footnote text-text-subtle">
          Manquant : {status.missing.join(", ")}
        </p>
      ) : null}
    </div>
  );
}
