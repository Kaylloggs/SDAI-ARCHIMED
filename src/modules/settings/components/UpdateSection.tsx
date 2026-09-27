import { ArrowDownToLine, CheckCircle2, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useUpdaterStore } from "@/core/updater";
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
