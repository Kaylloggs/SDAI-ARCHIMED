import { useCallback, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CheckCircle2, ExternalLink, Loader2, LogOut, RefreshCw, ShieldCheck, TerminalSquare } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Button } from "@/design-system/primitives";
import type { ConnectionState } from "@/core/ipc/bindings/ConnectionState";
import type { HiggsfieldCliState } from "@/core/ipc/bindings/HiggsfieldCliState";
import type { ProviderStatus } from "@/core/ipc/bindings/ProviderStatus";
import { errorText, mcstudioApi } from "../api";

/** Le compte peut dessiner (connecté, ou pas encore vérifié mais sans erreur connue). */
export function accountUsable(state: ConnectionState | undefined): boolean {
  return state === "connected" || state === "disconnected";
}

type Phase = null | "confirm" | "installing" | "login" | "busy";

/**
 * Higgsfield avec le compte de la personne, par l'outil officiel (CLI) : installé une fois
 * après confirmation, puis connexion sur la page de Higgsfield dans le navigateur. Aucun mot
 * de passe ne passe par ici ; les images sont payées avec les crédits de l'abonnement.
 */
export function HiggsfieldAccountCard({
  onChange,
  compact = false,
}: {
  onChange?: (usable: boolean) => void;
  compact?: boolean;
}) {
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [cli, setCli] = useState<HiggsfieldCliState | null>(null);
  const [phase, setPhase] = useState<Phase>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // En ref : un `onChange` écrit en ligne ne doit pas relancer la lecture à chaque rendu.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const publish = useCallback((next: ProviderStatus) => {
    setStatus(next);
    onChangeRef.current?.(accountUsable(next.state));
  }, []);

  useEffect(() => {
    let cancelled = false;
    mcstudioApi
      .higgsfieldStatus(true, false)
      .then((next) => !cancelled && publish(next))
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [publish]);

  const state = status?.state;
  useEffect(() => {
    if (state !== "cliMissing") return;
    mcstudioApi.higgsfieldCliState().then(setCli, () => setCli(null));
  }, [state]);

  const act = async (next: Phase, work: () => Promise<void>) => {
    setPhase(next);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPhase(null);
    }
  };

  const recheck = () => act("busy", async () => publish(await mcstudioApi.higgsfieldStatus(true, true)));
  const install = () =>
    act("installing", async () => {
      await mcstudioApi.installHiggsfieldTool();
      publish(await mcstudioApi.higgsfieldStatus(true, true));
    });
  const login = () => act("login", async () => publish(await mcstudioApi.higgsfieldLogin()));
  const logout = () =>
    act("busy", async () => {
      publish(await mcstudioApi.clearHiggsfieldKey(true));
      setConfirmLogout(false);
    });

  const alert = error && (
    <p role="alert" className="text-footnote text-danger">
      {error}
    </p>
  );

  if (!status) {
    return error ? alert : <Loader2 size={14} className="animate-spin text-text-subtle" aria-label="Lecture du compte" />;
  }

  if (accountUsable(status.state)) {
    return (
      <div className="space-y-2">
        <p className="flex items-start gap-1.5 text-footnote text-success">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
          <span className="text-text-muted">
            {status.state === "connected" ? "Compte Higgsfield connecté" : "Compte Higgsfield enregistré"}
            {status.credits ? ` · ${status.credits}` : ""}
          </span>
        </p>
        {alert}
        {confirmLogout ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-footnote text-text-muted">L'outil Higgsfield sera déconnecté de ce PC.</p>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmLogout(false)}>
              Annuler
            </Button>
            <Button type="button" size="sm" variant="danger" disabled={phase !== null} onClick={() => void logout()}>
              Se déconnecter
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={phase !== null}
              onClick={() => void recheck()}
              icon={phase === "busy" ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            >
              Vérifier
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={phase !== null}
              icon={<LogOut size={14} />}
              onClick={() => setConfirmLogout(true)}
            >
              Déconnecter…
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", !compact && "rounded-md border border-border bg-surface-1 p-3")}>
      {status.state === "cliMissing" ? (
        <>
          <p className="text-footnote text-text-muted">
            Une seule fois : installer l'outil officiel de Higgsfield (sa CLI), publié sur le registre npm.
          </p>
          <code className="selectable block rounded-sm bg-surface-2 px-2 py-1.5 font-mono text-footnote text-text">
            npm install -g {cli?.package ?? "@higgsfield/cli"}
          </code>
          {cli && !cli.npm ? (
            <>
              <p className="text-footnote text-warning">
                npm est introuvable sur ce PC : installez d'abord Node.js depuis son site officiel, puis revérifiez.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" icon={<ExternalLink size={14} />} onClick={() => void openUrl("https://nodejs.org/")}>
                  Ouvrir nodejs.org
                </Button>
                <Button type="button" size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => void recheck()}>
                  Revérifier
                </Button>
              </div>
            </>
          ) : phase === "confirm" ? (
            <>
              <p className="text-footnote text-text-muted">
                Le paquet télécharge le programme <span className="font-mono">hf</span> publié par Higgsfield sur GitHub et
                vérifie son empreinte (SHA-256). Rien d'autre n'est installé.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="primary" onClick={() => void install()}>
                  Installer maintenant
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setPhase(null)}>
                  Annuler
                </Button>
              </div>
            </>
          ) : phase === "installing" ? (
            <p className="flex items-center gap-2 text-footnote text-text-muted">
              <Loader2 size={14} className="animate-spin" />
              Installation par npm, jusqu'à quelques minutes…
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" icon={<TerminalSquare size={14} />} onClick={() => setPhase("confirm")}>
                Installer l'outil officiel
              </Button>
              <Button type="button" size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => void recheck()}>
                Revérifier
              </Button>
            </div>
          )}
        </>
      ) : phase === "login" ? (
        <p className="flex items-center gap-2 text-footnote text-text">
          <Loader2 size={14} className="shrink-0 animate-spin text-accent" />
          Terminez la connexion sur la page Higgsfield ouverte dans votre navigateur…
        </p>
      ) : (
        <>
          <p className="text-footnote text-text-muted">
            {status.detail ?? "Connectez-vous avec votre compte Higgsfield."} La page officielle s'ouvre dans votre
            navigateur ; aucun mot de passe ne passe par ARCHIMED.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="primary"
              icon={<ExternalLink size={14} />}
              disabled={phase !== null}
              onClick={() => void login()}
            >
              Se connecter
            </Button>
            <Button type="button" size="sm" variant="ghost" icon={<RefreshCw size={14} />} disabled={phase !== null} onClick={() => void recheck()}>
              Revérifier
            </Button>
          </div>
        </>
      )}
      {alert}
    </div>
  );
}
