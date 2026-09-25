import { useEffect, useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Copy, Download, ExternalLink, Loader2, LogOut, Plus, RefreshCw, ShieldCheck, TerminalSquare } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Badge, Button } from "@/design-system/primitives";
import type { CliInfo } from "@/core/ipc/bindings/CliInfo";
import type { DownloadedImage } from "@/core/ipc/bindings/DownloadedImage";
import type { ProviderId } from "@/core/ipc/bindings/ProviderId";
import { errorText, imageMakerApi } from "../api";
import { copyImage } from "../clipboard";
import { usable } from "../lib/capabilities";
import { PROVIDER_NAMES, PROVIDER_SITES, SITE_PROVIDERS, ago, megabytes, stateLook } from "../lib/format";
import { composePrompt } from "../lib/prompt";
import { currentNode, useImageMaker } from "../store";
import { Dialog, Label, Segmented, Switch, focusRing } from "./ui";

const ACCOUNT: ProviderId = "higgsfieldAccount";

/**
 * « Créer avec votre compte » : sans clé d'API ni mot de passe.
 * Higgsfield génère ici par son outil officiel (connexion dans le navigateur) ; les autres
 * sites s'utilisent directement, puis l'image téléchargée s'importe en un clic.
 */
export function AccountDialog() {
  const open = useImageMaker((s) => s.dialog === "account");
  const set = useImageMaker((s) => s.set);
  return (
    <Dialog
      open={open}
      title="Créer avec votre compte"
      description="Sans clé d'API : vous vous connectez sur la page officielle du service, dans votre navigateur."
      width={640}
      onClose={() => set({ dialog: null })}
      footer={
        <p className="mr-auto flex items-center gap-1.5 text-footnote text-text-muted">
          <ShieldCheck size={14} className="shrink-0" />
          Aucun mot de passe ne passe par ARCHIMED, et aucun n'est enregistré.
        </p>
      }
    >
      {open && (
        <div className="space-y-6">
          <HiggsfieldAccount />
          <div className="border-t border-border" />
          <SiteImport />
        </div>
      )}
    </Dialog>
  );
}

/** Higgsfield avec votre compte et vos crédits, par l'outil officiel (CLI) de Higgsfield. */
function HiggsfieldAccount() {
  const status = useImageMaker((s) => s.statuses[ACCOUNT]);
  const [cli, setCli] = useState<CliInfo | null>(null);
  const [phase, setPhase] = useState<null | "confirm" | "installing" | "login" | "busy">(null);
  const [error, setError] = useState<string | null>(null);
  const look = stateLook(status);
  const state = status?.state;

  useEffect(() => {
    imageMakerApi.cliInfo().then(setCli, () => setCli(null));
  }, [state]);

  const act = async (next: typeof phase, work: () => Promise<void>) => {
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

  const install = () =>
    act("installing", async () => {
      await imageMakerApi.installCli();
      useImageMaker.getState().notify("success", "Outil Higgsfield installé : connectez-vous maintenant.");
      await useImageMaker.getState().refreshStatuses(true);
    });

  const login = () =>
    act("login", async () => {
      await imageMakerApi.login(ACCOUNT);
      const s = useImageMaker.getState();
      await s.refreshStatuses(false);
      await s.loadModels(ACCOUNT, true);
    });

  const use = () =>
    act("busy", async () => {
      const s = useImageMaker.getState();
      if (!s.models[ACCOUNT]) await s.loadModels(ACCOUNT, true);
      const first = useImageMaker.getState().models[ACCOUNT]?.models[0];
      if (!first) throw new Error("Aucun modèle d'image Higgsfield n'est disponible pour votre compte.");
      s.chooseModel(ACCOUNT, first.id);
      s.set({ dialog: null });
      s.notify("info", `Higgsfield (compte) : ${first.name}. Changez de modèle en haut de l'écran.`);
    });

  return (
    <section className="space-y-3" aria-labelledby="account-higgsfield">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="account-higgsfield" className="text-body font-semibold text-text">
          Higgsfield, dans l'application
        </h3>
        {status ? <Badge tone={look.tone}>{look.label}</Badge> : <Loader2 size={12} className="animate-spin text-text-subtle" />}
      </div>
      <p className="text-body-sm text-text-muted">
        Générez ici avec votre abonnement Higgsfield : plus de vingt modèles d'image (Nano Banana, GPT Image, Seedream,
        Flux, Soul…), payés avec les crédits de votre compte.
      </p>

      {state === "cliMissing" && (
        <div className="space-y-2 rounded-md bg-surface-2 p-3">
          <p className="text-footnote text-text-muted">
            Une seule fois : installer l'outil officiel de Higgsfield (sa CLI), publié sur le registre npm.
          </p>
          <code className="selectable block rounded-sm bg-surface-1 px-2 py-1.5 font-mono text-footnote text-text">
            npm install -g {cli?.package ?? "@higgsfield/cli"}
          </code>
          {cli && !cli.npm ? (
            <>
              <p className="text-footnote text-warning">
                npm est introuvable sur ce PC : installez d'abord Node.js depuis son site officiel, puis revenez ici.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" icon={<ExternalLink size={14} />} onClick={() => void openUrl("https://nodejs.org/")}>
                  Ouvrir nodejs.org
                </Button>
                <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => imageMakerApi.cliInfo().then(setCli, () => setCli(null))}>
                  Revérifier
                </Button>
              </div>
            </>
          ) : phase === "confirm" ? (
            <>
              <p className="text-footnote text-text-muted">
                Le paquet télécharge le programme <span className="font-mono">hf</span> depuis les versions publiées par
                Higgsfield sur GitHub et vérifie son empreinte (SHA-256). Rien d'autre n'est installé.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="primary" onClick={() => void install()}>
                  Installer maintenant
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPhase(null)}>
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
              <Button size="sm" icon={<TerminalSquare size={14} />} onClick={() => setPhase("confirm")}>
                Installer l'outil officiel
              </Button>
              <Button size="sm" variant="ghost" icon={<ExternalLink size={14} />} onClick={() => void openUrl(cli?.page ?? status?.keyUrl ?? "")}>
                Voir sur GitHub
              </Button>
            </div>
          )}
        </div>
      )}

      {state && state !== "cliMissing" && !usable(state) && (
        <div className="space-y-2 rounded-md bg-surface-2 p-3">
          {phase === "login" ? (
            <p className="flex items-center gap-2 text-footnote text-text">
              <Loader2 size={14} className="shrink-0 animate-spin text-accent" />
              Terminez la connexion sur la page Higgsfield ouverte dans votre navigateur…
            </p>
          ) : (
            <>
              <p className="text-footnote text-text-muted">
                {status?.detail ?? "Connectez-vous avec votre compte Higgsfield."} La page officielle s'ouvre dans votre
                navigateur ; revenez ici une fois connecté.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="primary" icon={<ExternalLink size={14} />} disabled={phase !== null} onClick={() => void login()}>
                  Se connecter
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<RefreshCw size={14} />}
                  disabled={phase !== null}
                  onClick={() => void act("busy", () => useImageMaker.getState().refreshStatuses(true))}
                >
                  Revérifier
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {usable(state) && (
        <div className="space-y-2 rounded-md bg-surface-2 p-3">
          <p className="text-footnote text-text">{status?.detail}</p>
          {status?.credits && <p className="text-footnote text-text-muted">{status.credits}</p>}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              icon={phase === "busy" ? <Loader2 size={14} className="animate-spin" /> : undefined}
              disabled={phase !== null}
              onClick={() => void use()}
            >
              Générer avec Higgsfield
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<RefreshCw size={14} />}
              disabled={phase !== null}
              onClick={() => void act("busy", () => useImageMaker.getState().refreshStatuses(true))}
            >
              Actualiser les crédits
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<LogOut size={14} />}
              disabled={phase !== null}
              onClick={() =>
                void act("busy", async () => {
                  await imageMakerApi.clearKey(ACCOUNT);
                  await useImageMaker.getState().refreshStatuses(true);
                })
              }
            >
              Se déconnecter
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-footnote text-danger">
          {error}
        </p>
      )}
      <p className="text-footnote text-text-subtle">
        Chaque demande envoie à Higgsfield son texte et les images utiles à l'opération, puis débite vos crédits.
      </p>
    </section>
  );
}

/** Texte de la demande en cours : consigne du panneau affiché. */
function currentPrompt(): string {
  const { draft, panel } = useImageMaker.getState();
  if (panel === "edit") return draft.instruction.trim();
  return (draft.structured ? composePrompt(draft.structure) : draft.prompt).trim();
}

/**
 * Sur le site officiel, puis import : vous créez avec votre abonnement dans le navigateur,
 * l'image téléchargée arrive ici (dossier Téléchargements, vérifié toutes les 5 s).
 */
function SiteImport() {
  const site = useImageMaker((s) => s.accountSite);
  const node = useImageMaker((s) => currentNode(s));
  const [since, setSince] = useState<number | null>(null);
  const [files, setFiles] = useState<DownloadedImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [attach, setAttach] = useState(true);
  const info = PROVIDER_SITES[site];
  const prompt = currentPrompt();

  const refresh = async (from: number) => {
    setLoading(true);
    try {
      setFiles(await imageMakerApi.recentDownloads(from));
    } catch (e) {
      useImageMaker.getState().notify("warning", errorText(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (since === null) return;
    const timer = setInterval(() => void refresh(since), 5000);
    return () => clearInterval(timer);
  }, [since]);

  const importFile = (file: DownloadedImage) => {
    const s = useImageMaker.getState();
    void s.importPaths([file.path], attach && node ? node.id : null, info.label).then(() => {
      s.set({ dialog: null });
      s.notify("success", `Image importée depuis ${info.label}.`);
    });
  };

  return (
    <section className="space-y-3" aria-labelledby="account-sites">
      <h3 id="account-sites" className="text-body font-semibold text-text">
        Sur le site officiel, puis import
      </h3>
      <p className="text-body-sm text-text-muted">
        Créez avec votre abonnement directement sur le site, téléchargez l'image : elle apparaît ici et s'importe en un clic.
      </p>
      <Segmented
        label="Site"
        value={site}
        onChange={(accountSite) => useImageMaker.getState().set({ accountSite })}
        options={SITE_PROVIDERS.map((p) => ({ value: p, label: PROVIDER_NAMES[p] }))}
      />
      <ol className="space-y-2.5">
        <Step n={1} title="Préparer">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="ghost"
              icon={<Copy size={14} />}
              disabled={!prompt}
              onClick={() =>
                void navigator.clipboard.writeText(prompt).then(
                  () => useImageMaker.getState().notify("success", "Demande copiée : collez-la sur le site."),
                  () => useImageMaker.getState().notify("warning", "Copie impossible."),
                )
              }
            >
              Copier la demande
            </Button>
            <Button size="sm" variant="ghost" icon={<Copy size={14} />} disabled={!node} onClick={() => node && void copyImage(node)}>
              Copier l'image affichée
            </Button>
          </div>
          {node && (
            <p className="text-footnote text-text-subtle">L'image ne part sur le site que si vous l'y collez vous-même.</p>
          )}
        </Step>
        <Step n={2} title={`Créer sur ${info.label}`}>
          <Button
            size="sm"
            icon={<ExternalLink size={14} />}
            onClick={() => {
              const from = Date.now() - 60_000;
              setSince(from);
              void refresh(from);
              void openUrl(info.url);
            }}
          >
            Ouvrir {info.label}
          </Button>
        </Step>
        <Step n={3} title="Importer l'image téléchargée">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              variant="ghost"
              icon={loading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              onClick={() => {
                const from = since ?? Date.now() - 24 * 3600_000;
                setSince(from);
                void refresh(from);
              }}
            >
              {since === null ? "Voir les images téléchargées" : "Actualiser"}
            </Button>
            {node && (
              <Switch checked={attach} onChange={setAttach}>
                Nouvelle version de l'image affichée
              </Switch>
            )}
          </div>
          {since !== null &&
            (files.length === 0 ? (
              <p className="text-footnote text-text-subtle">
                Aucune image téléchargée pour l'instant (dossier Téléchargements, vérifié toutes les 5 s). Vous pouvez aussi
                glisser l'image dans la fenêtre, ou la coller avec Ctrl+V.
              </p>
            ) : (
              <ul className="space-y-1" aria-label="Images téléchargées">
                {files.slice(0, 6).map((file) => (
                  <li key={file.path} className="flex items-center gap-2 text-footnote">
                    <span className="min-w-0 flex-1 truncate text-text">{file.name}</span>
                    <span className="shrink-0 tabular-nums text-text-subtle">
                      {megabytes(file.bytes)} · {ago(file.modified)}
                    </span>
                    <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => importFile(file)}>
                      Importer
                    </Button>
                  </li>
                ))}
              </ul>
            ))}
        </Step>
      </ol>
    </section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-caption font-medium tabular-nums text-text-muted"
      >
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <Label>{title}</Label>
        {children}
      </div>
    </li>
  );
}

/** Lien discret vers « Créer avec votre compte », là où une clé manque. */
export function AccountLink({ className, site }: { className?: string; site?: ProviderId }) {
  return (
    <button
      type="button"
      onClick={() => useImageMaker.getState().set({ dialog: "account", ...(site ? { accountSite: site } : {}) })}
      className={cn("text-footnote text-accent hover:underline", focusRing, className)}
    >
      Pas de clé ? Créer avec votre compte
    </button>
  );
}
