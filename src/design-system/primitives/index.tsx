import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/core/lib/cn";

export { Button } from "./Button";
export { Select, type SelectOption } from "./Select";
export { Tooltip } from "./Tooltip";

/** Carte de contenu (couche L2). */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-surface-1 p-4",
        className,
      )}
      {...props}
    />
  );
}

/** Couche flottante (L3) — seul usage autorisé du glass. */
export function GlassPanel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("glass rounded-xl", className)} {...props} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-xs border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-caption text-text-muted">
      {children}
    </kbd>
  );
}

export function SectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-4 pb-6">
      <div className="space-y-1">
        <h1 className="text-title-1 font-semibold tracking-[-0.015em]">{title}</h1>
        {description ? (
          <p className="text-body text-text-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      {icon ? <div className="text-text-subtle">{icon}</div> : null}
      <div className="space-y-1">
        <p className="text-title-3 font-semibold">{title}</p>
        {description ? (
          <p className="mx-auto max-w-[46ch] text-body text-text-muted">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "success" | "info" | "warning" | "danger" | "accent";
  children: ReactNode;
}) {
  const tones = {
    neutral: "bg-surface-2 text-text-muted border-border",
    success: "bg-success-soft text-success border-transparent",
    info: "bg-info-soft text-info border-transparent",
    warning: "bg-warning-soft text-warning border-transparent",
    danger: "bg-danger-soft text-danger border-transparent",
    accent: "bg-accent-soft text-accent border-transparent",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-xs border px-1.5 py-0.5 text-caption font-medium",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}
