import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Button } from "@/design-system/primitives";
import { dueState, formatMonth, isoDate, monthGrid } from "../lib/calendar";
import type { Board, Card } from "../types";
import { CARD_DRAG_TYPE } from "./CardItem";
import { DropZone, useDragSource } from "@/core/dnd";

type Props = {
  board: Board;
  selectedId: string | null;
  onSelect: (cardId: string) => void;
  onSetDue: (cardId: string, due: string | null) => void;
  onAdd: (title: string, due: string) => void;
};

const WEEKDAYS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
const MAX_PER_DAY = 3;

const TONE = {
  late: "border-l-danger",
  today: "border-l-warning",
  soon: "border-l-info",
} as const;

/**
 * Vue mensuelle des échéances. Glisser une carte sur un jour fixe son échéance
 * (cartes créées à la main : celles d'un roadmap.md prennent leur date dans le fichier, `@AAAA-MM-JJ`).
 */
export function CalendarView({ board, selectedId, onSelect, onSetDue, onAdd }: Props) {
  const today = isoDate(new Date());
  const [cursor, setCursor] = useState(() => ({ year: new Date().getFullYear(), month: new Date().getMonth() }));
  const [draftDate, setDraftDate] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const grid = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const byDate = useMemo(() => {
    const map = new Map<string, Card[]>();
    for (const card of board.cards) {
      if (!card.due) continue;
      map.set(card.due, [...(map.get(card.due) ?? []), card]);
    }
    return map;
  }, [board.cards]);
  const undated = board.cards.filter((card) => !card.due && !card.done);

  const shiftMonth = (delta: number) =>
    setCursor(({ year, month }) => {
      const next = new Date(year, month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });

  const submitDraft = () => {
    if (draftDate && draft.trim()) onAdd(draft.trim(), draftDate);
    setDraft("");
    setDraftDate(null);
  };

  const chip = (card: Card) => (
    <CalendarChip key={card.id} card={card} selected={card.id === selectedId} onSelect={() => onSelect(card.id)} />
  );

  return (
    <div className="flex min-h-0 flex-1 gap-3 p-4">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-title-3 font-semibold">{formatMonth(cursor.year, cursor.month)}</h2>
          <div className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="ghost" aria-label="Mois précédent" onClick={() => shiftMonth(-1)}>
              <ChevronLeft size={14} strokeWidth={1.75} />
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setCursor({ year: new Date().getFullYear(), month: new Date().getMonth() })}
            >
              Aujourd'hui
            </Button>
            <Button size="sm" variant="ghost" aria-label="Mois suivant" onClick={() => shiftMonth(1)}>
              <ChevronRight size={14} strokeWidth={1.75} />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-px pb-1">
          {WEEKDAYS.map((day) => (
            <span key={day} className="px-2 text-caption uppercase tracking-wide text-text-subtle">
              {day}
            </span>
          ))}
        </div>

        <div
          className="grid min-h-0 flex-1 grid-cols-7 gap-px overflow-hidden rounded-[16px] border border-border bg-border"
          style={{ gridTemplateRows: `repeat(${grid.length / 7}, minmax(0, 1fr))` }}
        >
          {grid.map(({ date, day, inMonth }) => {
            const cards = byDate.get(date) ?? [];
            const open = expanded === date;
            const visible = open ? cards : cards.slice(0, MAX_PER_DAY);
            return (
              <DropZone
                key={date}
                accept={[CARD_DRAG_TYPE]}
                onDrop={(item) => onSetDue(item.payload, date)}
                className={({ isOver }) =>
                  cn(
                    "group/day flex min-h-0 flex-col gap-1 overflow-hidden p-1.5 transition-colors",
                    inMonth ? "bg-surface-2/60" : "bg-bg-subtle",
                    isOver && "bg-accent-soft",
                    open && "overflow-y-auto",
                  )
                }
              >
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      "flex size-5 items-center justify-center rounded-full text-caption tabular-nums",
                      date === today
                        ? "bg-accent font-semibold text-accent-fg"
                        : inMonth
                          ? "text-text-muted"
                          : "text-text-subtle/60",
                    )}
                  >
                    {day}
                  </span>
                  <button
                    onClick={() => {
                      setDraftDate(date);
                      setDraft("");
                    }}
                    aria-label={`Ajouter une carte le ${date}`}
                    className="flex size-5 items-center justify-center rounded-xs text-text-subtle opacity-0 hover:bg-surface-3 hover:text-text focus-visible:opacity-100 group-hover/day:opacity-100"
                  >
                    <Plus size={11} strokeWidth={2} />
                  </button>
                </div>

                {draftDate === date && (
                  <input
                    autoFocus
                    value={draft}
                    placeholder="Titre…"
                    aria-label="Titre de la nouvelle carte"
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={submitDraft}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") submitDraft();
                      if (event.key === "Escape") setDraftDate(null);
                    }}
                    className="h-6 w-full rounded-xs border border-border-strong bg-surface-1 px-1.5 text-caption outline-none"
                  />
                )}

                <ul className="space-y-0.5">{visible.map(chip)}</ul>
                {cards.length > MAX_PER_DAY && (
                  <button
                    onClick={() => setExpanded(open ? null : date)}
                    className="text-left text-caption text-text-subtle hover:text-text"
                  >
                    {open ? "Réduire" : `+${cards.length - MAX_PER_DAY} autre${cards.length - MAX_PER_DAY > 1 ? "s" : ""}`}
                  </button>
                )}
              </DropZone>
            );
          })}
        </div>
      </div>

      <DropZone
        as="aside"
        accept={[CARD_DRAG_TYPE]}
        onDrop={(item) => onSetDue(item.payload, null)}
        className={({ isOver }) =>
          cn(
            "flex w-56 shrink-0 flex-col rounded-[16px] border bg-surface-2/50 transition-colors",
            isOver ? "border-accent/60 bg-accent-soft" : "border-border",
          )
        }
      >
        <header className="flex items-center gap-2 px-3 pb-2 pt-3">
          <h3 className="text-body-sm font-semibold">Sans échéance</h3>
          <span className="text-caption text-text-subtle">{undated.length}</span>
        </header>
        <p className="px-3 pb-2 text-caption text-text-subtle">Glissez une carte sur un jour pour la planifier.</p>
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">{undated.map(chip)}</ul>
      </DropZone>
    </div>
  );
}

function CalendarChip({ card, selected, onSelect }: { card: Card; selected: boolean; onSelect: () => void }) {
  const state = !card.done && card.due ? dueState(card.due) : null;
  const drag = useDragSource(card.roadmapKey ? null : { type: CARD_DRAG_TYPE, payload: card.id, label: card.title });
  return (
    <li onPointerDown={drag.onPointerDown}>
      <button
        onClick={onSelect}
        title={card.title}
        className={cn(
          "block w-full truncate rounded-xs border-l-2 bg-surface-1 px-1.5 py-0.5 text-left text-caption transition-colors hover:bg-surface-3",
          state ? TONE[state] : "border-l-accent/50",
          card.done && "text-text-subtle line-through",
          selected && "ring-1 ring-accent/60",
          !card.roadmapKey && "cursor-grab active:cursor-grabbing",
        )}
      >
        {card.title}
      </button>
    </li>
  );
}
