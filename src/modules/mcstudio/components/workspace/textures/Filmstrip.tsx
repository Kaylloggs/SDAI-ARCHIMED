import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "motion/react";
import { Brush, ImageUp, Sparkles, Trash2 } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { enterUp } from "@/design-system/motion";
import type { TextureDraft } from "@/core/ipc/bindings/TextureDraft";
import type { TextureInfo } from "@/core/ipc/bindings/TextureInfo";
import { ago } from "../../../lib/format";
import { focusRing } from "../../ui";

const SOURCE_ICON = { openRouter: Sparkles, gemini: Sparkles, file: ImageUp, project: Brush } as const;

function Thumb({ src, active, label, caption, onClick, children }: {
  src: string | null;
  active: boolean;
  label: string;
  caption: React.ReactNode;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="group relative shrink-0">
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        aria-label={label}
        title={label}
        onClick={onClick}
        className={cn(
          "flex w-16 flex-col items-center gap-1 rounded-md p-1 transition-colors",
          active ? "bg-accent-soft" : "hover:bg-surface-2",
          focusRing,
        )}
      >
        <span
          className={cn(
            "flex size-12 items-center justify-center overflow-hidden rounded-sm border",
            active ? "border-accent" : "border-border",
            "bg-[repeating-conic-gradient(var(--color-surface-2)_0%_25%,var(--color-surface-1)_0%_50%)] bg-[length:8px_8px]",
          )}
        >
          {src && <img src={src} alt="" draggable={false} className="size-11 object-contain [image-rendering:pixelated]" />}
        </span>
        <span className="flex max-w-full items-center gap-1 truncate text-caption text-text-subtle">{caption}</span>
      </button>
      {children}
    </div>
  );
}

/**
 * Bande des versions de la texture : l'actuelle (celle du projet), puis chaque proposition
 * générée, importée ou retouchée, gardée même fermée.
 */
export function Filmstrip({
  texture,
  drafts,
  current,
  onCurrent,
  onOpen,
  onDelete,
}: {
  texture: TextureInfo;
  drafts: TextureDraft[];
  current: string | null;
  onCurrent: () => void;
  onOpen: (draft: TextureDraft) => void;
  onDelete: (draft: TextureDraft) => void;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <div aria-label="Versions de la texture" role="group" className="flex items-center gap-1 overflow-x-auto px-4 py-2">
      <Thumb
        src={texture.exists ? `${convertFileSrc(texture.path)}?v=${texture.modified ?? 0}` : null}
        active={current === null}
        label="Texture actuelle du projet"
        caption="Actuelle"
        onClick={onCurrent}
      />
      {drafts.length > 0 && <span aria-hidden className="mx-2 h-10 w-px shrink-0 bg-border" />}
      <AnimatePresence initial={false}>
        {drafts.map((draft) => {
          const Icon = SOURCE_ICON[draft.source.kind];
          const asking = confirm === draft.id;
          return (
            <motion.div key={draft.id} variants={enterUp} initial="hidden" animate="visible" exit="exit" layout>
              <Thumb
                src={`${convertFileSrc(draft.pixelPath)}?v=${draft.revision}`}
                active={draft.id === current}
                label={`Proposition de ${ago(draft.createdAt)}${draft.edited ? ", retouchée" : ""}`}
                caption={
                  <>
                    <Icon size={11} aria-hidden className="shrink-0" />
                    {draft.edited ? "retouchée" : ago(draft.createdAt).replace("il y a ", "")}
                  </>
                }
                onClick={() => onOpen(draft)}
              >
                <button
                  type="button"
                  aria-label={asking ? "Confirmer : retirer cette proposition" : "Retirer cette proposition"}
                  title={asking ? "Cliquer encore pour retirer" : "Retirer cette proposition"}
                  onClick={() => {
                    if (asking) {
                      setConfirm(null);
                      onDelete(draft);
                    } else setConfirm(draft.id);
                  }}
                  onBlur={() => setConfirm((c) => (c === draft.id ? null : c))}
                  className={cn(
                    "absolute -right-1 -top-1 flex size-6 items-center justify-center rounded-full border transition-opacity",
                    asking
                      ? "border-transparent bg-danger text-text opacity-100"
                      : "border-border bg-surface-2 text-text-muted opacity-0 hover:text-text group-hover:opacity-100 focus-visible:opacity-100",
                    focusRing,
                  )}
                >
                  <Trash2 size={12} />
                </button>
              </Thumb>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
