import { useEffect, useState } from "react";
import { ArrowDownToLine, CheckCircle2, ExternalLink, FolderOpen, Loader2, Puzzle, RefreshCw } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useLocalUpdateStore, useUpdaterStore } from "@/core/updater";
import { Button, Card } from "@/design-system/primitives";

const KIND = { installer: "installée", portable: "portable", dev: "de développement" } as const;

const time = (ms: number) => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

/** Version en cours et recherche manuelle d'une mise à jour (le bouton vit dans la barre de titre). */
export function UpdateSection({ version }: { version: string }) {
  const { status, checking, checkError, checkedAt, check } = useUpdaterStore();
  const update = status?.available;

  const state = !status
    ? checkError
      ? checkError
      : checking
        ? "Recherche en cours…"
        : "Pas encore vérifié."
    : status.kind === "dev"
      ? "Build de développement (pnpm tauri dev) : mettez à jour le code avec git, pas l'application."
      : checkError
        ? checkError
        : update
          ? `ARCHIMED ${update.version} est disponible : bouton « Mise à jour » en haut à droite.`
          : `À jour${checkedAt ? ` (vérifié à ${time(checkedAt)})` : ""}.`;

  return (
    <Card className="flex items-center gap-3 py-3">
      <span className={update ? "text-accent" : "text-text-subtle"} aria-hidden>
        {update ? <ArrowDownToLine size={16} strokeWidth={1.75} /> : <CheckCircle2 size={16} strokeWidth={1.75} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium">
          Version {status?.current ?? version}
          {status && (
            <span className="font-normal text-text-subtle">
              {" "}
              · {status.source ? "compilée depuis votre code source" : KIND[status.kind]}
            </span>
          )}
        </p>
        <p className="text-footnote text-text-subtle">{state}</p>
      </div>
      {status && (
        <Button size="sm" variant="ghost" onClick={() => void openUrl(status.releasesUrl).catch(() => undefined)} icon={<ExternalLink size={13} strokeWidth={1.75} />}>
          Versions
        </Button>
      )}
      <Button
        size="sm"
        disabled={checking || status?.kind === "dev"}
        onClick={() => void check()}
        icon={checking ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} strokeWidth={1.75} />}
      >
        Rechercher
      </Button>
    </Card>
  );
}

/**
 * Code source d'ARCHIMED suivi pour la mise à jour locale : ARCHIMED y repère les modules
 * créés ou modifiés et propose de les intégrer (pastille bleue de la barre de titre).
 */
export function SourceFolderSection() {
  const { status, error, refresh, setSourceDir } = useLocalUpdateStore();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const choose = async () => {
    const selected = await open({ directory: true, title: "Dossier du code source d'ARCHIMED (celui qui contient src-tauri)" });
    if (typeof selected !== "string") return;
    setBusy(true);
    await setSourceDir(selected).catch(() => undefined);
    setBusy(false);
  };

  const pending = status?.modules.length ?? 0;
  const detail = !status?.sourceDir
    ? "Aucun. Choisissez le dossier où vous avez cloné le projet pour qu'ARCHIMED repère vos nouveaux modules."
    : !status.valid
      ? "Ce dossier n'existe plus ou ne contient plus le code d'ARCHIMED."
      : pending === 0
        ? "Aucun module nouveau ou modifié depuis la compilation."
        : `${pending} module${pending > 1 ? "s" : ""} nouveau${pending > 1 ? "x" : ""} ou modifié${pending > 1 ? "s" : ""} : pastille bleue « Mise à jour » en haut à droite.`;

  return (
    <Card className="flex items-center gap-3 py-3">
      <span className="text-info" aria-hidden>
        <Puzzle size={16} strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium">Code source suivi</p>
        {status?.sourceDir && (
          <p className="truncate font-mono text-footnote text-text-muted" title={status.sourceDir}>
            {status.sourceDir}
            {!status.configured && <span className="font-sans text-text-subtle"> · celui de la compilation</span>}
          </p>
        )}
        <p className="text-footnote text-text-subtle">{error ?? detail}</p>
      </div>
      {status?.configured && (
        <Button size="sm" variant="ghost" onClick={() => void setSourceDir(null).catch(() => undefined)}>
          Oublier
        </Button>
      )}
      <Button size="sm" disabled={busy} onClick={() => void choose()} icon={<FolderOpen size={13} strokeWidth={1.75} />}>
        Choisir…
      </Button>
    </Card>
  );
}
