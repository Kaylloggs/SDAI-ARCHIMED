import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CalendarPlus, Check, FileText, Trash2, X } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Badge, Button } from "@/design-system/primitives";
import { googleCalendarUrl } from "../lib/calendar";
import { MarkdownNotes } from "./MarkdownNotes";
import type { Board, Card } from "../types";

type Props = {
  board: Board;
  card: Card;
  onChange: (card: Card) => void;
  onToggleDone: () => void;
  onDelete: () => void;
  onClose: () => void;
};

const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function shift(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return iso(date);
}

/** Panneau de détail d'une carte. Pas de `<input type="date">` : son calendrier est dessiné par le système. */
export function CardPanel({ board, card, onChange, onToggleDone, onDelete, onClose }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dueDraft, setDueDraft] = useState(card.due ?? "");
  const fromRoadmap = Boolean(card.roadmapKey);
  const validDue = /^\d{4}-\d{2}-\d{2}$/.test(dueDraft) && !Number.isNaN(Date.parse(dueDraft));

  const setDue = (value: string | null) => {
    setDueDraft(value ?? "");
    onChange({ ...card, due: value });
  };

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-bg-subtle">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="text-caption font-medium text-text-subtle">Carte</span>
        {fromRoadmap && (
          <Badge tone="accent">
            <FileText size={10} strokeWidth={1.75} />
            roadmap
          </Badge>
        )}
        <button aria-label="Fermer" onClick={onClose} className="ml-auto text-text-subtle hover:text-text">
          <X size={14} strokeWidth={1.75} />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <textarea
          value={card.title}
          readOnly={fromRoadmap}
          rows={2}
          onChange={(event) => onChange({ ...card, title: event.target.value })}
          title={fromRoadmap ? "Le titre vient du roadmap.md : modifiez-le dans le fichier." : undefined}
          className="selectable w-full resize-none bg-transparent text-title-3 font-semibold outline-none"
        />

        <Button variant={card.done ? "secondary" : "primary"} size="sm" onClick={onToggleDone}>
          <Check size={13} strokeWidth={2} />
          {card.done ? "Rouvrir" : "Marquer comme terminée"}
        </Button>

        <section className="space-y-1.5">
          <p className="text-caption font-medium text-text-subtle">Échéance</p>
          <input
            value={dueDraft}
            placeholder="AAAA-MM-JJ"
            onChange={(event) => setDueDraft(event.target.value)}
            onBlur={() => {
              if (!dueDraft) setDue(null);
              else if (validDue) setDue(dueDraft);
              else setDueDraft(card.due ?? "");
            }}
            className={cn(
              "h-8 w-full rounded-md border bg-surface-1 px-2.5 font-mono text-body-sm outline-none",
              dueDraft && !validDue ? "border-danger/60" : "border-border focus:border-border-strong",
            )}
          />
          <div className="flex flex-wrap gap-1">
            {[
              ["Aujourd'hui", 0],
              ["Demain", 1],
              ["+1 semaine", 7],
            ].map(([label, days]) => (
              <Button key={label} size="sm" variant="ghost" onClick={() => setDue(shift(days as number))}>
                {label}
              </Button>
            ))}
            {card.due && (
              <Button size="sm" variant="ghost" onClick={() => setDue(null)}>
                Effacer
              </Button>
            )}
          </div>
          {card.due && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void openUrl(
                  googleCalendarUrl({
                    title: card.title,
                    date: card.due!,
                    details: `Tableau « ${board.name} »${card.notes ? `\n\n${card.notes}` : ""}`,
                  }),
                )
              }
            >
              <CalendarPlus size={13} strokeWidth={1.75} />
              Ajouter à Google Agenda
            </Button>
          )}
        </section>

        <section className="space-y-1.5">
          <p className="text-caption font-medium text-text-subtle">Étiquettes</p>
          <input
            defaultValue={card.labels.join(", ")}
            placeholder="urgent, design…"
            onBlur={(event) =>
              onChange({
                ...card,
                labels: event.target.value.split(",").map((l) => l.trim()).filter(Boolean),
              })
            }
            className="h-8 w-full rounded-md border border-border bg-surface-1 px-2.5 text-body-sm outline-none placeholder:text-text-subtle focus:border-border-strong"
          />
        </section>

        {(card.subtasks?.length ?? 0) > 0 && (
          <section className="space-y-1.5">
            <p className="text-caption font-medium text-text-subtle">Sous-tâches (roadmap)</p>
            <ul className="space-y-1">
              {card.subtasks!.map((subtask) => (
                <li key={subtask.title} className="flex items-center gap-2 text-body-sm">
                  <span
                    className={cn(
                      "flex size-3.5 items-center justify-center rounded-full border",
                      subtask.done ? "border-accent bg-accent text-accent-fg" : "border-border-strong",
                    )}
                  >
                    {subtask.done && <Check size={8} strokeWidth={3} />}
                  </span>
                  <span className={cn(subtask.done && "text-text-subtle line-through")}>{subtask.title}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <MarkdownNotes value={card.notes} onChange={(notes) => onChange({ ...card, notes })} />
      </div>

      {!fromRoadmap && (
        <footer className="border-t border-border p-3">
          <Button
            size="sm"
            variant={confirmDelete ? "danger" : "ghost"}
            onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
          >
            <Trash2 size={13} strokeWidth={1.75} />
            {confirmDelete ? "Confirmer la suppression" : "Supprimer la carte"}
          </Button>
        </footer>
      )}
    </aside>
  );
}
