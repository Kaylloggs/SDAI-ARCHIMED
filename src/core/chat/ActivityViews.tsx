import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Brain, ChevronRight, Clock, Coins, Cpu, FilePlus2, Loader2, PenLine, Search, Terminal, Wrench } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { ToolCallCard } from "@/core/cards/ToolCallCard";
import type { ChatSession, TimelineItem } from "@/core/engine/session.store";
import { duration, ease } from "@/design-system/motion";
import { categorize, formatDuration, formatTokens, liveLabel, summarizeTools } from "./activity";

type ToolItem = Extract<TimelineItem, { kind: "tool" }>;
type TurnItem = Extract<TimelineItem, { kind: "turn" }>;

const ICONS = {
  create: FilePlus2,
  edit: PenLine,
  command: Terminal,
  read: Search,
  search: Search,
  web: Search,
  task: Wrench,
  other: Wrench,
} as const;

/** Suite d'outils regroupée : « 2 fichiers créés · 2 commandes exécutées », dépliable. */
export function ActivityGroup({ items, running }: { items: ToolItem[]; running: boolean }) {
  const [open, setOpen] = useState(false);
  const pending = items.some((item) => item.ok === undefined);
  const summary = summarizeTools(items);
  const icons = [...new Set(items.map((item) => categorize(item.tool)))].slice(0, 3);

  return (
    <div className="rounded-lg border border-border bg-surface-1/60">
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <ChevronRight
          size={13}
          strokeWidth={1.75}
          className={cn("shrink-0 text-text-subtle transition-transform", open && "rotate-90")}
        />
        <span className="flex shrink-0 items-center -space-x-1">
          {icons.map((category) => {
            const Icon = ICONS[category];
            return (
              <span key={category} className="flex size-5 items-center justify-center rounded-full border border-border bg-surface-2">
                <Icon size={11} strokeWidth={1.75} className="text-text-muted" />
              </span>
            );
          })}
        </span>
        <span className="min-w-0 flex-1 truncate text-footnote text-text-muted">{summary}</span>
        {pending && running && <Loader2 size={12} className="shrink-0 animate-spin text-text-subtle" />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: duration.base, ease: ease.emphasized }}
            className="overflow-hidden"
          >
            <div className="space-y-1.5 border-t border-border p-2">
              {items.map((item) => (
                <ToolCallCard key={item.id} tool={item.tool} input={item.input} output={item.output} ok={item.ok} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Indicateur « en direct » : Réflexion…, Création de main.rs…, avec chronomètre. */
export function LiveActivity({ session }: { session: ChatSession }) {
  const [now, setNow] = useState(() => Date.now());
  const active = session.activity && (session.status === "running" || session.status === "awaiting" || session.status === "starting");

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [active]);

  if (!active || !session.activity) return null;
  const elapsed = session.turnStartedAt ? now - session.turnStartedAt : 0;
  const thinking = session.activity.phase === "thinking";

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 text-footnote text-text-muted"
    >
      {thinking ? (
        <Brain size={14} strokeWidth={1.75} className="shrink-0 animate-pulse text-accent" />
      ) : (
        <Loader2 size={13} className="shrink-0 animate-spin text-accent" />
      )}
      <span className="truncate">
        <span className="bg-gradient-to-r from-text-muted via-text to-text-muted bg-[length:200%_100%] bg-clip-text text-transparent [animation:shimmer_2s_linear_infinite]">
          {liveLabel(session.activity.phase, session.activity.label)}
        </span>
        …
      </span>
      {elapsed > 1000 && <span className="shrink-0 tabular-nums text-text-subtle">{formatDuration(Math.round(elapsed / 100) * 100)}</span>}
    </motion.div>
  );
}

/** Bilan sous la réponse : durée, tokens, coût. */
export function TurnFooter({ turn }: { turn: TurnItem }) {
  // Deux grandeurs distinctes : ce que l'agent a écrit, et le contexte relu pour l'écrire
  // (instructions, outils, skills, historique — surtout servi depuis le cache, bien moins cher).
  const context = turn.inputTokens + turn.cacheTokens;
  const cachedShare = context > 0 ? Math.round((turn.cacheTokens / context) * 100) : 0;
  const fr = (value: number) => value.toLocaleString("fr-FR");
  const detail = [
    `Générés : ${fr(turn.outputTokens)}${turn.thinkingTokens ? ` (dont réflexion ${fr(turn.thinkingTokens)})` : ""}`,
    `Contexte lu : ${fr(context)} (dont cache ${fr(turn.cacheTokens)})`,
    "Le contexte (instructions, outils, skills, historique) est renvoyé à chaque message ; la partie en cache coûte environ 10 fois moins.",
  ].join("\n");

  return (
    <div className="-mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-text-subtle">
      {turn.durationMs !== null && (
        <span className="inline-flex items-center gap-1 tabular-nums">
          <Clock size={11} strokeWidth={1.75} />
          {formatDuration(turn.durationMs)}
        </span>
      )}
      <span className="inline-flex items-center gap-1 tabular-nums" title={detail}>
        <Cpu size={11} strokeWidth={1.75} />
        {formatTokens(turn.outputTokens)} tokens générés
        {context > 0 && (
          <span className="text-text-subtle/80">
            · contexte {formatTokens(context)}
            {cachedShare > 0 && ` (${cachedShare} % en cache)`}
          </span>
        )}
      </span>
      {turn.costUsd !== null && (
        <span className="inline-flex items-center gap-1 tabular-nums" title="Coût estimé par la CLI (équivalent API)">
          <Coins size={11} strokeWidth={1.75} />
          {turn.costUsd.toLocaleString("fr-FR", { style: "currency", currency: "USD", maximumFractionDigits: 3 })}
        </span>
      )}
      {!turn.ok && <span className="text-danger">terminé en erreur</span>}
    </div>
  );
}

/** Regroupe les outils consécutifs d'une timeline pour l'affichage. */
export type DisplayItem = TimelineItem | { kind: "tools"; id: string; items: ToolItem[] };

export function groupTimeline(timeline: TimelineItem[]): DisplayItem[] {
  const out: DisplayItem[] = [];
  for (const item of timeline) {
    const last = out.at(-1);
    if (item.kind === "tool") {
      if (last?.kind === "tools") last.items.push(item);
      else out.push({ kind: "tools", id: `tools-${item.id}`, items: [item] });
    } else {
      out.push(item);
    }
  }
  return out;
}
