import { useEffect, useState, type CSSProperties } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, FileCode2, Globe, RotateCw, X } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { engineApi } from "@/core/engine/engine.api";
import { EmptyState, Select, Tooltip } from "@/design-system/primitives";
import type { PreviewTarget } from "./usePreviewTargets";

type Props = {
  targets: PreviewTarget[];
  /** Cible à afficher en priorité (ex. fichier HTML actif dans l'éditeur). */
  preferredId?: string | null;
  onClose: () => void;
  className?: string;
  style?: CSSProperties;
  /** Change quand les fichiers du projet changent sur disque : l'aperçu se recharge. */
  refreshKey?: number;
};

function sourceOf(target: PreviewTarget): string {
  return target.kind === "server" ? target.url : convertFileSrc(target.path);
}

/**
 * Aperçu d'une page web : serveur de test lancé par l'agent ou fichier HTML local
 * (servi par le protocole `asset` de Tauri, les CSS/JS relatifs suivent).
 */
export function PreviewPane({ targets, preferredId = null, onClose, className, style, refreshKey = 0 }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(preferredId);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (preferredId) setSelectedId(preferredId);
  }, [preferredId]);

  const target = targets.find((t) => t.id === selectedId) ?? targets[0] ?? null;

  // Un fichier régénéré par l'agent doit se recharger : on relit à chaque changement de liste.
  const targetsKey = targets.map((t) => t.id).join("|");
  useEffect(() => {
    setReloadKey((key) => key + 1);
  }, [targetsKey]);

  const openOutside = () => {
    if (!target) return;
    if (target.kind === "server") void openUrl(target.url).catch(() => undefined);
    else void engineApi.openPath(target.path).catch(() => undefined);
  };

  return (
    <section style={style} className={cn("flex min-h-0 flex-col bg-bg-subtle", className)} aria-label="Aperçu">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        {target?.kind === "server" ? (
          <span className="relative flex size-2 shrink-0" aria-label="Serveur actif">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-success" />
          </span>
        ) : (
          <FileCode2 size={13} strokeWidth={1.75} className="shrink-0 text-text-subtle" />
        )}
        {targets.length > 1 ? (
          <Select
            label="Page à prévisualiser"
            value={target?.id ?? ""}
            onChange={setSelectedId}
            className="min-w-0 max-w-64"
            options={targets.map((t) => ({
              value: t.id,
              label: t.label,
              hint: t.kind === "server" ? "serveur" : "fichier",
            }))}
          />
        ) : (
          <span className="truncate text-footnote text-text-muted">{target?.label ?? "Aperçu"}</span>
        )}
        {target?.kind === "server" && (
          <span className="hidden truncate font-mono text-caption text-text-subtle lg:inline">{target.url}</span>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <Tooltip label="Recharger" side="bottom">
            <button
              onClick={() => setReloadKey((key) => key + 1)}
              disabled={!target}
              aria-label="Recharger l'aperçu"
              className="flex size-7 items-center justify-center rounded-sm text-text-subtle hover:bg-surface-2 hover:text-text disabled:opacity-40"
            >
              <RotateCw size={13} strokeWidth={1.75} />
            </button>
          </Tooltip>
          <Tooltip label={target?.kind === "file" ? "Ouvrir dans le navigateur par défaut" : "Ouvrir dans le navigateur"} side="bottom">
            <button
              onClick={openOutside}
              disabled={!target}
              aria-label="Ouvrir dans le navigateur"
              className="flex size-7 items-center justify-center rounded-sm text-text-subtle hover:bg-surface-2 hover:text-text disabled:opacity-40"
            >
              <ExternalLink size={13} strokeWidth={1.75} />
            </button>
          </Tooltip>
          <Tooltip label="Fermer l'aperçu" side="bottom">
            <button
              onClick={onClose}
              aria-label="Fermer l'aperçu"
              className="flex size-7 items-center justify-center rounded-sm text-text-subtle hover:bg-surface-2 hover:text-text"
            >
              <X size={13} strokeWidth={1.75} />
            </button>
          </Tooltip>
        </div>
      </header>

      {target ? (
        <iframe
          key={`${target.id}:${reloadKey}:${refreshKey}`}
          title={`Aperçu de ${target.label}`}
          src={sourceOf(target)}
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
          className="min-h-0 w-full flex-1 border-0 bg-white"
        />
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={<Globe size={28} strokeWidth={1.5} />}
            title="Rien à prévisualiser"
            description="Quand l'agent lance un serveur de test (pnpm dev, python -m http.server…) ou crée une page HTML, elle apparaît ici."
          />
        </div>
      )}
    </section>
  );
}
