import { useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import {
  CalendarArrowDown,
  CalendarDays,
  Columns3,
  FileText,
  Plus,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Badge, Button } from "@/design-system/primitives";
import { usePlannerStore } from "../store";
import { plannerApi } from "../api";
import {
  addCards,
  progress,
  removeColumn,
  renameColumn,
  uid,
} from "../lib/board";
import type { Board, Card } from "../types";
import { CARD_DRAG_MIME, CardItem } from "./CardItem";
import { CardPanel } from "./CardPanel";
import { CalendarView } from "./CalendarView";
import { ColumnHeader } from "./ColumnHeader";

type View = "board" | "calendar";
const VIEW_KEY = "archimed.planner.view";

function initialView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "calendar" ? "calendar" : "board";
  } catch {
    return "board";
  }
}

export function BoardView({ board }: { board: Board }) {
  const { updateBoard, syncRoadmap, setCardDone, addTasks, error } =
    usePlannerStore();
  const [view, setViewState] = useState<View>(initialView);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dropColumn, setDropColumn] = useState<string | null>(null);
  const [draftByColumn, setDraftByColumn] = useState<Record<string, string>>(
    {},
  );
  const [newColumn, setNewColumn] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const selected = board.cards.find((card) => card.id === selectedId) ?? null;
  const { done, total } = progress(board);
  const linked = Boolean(board.roadmapPath);

  const updateCard = (card: Card) =>
    updateBoard(board.id, (b) => ({
      ...b,
      cards: b.cards.map((c) => (c.id === card.id ? card : c)),
    }));

  const moveCard = (cardId: string, columnId: string) =>
    updateBoard(board.id, (b) => ({
      ...b,
      cards: b.cards.map((c) => (c.id === cardId ? { ...c, columnId } : c)),
    }));

  const addCard = (columnId: string) => {
    const title = draftByColumn[columnId]?.trim();
    if (!title) return;
    updateBoard(board.id, (b) => addCards(b, [{ title }], columnId));
    setDraftByColumn((d) => ({ ...d, [columnId]: "" }));
  };

  const setView = (next: View) => {
    setViewState(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // stockage indisponible : la vue n'est simplement pas mémorisée
    }
  };

  const setDue = (cardId: string, due: string | null) => {
    const card = board.cards.find((c) => c.id === cardId);
    if (!card) return;
    if (card.roadmapKey) {
      setNotice(
        "Cette carte vient du roadmap.md : changez sa date dans le fichier (@AAAA-MM-JJ).",
      );
      return;
    }
    updateCard({ ...card, due });
  };

  const exportCalendar = async () => {
    const events = board.cards
      .filter((card) => card.due && !card.done)
      .map((card) => ({
        uid: card.id,
        title: card.title,
        date: card.due!,
        description: card.notes || null,
      }));
    if (events.length === 0) {
      setNotice("Aucune carte avec une échéance à exporter.");
      return;
    }
    const path = await save({
      title: "Exporter les échéances (.ics)",
      defaultPath: `${board.name}.ics`,
      filters: [{ name: "Calendrier", extensions: ["ics"] }],
    });
    if (!path) return;
    const count = await plannerApi.exportIcs(path, board.name, events);
    setNotice(
      `${count} échéance(s) exportée(s). Importez le fichier dans Google Agenda (Paramètres › Importer).`,
    );
  };

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4">
          <span className="truncate text-body-sm font-medium">
            {board.name}
          </span>
          <Badge tone="neutral">
            {done}/{total}
          </Badge>
          {linked && (
            <Badge tone="accent">
              <FileText size={10} strokeWidth={1.75} />
              {board.roadmapPath!.split(/[\\/]/).at(-1)}
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-1">
            <div
              role="group"
              aria-label="Vue"
              className="mr-1 flex rounded-md border border-border bg-surface-1 p-0.5"
            >
              {(
                [
                  { id: "board", label: "Tableau", Icon: Columns3 },
                  { id: "calendar", label: "Calendrier", Icon: CalendarDays },
                ] as const
              ).map(({ id, label, Icon }) => (
                <button
                  key={id}
                  aria-pressed={view === id}
                  onClick={() => setView(id)}
                  className={cn(
                    "flex h-6 items-center gap-1.5 rounded-sm px-2 text-footnote transition-colors",
                    view === id
                      ? "bg-surface-3 text-text"
                      : "text-text-subtle hover:text-text",
                  )}
                >
                  <Icon size={12} strokeWidth={1.75} />
                  {label}
                </button>
              ))}
            </div>
            {linked && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void syncRoadmap(board.id)}
                title="Relire le roadmap.md"
              >
                <RefreshCw size={13} strokeWidth={1.75} />
                Synchroniser
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void exportCalendar()}
            >
              <CalendarArrowDown size={13} strokeWidth={1.75} />
              Exporter .ics
            </Button>
          </div>
        </header>

        {(error || notice) && (
          <p
            className={cn(
              "px-4 pt-2 text-footnote",
              error ? "text-danger" : "text-text-muted",
            )}
          >
            {error ?? notice}
          </p>
        )}

        {view === "calendar" ? (
          <CalendarView
            board={board}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onSetDue={setDue}
            onAdd={(title, due) => void addTasks(board.id, [{ title, due }])}
          />
        ) : (
          <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
            {board.columns.map((column) => {
              const cards = board.cards.filter(
                (card) => card.columnId === column.id,
              );
              const fromRoadmap = Boolean(column.roadmapSection);
              return (
                <section
                  key={column.id}
                  aria-label={column.title}
                  onDragOver={(event) => {
                    if (event.dataTransfer.types.includes(CARD_DRAG_MIME)) {
                      event.preventDefault();
                      setDropColumn(column.id);
                    }
                  }}
                  onDragLeave={() =>
                    setDropColumn((id) => (id === column.id ? null : id))
                  }
                  onDrop={(event) => {
                    const cardId = event.dataTransfer.getData(CARD_DRAG_MIME);
                    setDropColumn(null);
                    if (cardId) moveCard(cardId, column.id);
                  }}
                  className={cn(
                    "flex w-72 shrink-0 flex-col rounded-[16px] border bg-surface-2/50 transition-colors",
                    dropColumn === column.id
                      ? "border-accent/60 bg-accent-soft"
                      : "border-border",
                  )}
                >
                  <ColumnHeader
                    column={column}
                    count={cards.length}
                    onRename={(title) =>
                      updateBoard(board.id, (b) =>
                        renameColumn(b, column.id, title),
                      )
                    }
                    onDelete={() => {
                      if (selected?.columnId === column.id) setSelectedId(null);
                      updateBoard(board.id, (b) => removeColumn(b, column.id));
                    }}
                  />

                  <ul className="min-h-12 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                    {cards.map((card) => (
                      <CardItem
                        key={card.id}
                        card={card}
                        selected={card.id === selectedId}
                        draggable={!card.roadmapKey}
                        onSelect={() => setSelectedId(card.id)}
                        onToggleDone={() =>
                          void setCardDone(board.id, card, !card.done)
                        }
                      />
                    ))}
                  </ul>

                  {!fromRoadmap && (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        addCard(column.id);
                      }}
                      className="px-2 pb-2"
                    >
                      <input
                        value={draftByColumn[column.id] ?? ""}
                        onChange={(event) =>
                          setDraftByColumn((d) => ({
                            ...d,
                            [column.id]: event.target.value,
                          }))
                        }
                        placeholder="+ Ajouter une carte"
                        className="h-8 w-full rounded-md border border-transparent bg-transparent px-2 text-body-sm outline-none placeholder:text-text-subtle hover:bg-surface-1 focus:border-border-strong focus:bg-surface-1"
                      />
                    </form>
                  )}
                </section>
              );
            })}

            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!newColumn.trim()) return;
                updateBoard(board.id, (b) => ({
                  ...b,
                  columns: [
                    ...b.columns,
                    { id: uid(), title: newColumn.trim() },
                  ],
                }));
                setNewColumn("");
              }}
              className="w-64 shrink-0"
            >
              <label className="flex h-10 items-center gap-2 rounded-[16px] border border-dashed border-border px-3 text-text-subtle focus-within:border-border-strong">
                <Plus size={14} strokeWidth={1.75} />
                <input
                  value={newColumn}
                  onChange={(event) => setNewColumn(event.target.value)}
                  placeholder="Nouvelle colonne"
                  className="h-full min-w-0 flex-1 bg-transparent text-body-sm text-text outline-none placeholder:text-text-subtle"
                />
              </label>
            </form>
          </div>
        )}
      </div>

      {selected && (
        <CardPanel
          key={selected.id}
          board={board}
          card={selected}
          onChange={updateCard}
          onToggleDone={() =>
            void setCardDone(board.id, selected, !selected.done)
          }
          onDelete={() => {
            updateBoard(board.id, (b) => ({
              ...b,
              cards: b.cards.filter((c) => c.id !== selected.id),
            }));
            setSelectedId(null);
          }}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
