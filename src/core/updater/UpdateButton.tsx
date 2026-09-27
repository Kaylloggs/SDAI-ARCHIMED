import { useEffect, useState, type ComponentProps } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowDownToLine, ExternalLink, Hammer, Loader2, Puzzle, RotateCw } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useSessionStore } from "@/core/engine/session.store";
import { cn } from "@/core/lib/cn";
import { Button, Popover } from "@/design-system/primitives";
import type { AvailableUpdate, InstallKind, SourceBuild } from "./api";
import { formatMegabytes, percent, releaseHighlights } from "./notes";
import { scheduleUpdateChecks, useUpdaterStore } from "./store";

const ACTIVE = ["starting", "running", "awaiting"];

/** Liens des notes : ouverts dans le navigateur, jamais dans la WebView. */
function NoteLink({ href = "", children }: ComponentProps<"a">) {
  const web = /^https:\/\//i.test(href);
  return web ? (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        void openUrl(href).catch(() => undefined);
      }}
    >
      {children}
    </a>
  ) : (
    <span>{children}</span>
  );
}

const NOTE_COMPONENTS: Components = { a: NoteLink };

const HOW: Record<InstallKind, string> = {
  installer: "ARCHIMED se ferme, s'installe et se rouvre tout seul. Conversations, réglages, skills et clés sont gardés.",
  portable: "Le fichier d'ARCHIMED est remplacé par la nouvelle version, puis relancé. Conversations, réglages, skills et clés sont gardés.",
  dev: "",
};

function SourceBox({ update, source, confirming }: { update: AvailableUpdate; source: SourceBuild; confirming: boolean }) {
  const mine = source.customModules;
  return (
    <div className="space-y-1.5 rounded-sm border border-border px-2.5 py-2 text-footnote text-text-muted">
      <p className="flex items-center gap-1.5 font-medium text-text">
        <Puzzle size={13} strokeWidth={1.75} className="text-accent" aria-hidden />
        {confirming ? "Version officielle : vos modules ne seront plus là" : "Vos modules sont gardés"}
      </p>
      {mine && mine.length > 0 && (
        <p>
          Modules à vous : <span className="font-mono text-text">{mine.join(", ")}</span>.
        </p>
      )}
      {mine && mine.length === 0 && <p>Aucun module à vous détecté ; vos modifications du code sont gardées aussi.</p>}
      {confirming ? (
        <p>
          Le fichier officiel ne contient que les modules d'origine. Leurs données restent sur ce PC et reviennent si vous recompilez
          votre code.
        </p>
      ) : (
        <p>
          La {update.version} est fusionnée dans votre code, puis ARCHIMED est recompilé et réinstallé. Une fenêtre PowerShell montre
          l'avancement (quelques minutes) ; ARCHIMED se ferme à la fin. Si vos modifications touchent les mêmes lignes que la nouvelle
          version, rien n'est changé.
        </p>
      )}
      <p className="truncate font-mono text-caption text-text-subtle" title={source.dir}>
        {source.dir}
      </p>
    </div>
  );
}

function UpdatePanel({ update, current, kind, source }: { update: AvailableUpdate; current: string; kind: InstallKind; source: SourceBuild | null }) {
  const { phase, received, total, installError, install, rebuild, cancel } = useUpdaterStore();
  const running = useSessionStore((s) => s.sessions.filter((session) => ACTIVE.includes(session.status)).length);
  const [confirmOfficial, setConfirmOfficial] = useState(false);
  const busy = phase === "downloading" || phase === "verifying" || phase === "installing";
  const highlights = releaseHighlights(update.notes);

  useEffect(() => {
    if (!confirmOfficial) return;
    const timer = setTimeout(() => setConfirmOfficial(false), 6000);
    return () => clearTimeout(timer);
  }, [confirmOfficial]);

  return (
    // Petite fenêtre : le panneau défile plutôt que de sortir de l'écran.
    <div className="-m-3 max-h-[calc(100vh-72px)] space-y-3 overflow-y-auto overscroll-contain p-3">
      <div className="flex items-start gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent" aria-hidden>
          <ArrowDownToLine size={15} strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <p className="text-body-sm font-semibold">ARCHIMED {update.version} est disponible</p>
          <p className="text-footnote text-text-muted">
            {source ? `Vous avez la ${current}, compilée depuis votre code` : `Vous avez la ${current} · ${formatMegabytes(update.size)} à télécharger`}
          </p>
        </div>
      </div>

      {highlights && (
        <div
          className={cn(
            "selectable overflow-y-auto rounded-sm border border-border bg-surface-1 px-3 py-2 text-footnote leading-5 text-text-muted",
            source ? "max-h-36" : "max-h-56",
            "[&_h2]:pt-1 [&_h2]:font-semibold [&_h2]:text-text [&_h3]:pt-2 [&_h3]:font-semibold [&_h3]:text-text first:[&>*]:pt-0",
            "[&_p]:py-0.5 [&_ul]:list-disc [&_ul]:py-0.5 [&_ul]:pl-4 [&_li]:py-px [&_strong]:text-text",
            "[&_code]:rounded-xs [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:font-mono [&_a]:text-accent [&_a]:underline",
          )}
        >
          <Markdown remarkPlugins={[remarkGfm]} components={NOTE_COMPONENTS}>
            {highlights}
          </Markdown>
        </div>
      )}

      {source && !busy && <SourceBox update={update} source={source} confirming={confirmOfficial} />}
      {source && !source.ready && !busy && (
        <p className="rounded-sm bg-warning-soft px-2.5 py-1.5 text-footnote text-text">
          Le code source de cette version est introuvable à cet emplacement : mettez à jour votre copie du code (git pull), puis
          recompilez avec .\build.ps1.
        </p>
      )}

      {phase === "rebuilding" ? (
        <p className="rounded-sm bg-accent-soft px-2.5 py-1.5 text-footnote text-text" aria-live="polite">
          La mise à jour se poursuit dans la fenêtre PowerShell. Vous pouvez continuer à travailler : ARCHIMED se fermera à la fin pour
          installer la nouvelle version.
        </p>
      ) : busy ? (
        <div className="space-y-1.5" aria-live="polite">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className={cn("h-full rounded-full bg-accent transition-[width] duration-150", phase !== "downloading" && "w-full animate-pulse")}
              style={phase === "downloading" ? { width: `${Math.max(2, percent(received, total))}%` } : undefined}
            />
          </div>
          <div className="flex items-center gap-2 text-footnote text-text-muted">
            <span className="min-w-0 flex-1">
              {phase === "downloading"
                ? `Téléchargement : ${formatMegabytes(received)} sur ${formatMegabytes(total)}`
                : phase === "verifying"
                  ? "Vérification de l'empreinte du fichier…"
                  : kind === "portable"
                    ? "Nouvelle version en place : ARCHIMED redémarre…"
                    : "Installation : ARCHIMED va se fermer puis se rouvrir…"}
            </span>
            {phase === "downloading" && (
              <Button size="sm" variant="ghost" onClick={cancel}>
                Annuler
              </Button>
            )}
          </div>
        </div>
      ) : (
        <>
          {running > 0 && (
            <p className="rounded-sm bg-warning-soft px-2.5 py-1.5 text-footnote text-text">
              {running === 1 ? "Une IA travaille encore" : `${running} IA travaillent encore`} : la mise à jour{" "}
              {running === 1 ? "l'interrompra" : "les interrompra"}. Attendre la fin est plus sûr.
            </p>
          )}
          {installError && (
            <p role="alert" className="rounded-sm bg-danger-soft px-2.5 py-1.5 text-footnote text-text">
              {installError}
            </p>
          )}
          {!source && <p className="text-footnote text-text-subtle">{HOW[kind]}</p>}
        </>
      )}

      {source && !busy && phase !== "rebuilding" && (
        <Button
          size="sm"
          variant={confirmOfficial ? "danger" : "ghost"}
          className="w-full justify-start whitespace-nowrap"
          onClick={() => {
            if (!confirmOfficial) return setConfirmOfficial(true);
            setConfirmOfficial(false);
            void install(true);
          }}
        >
          {confirmOfficial ? "Confirmer : installer la version officielle" : "Installer plutôt la version officielle…"}
        </Button>
      )}

      <div className="flex items-center gap-2 border-t border-border pt-3">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void openUrl(update.url).catch(() => undefined)}
          className="whitespace-nowrap"
          icon={<ExternalLink size={13} strokeWidth={1.75} />}
        >
          {installError && !source ? "Télécharger sur GitHub" : "Voir sur GitHub"}
        </Button>
        <span className="ml-auto" />
        {source ? (
          <Button
            size="sm"
            variant="primary"
            disabled={busy || phase === "rebuilding" || !source.ready}
            onClick={() => void rebuild()}
            className="whitespace-nowrap"
            title="Fusionner la nouvelle version dans votre code, recompiler et réinstaller"
            icon={phase === "rebuilding" ? <Loader2 size={13} className="animate-spin" /> : <Hammer size={13} strokeWidth={1.75} />}
          >
            Fusionner et recompiler
          </Button>
        ) : (
          <Button
            size="sm"
            variant="primary"
            disabled={busy}
            onClick={() => void install()}
            className="whitespace-nowrap"
            title={kind === "portable" ? "Télécharger, remplacer et relancer ARCHIMED" : "Télécharger, installer et rouvrir ARCHIMED"}
            icon={busy ? <Loader2 size={13} className="animate-spin" /> : <RotateCw size={13} strokeWidth={1.75} />}
          >
            {installError ? "Réessayer" : "Mettre à jour"}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Pastille de la barre de titre, à gauche des boutons de fenêtre : n'apparaît que lorsqu'une
 * version plus récente est publiée sur GitHub (vérifiée au démarrage puis toutes les 6 h).
 */
export function UpdateButton() {
  const status = useUpdaterStore((s) => s.status);
  const phase = useUpdaterStore((s) => s.phase);
  const received = useUpdaterStore((s) => s.received);
  const total = useUpdaterStore((s) => s.total);

  useEffect(() => scheduleUpdateChecks(), []);

  const update = status?.available;
  if (!status || !update) return null;
  const busy = phase === "downloading" || phase === "verifying" || phase === "installing" || phase === "rebuilding";
  const value =
    phase === "downloading"
      ? `${percent(received, total)} %`
      : phase === "verifying"
        ? "Vérification"
        : phase === "installing"
          ? "Redémarrage"
          : phase === "rebuilding"
            ? "Recompilation"
            : "Mise à jour";

  return (
    <div className="glass-chrome flex shrink-0 items-center rounded-full p-0.5">
      <Popover
        label={`Mise à jour : ARCHIMED ${update.version}`}
        title={busy ? `Mise à jour vers la ${update.version} en cours` : `ARCHIMED ${update.version} est disponible`}
        value={value}
        icon={
          busy ? (
            <Loader2 size={14} strokeWidth={1.75} className="animate-spin" aria-hidden />
          ) : (
            <span className="relative flex" aria-hidden>
              <ArrowDownToLine size={14} strokeWidth={1.75} />
              <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-accent" />
            </span>
          )
        }
        width={340}
        align="end"
        chevron={false}
        className="h-8 rounded-full border-transparent bg-transparent px-3 font-medium text-accent hover:border-transparent hover:bg-surface-2"
      >
        <UpdatePanel update={update} current={status.current} kind={status.kind} source={status.source} />
      </Popover>
    </div>
  );
}
