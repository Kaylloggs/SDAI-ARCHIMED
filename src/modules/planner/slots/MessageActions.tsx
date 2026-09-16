import { useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AnimatePresence, motion } from "motion/react";
import { CalendarPlus, Check, KanbanSquare } from "lucide-react";
import type { SlotContext } from "@/core/modules";
import { Button, Select } from "@/design-system/primitives";
import { popIn } from "@/design-system/motion";
import { usePlannerStore } from "../store";
import { extractEvents, extractTasks } from "../lib/extract";
import { formatDue, googleCalendarUrl } from "../lib/calendar";

const NEW_BOARD = "__new";

/**
 * Contribution au slot `chat.message.actions` : n'apparaît que si le message de
 * l'assistant contient des tâches ou des dates (« quand c'est nécessaire »).
 */
export default function MessageActions({ text = "", cwd = null }: SlotContext) {
  const tasks = useMemo(() => extractTasks(text).filter((task) => !task.done), [text]);
  const events = useMemo(() => extractEvents(text), [text]);
  const { boards, loaded, load, addTasks, createBoard } = usePlannerStore();
  const [panel, setPanel] = useState<"tasks" | "events" | null>(null);
  const [boardId, setBoardId] = useState<string>("");
  const [added, setAdded] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (panel && !loaded) void load();
  }, [panel, loaded, load]);

  // Tableau suggéré : celui du projet de la conversation, sinon le plus récent.
  useEffect(() => {
    if (boardId || boards.length === 0) return;
    const project = cwd ? boards.find((b) => b.projectRoot && cwd.toLowerCase().startsWith(b.projectRoot.toLowerCase())) : null;
    setBoardId(project?.id ?? [...boards].sort((a, b) => b.updatedAt - a.updatedAt)[0]!.id);
  }, [boards, boardId, cwd]);

  useEffect(() => {
    if (!panel) return;
    const close = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setPanel(null);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [panel]);

  if (tasks.length === 0 && events.length === 0) return null;

  const confirm = async () => {
    let target = boardId;
    if (!target || target === NEW_BOARD) {
      const folder = cwd?.split(/[\\/]/).filter(Boolean).at(-1);
      target = await createBoard({ name: folder ? `Tâches · ${folder}` : "Boîte de réception", projectRoot: cwd });
    }
    await addTasks(target, tasks.map((task) => ({ title: task.title, due: task.due })));
    setAdded(true);
    setPanel(null);
  };

  return (
    <div ref={container} className="relative flex flex-wrap items-center gap-2">
      {tasks.length > 0 && (
        <Button size="sm" variant="secondary" disabled={added} onClick={() => setPanel(panel === "tasks" ? null : "tasks")}>
          {added ? <Check size={13} strokeWidth={2} /> : <KanbanSquare size={13} strokeWidth={1.75} />}
          {added
            ? `${tasks.length} tâche(s) ajoutée(s)`
            : `Ajouter ${tasks.length} tâche${tasks.length > 1 ? "s" : ""} au Planner`}
        </Button>
      )}
      {events.length > 0 && (
        <Button size="sm" variant="secondary" onClick={() => setPanel(panel === "events" ? null : "events")}>
          <CalendarPlus size={13} strokeWidth={1.75} />
          Ajouter à l'agenda ({events.length})
        </Button>
      )}

      <AnimatePresence>
        {panel && (
          <motion.div
            variants={popIn}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="glass absolute left-0 top-full z-40 mt-2 w-80 space-y-3 rounded-lg p-3"
          >
            {panel === "tasks" ? (
              <>
                <p className="text-footnote font-medium">Ajouter au tableau</p>
                <Select
                  label="Tableau"
                  value={boardId || NEW_BOARD}
                  onChange={setBoardId}
                  className="w-full"
                  options={[
                    ...boards.map((b) => ({
                      value: b.id,
                      label: b.name,
                      hint: b.roadmapPath ? "roadmap" : undefined,
                    })),
                    { value: NEW_BOARD, label: "Nouveau tableau" },
                  ]}
                />
                <ul className="max-h-40 space-y-1 overflow-y-auto">
                  {tasks.map((task) => (
                    <li key={task.title} className="flex items-center justify-between gap-2 text-footnote text-text-muted">
                      <span className="truncate">{task.title}</span>
                      {task.due && <span className="shrink-0 text-text-subtle">{formatDue(task.due)}</span>}
                    </li>
                  ))}
                </ul>
                <Button size="sm" variant="primary" className="w-full" onClick={() => void confirm()}>
                  Ajouter
                </Button>
              </>
            ) : (
              <>
                <p className="text-footnote font-medium">Dates détectées</p>
                <ul className="space-y-1">
                  {events.map((event) => (
                    <li key={`${event.date}${event.title}`}>
                      <button
                        onClick={() => void openUrl(googleCalendarUrl({ title: event.title, date: event.date }))}
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-footnote hover:bg-surface-2"
                      >
                        <CalendarPlus size={12} strokeWidth={1.75} className="shrink-0 text-accent" />
                        <span className="shrink-0 font-medium">{formatDue(event.date)}</span>
                        <span className="truncate text-text-muted">{event.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="text-caption text-text-subtle">Ouvre Google Agenda avec l'événement pré-rempli.</p>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
