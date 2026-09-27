import { useEffect, useRef, useState } from "react";
import { Check, Copy, GitBranch } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { contextPercent } from "@/core/chat";
import type { GitStatus } from "@/core/engine/workspace.api";

const pill =
  "flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-footnote transition-colors";
const idle = "border-border text-text-muted hover:border-border-strong hover:text-text";
const pressed = "border-accent/50 bg-accent-soft text-accent";

function tokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")} M`;
  if (value >= 1000) return `${Math.round(value / 1000)} k`;
  return String(value);
}

/**
 * Part du contexte du modèle déjà occupée (dernier appel). Proche de la limite, un clic
 * demande à la CLI de résumer la conversation (`/compact`) quand elle le permet.
 */
export function ContextMeter({
  context,
  onCompact,
}: {
  context: { used: number; window: number | null } | undefined;
  onCompact?: () => void;
}) {
  const percent = contextPercent(context);
  if (percent === null || !context) return null;
  const tone = percent >= 90 ? "text-danger" : percent >= 75 ? "text-warning" : "text-text-subtle";
  const radius = 5.5;
  const length = 2 * Math.PI * radius;
  const compact = onCompact && percent >= 60;
  const label = `Contexte utilisé : ${percent} % (${tokens(context.used)} sur ${tokens(context.window ?? 0)} tokens)${
    compact ? " — cliquer pour résumer la conversation et libérer de la place" : ""
  }`;
  return (
    <button
      type="button"
      onClick={compact ? onCompact : undefined}
      disabled={!compact}
      title={label}
      aria-label={label}
      className={cn(pill, "border-transparent px-1.5 disabled:cursor-default", compact && "hover:bg-surface-2", tone)}
    >
      <svg viewBox="0 0 14 14" className="size-3.5 -rotate-90" aria-hidden>
        <circle cx="7" cy="7" r={radius} fill="none" strokeWidth="2" className="stroke-surface-3" />
        <circle
          cx="7"
          cy="7"
          r={radius}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          stroke="currentColor"
          strokeDasharray={`${(percent / 100) * length} ${length}`}
        />
      </svg>
      <span className="font-mono text-caption tabular-nums">{percent} %</span>
    </button>
  );
}

/** Branche et nombre de fichiers modifiés ; ouvre le panneau des modifications. */
export function ChangesButton({ status, open, onToggle }: { status: GitStatus | null | undefined; open: boolean; onToggle: () => void }) {
  const count = status?.files.length ?? 0;
  const label = status === null ? "Modifications" : (status?.branch ?? "Modifications");
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={open}
      title={
        status === null
          ? "Ce dossier n'est pas suivi par git"
          : `${count} fichier${count > 1 ? "s" : ""} modifié${count > 1 ? "s" : ""} depuis le dernier commit`
      }
      className={cn(pill, "max-w-48", open ? pressed : idle)}
    >
      <GitBranch size={12} strokeWidth={1.75} className="shrink-0" aria-hidden />
      <span className="truncate font-mono">{label}</span>
      {count > 0 && (
        <span className="shrink-0 rounded-full bg-surface-3 px-1.5 text-caption tabular-nums text-text">{count}</span>
      )}
    </button>
  );
}

/** Copie la conversation en Markdown ; coche pendant deux secondes. */
export function CopyConversationButton({ getText }: { getText: () => string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(getText()).then(() => {
          setDone(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setDone(false), 2000);
        });
      }}
      aria-label="Copier la conversation en Markdown"
      title="Copier la conversation en Markdown"
      className="flex size-7 shrink-0 items-center justify-center rounded-sm text-text-subtle hover:bg-surface-2 hover:text-text"
    >
      {done ? <Check size={13} className="text-success" /> : <Copy size={13} strokeWidth={1.75} />}
    </button>
  );
}
