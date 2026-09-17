import { Calendar, Check, ListChecks } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { dueState, formatDue } from "../lib/calendar";
import { InlineMarkdown, plainText } from "./InlineMarkdown";
import type { Card } from "../types";

import { motion } from "motion/react";
import { useDragSource } from "@/core/dnd";
import { spring } from "@/design-system/motion";

export const CARD_DRAG_TYPE = "planner-card";

type Props = {
  card: Card;
  selected: boolean;
  draggable: boolean;
  onSelect: () => void;
  onToggleDone: () => void;
};

const DUE_TONE = {
  late: "bg-danger-soft text-danger",
  today: "bg-warning-soft text-warning",
  soon: "bg-info-soft text-info",
} as const;

export function CardItem({ card, selected, draggable, onSelect, onToggleDone }: Props) {
  const state = card.due && !card.done ? dueState(card.due) : null;
  const subtasksDone = card.subtasks?.filter((s) => s.done).length ?? 0;
  // L'aperçu qui suit la souris est la carte elle-même (titre + échéance).
  const preview = (
    <div className="rounded-[12px] border border-accent/60 bg-surface-1 p-2.5 text-body-sm text-text">
      <InlineMarkdown>{card.title}</InlineMarkdown>
    </div>
  );
  const drag = useDragSource(
    draggable ? { type: CARD_DRAG_TYPE, payload: card.id, label: plainText(card.title), preview } : null,
  );

  return (
    // `layout` : la carte glisse à sa nouvelle place ; pendant un glisser elle est retirée
    // de la colonne (voir BoardView), la place se referme donc d'elle-même.
    <motion.li
      layout
      transition={spring.gentle}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.12 } }}
      onPointerDown={drag.onPointerDown}
      className={cn(
        "group rounded-[12px] border bg-surface-1 p-2.5 transition-colors",
        selected ? "border-accent/60" : "border-border hover:border-border-strong",
        draggable && "cursor-grab active:cursor-grabbing",
      )}
    >
      <div className="flex items-start gap-2">
        <button
          role="checkbox"
          aria-checked={card.done}
          aria-label={card.done ? `Rouvrir « ${plainText(card.title)} »` : `Terminer « ${plainText(card.title)} »`}
          onClick={onToggleDone}
          className={cn(
            "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
            card.done ? "border-accent bg-accent text-accent-fg" : "border-border-strong hover:border-accent",
          )}
        >
          {card.done && <Check size={10} strokeWidth={3} />}
        </button>
        <button onClick={onSelect} className="min-w-0 flex-1 text-left">
          <span className={cn("block text-body-sm", card.done && "text-text-subtle line-through")}>
            <InlineMarkdown>{card.title}</InlineMarkdown>
          </span>
          {(card.due || card.labels.length > 0 || (card.subtasks?.length ?? 0) > 0) && (
            <span className="mt-1.5 flex flex-wrap items-center gap-1">
              {card.due && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 text-caption",
                    state ? DUE_TONE[state] : "bg-surface-2 text-text-subtle",
                  )}
                >
                  <Calendar size={10} strokeWidth={1.75} />
                  {formatDue(card.due)}
                </span>
              )}
              {(card.subtasks?.length ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1 rounded-xs bg-surface-2 px-1.5 py-0.5 text-caption text-text-subtle">
                  <ListChecks size={10} strokeWidth={1.75} />
                  {subtasksDone}/{card.subtasks!.length}
                </span>
              )}
              {card.labels.map((label) => (
                <span key={label} className="rounded-xs bg-accent-soft px-1.5 py-0.5 text-caption text-accent">
                  {label}
                </span>
              ))}
            </span>
          )}
        </button>
      </div>
    </motion.li>
  );
}
