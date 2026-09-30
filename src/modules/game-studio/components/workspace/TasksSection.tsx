import { useMemo, useState } from "react";
import { Bot, ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Badge, Button, Select } from "@/design-system/primitives";
import type { GameAgentRole } from "@/core/ipc/bindings/GameAgentRole";
import type { GameTask } from "@/core/ipc/bindings/GameTask";
import type { GameTaskStatus } from "@/core/ipc/bindings/GameTaskStatus";
import { ROLE, TASK_STATUS } from "../../lib/labels";
import { blankTask, readyTasks, waitingOn } from "../../lib/tasks";
import { errorText, gameStudioApi } from "../../api";
import { useGameStudioStore } from "../../store";
import { Chip, ConfirmButton, ErrorLine, focusRing, Segmented, TextArea, TextInput, ToneBadge } from "../ui";

type Filter = "all" | "ready" | "open" | "done";

function TaskForm({ task, onDone }: { task: GameTask; onDone: () => void }) {
  const graph = useGameStudioStore((s) => s.current?.graph);
  const apply = useGameStudioStore((s) => s.apply);
  const [draft, setDraft] = useState<GameTask>(task);
  const [error, setError] = useState<string | null>(null);
  if (!graph) return null;
  const others = graph.tasks.filter((t) => t.id !== task.id);
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const save = async () => {
    const message = await apply({ op: "upsertTask", task: draft });
    setError(message);
    if (!message) onDone();
  };

  return (
    <div className="space-y-3 rounded-lg border border-border-strong bg-surface-1 p-4">
      <ErrorLine message={error} onClose={() => setError(null)} />
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 md:col-span-2">
          <span className="text-footnote font-medium text-text-muted">Titre</span>
          <TextInput value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Ajouter la durabilité des armes" className="w-full" autoFocus />
        </label>
        <label className="space-y-1 md:col-span-2">
          <span className="text-footnote font-medium text-text-muted">Description</span>
          <TextArea rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </label>
        <div className="space-y-1">
          <span className="text-footnote font-medium text-text-muted">Spécialité</span>
          <Select label="Spécialité de l'agent" value={draft.role} onChange={(v) => setDraft({ ...draft, role: v as GameAgentRole })} options={(Object.keys(ROLE) as GameAgentRole[]).map((r) => ({ value: r, label: ROLE[r].label, hint: ROLE[r].hint }))} className="w-full" />
        </div>
        <div className="space-y-1">
          <span className="text-footnote font-medium text-text-muted">Phase</span>
          <Select
            label="Phase de la feuille de route"
            value={draft.phase ?? ""}
            onChange={(v) => setDraft({ ...draft, phase: v || null })}
            options={[{ value: "", label: "Aucune" }, ...graph.roadmap.map((p) => ({ value: p.id, label: p.title }))]}
            className="w-full"
          />
        </div>
        <label className="space-y-1">
          <span className="text-footnote font-medium text-text-muted">Résultat attendu</span>
          <TextInput value={draft.expected} onChange={(e) => setDraft({ ...draft, expected: e.target.value })} className="w-full" />
        </label>
        <label className="space-y-1">
          <span className="text-footnote font-medium text-text-muted">Comment vérifier</span>
          <TextInput value={draft.validation} onChange={(e) => setDraft({ ...draft, validation: e.target.value })} placeholder="Compilation au vert et test en jeu" className="w-full" />
        </label>
        {graph.systems.length > 0 && (
          <div className="space-y-1 md:col-span-2">
            <span className="text-footnote font-medium text-text-muted">Systèmes concernés</span>
            <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
              {graph.systems.map((s) => (
                <Chip key={s.id} selected={draft.systems.includes(s.id)} onClick={() => setDraft({ ...draft, systems: toggle(draft.systems, s.id) })}>
                  {s.name}
                </Chip>
              ))}
            </div>
          </div>
        )}
        {others.length > 0 && (
          <div className="space-y-1 md:col-span-2">
            <span className="text-footnote font-medium text-text-muted">Attend d'abord</span>
            <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
              {others.map((t) => (
                <Chip key={t.id} selected={draft.dependsOn.includes(t.id)} onClick={() => setDraft({ ...draft, dependsOn: toggle(draft.dependsOn, t.id) })}>
                  {t.title}
                </Chip>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Annuler
        </Button>
        <Button size="sm" variant="primary" disabled={!draft.title.trim()} onClick={() => void save()}>
          {task.id ? "Enregistrer" : "Ajouter la tâche"}
        </Button>
      </div>
    </div>
  );
}

function TaskRow({ task, ready }: { task: GameTask; ready: boolean }) {
  const graph = useGameStudioStore((s) => s.current?.graph);
  const apply = useGameStudioStore((s) => s.apply);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!graph) return null;
  if (editing) return <TaskForm task={task} onDone={() => setEditing(false)} />;
  const deps = graph.tasks.filter((t) => task.dependsOn.includes(t.id));
  const systems = graph.systems.filter((s) => task.systems.includes(s.id));
  const blockers = waitingOn(graph.tasks, task.id);

  return (
    <li className="border-b border-border last:border-b-0">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={cn("flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-left", focusRing)}>
          <ChevronDown size={14} className={cn("mt-1 shrink-0 text-text-subtle transition-transform duration-[140ms]", !open && "-rotate-90")} aria-hidden />
          <span className="min-w-0">
            <span className={cn("text-body-sm", task.status === "done" && "text-text-muted line-through")}>{task.title}</span>
            <span className="block text-footnote text-text-muted">
              {ROLE[task.role].label}
              {deps.length > 0 && ` · attend ${deps.length} tâche(s)`}
              {systems.length > 0 && ` · ${systems.map((s) => s.name).join(", ")}`}
            </span>
          </span>
        </button>
        {ready && <Badge tone="accent">Prête</Badge>}
        <Select
          label={`État de la tâche ${task.title}`}
          value={task.status}
          onChange={(status) => void apply({ op: "setTaskStatus", id: task.id, status: status as GameTaskStatus, result: null, conversationId: null }).then(setError)}
          options={(Object.keys(TASK_STATUS) as GameTaskStatus[]).map((s) => ({ value: s, label: TASK_STATUS[s].label }))}
          className="w-32"
        />
      </div>
      {error && (
        <div className="px-4 pb-2">
          <ErrorLine message={error} onClose={() => setError(null)} />
        </div>
      )}
      {open && (
        <div className="space-y-2 px-10 pb-3">
          {task.description && <p className="text-body-sm text-text-muted">{task.description}</p>}
          {task.expected && (
            <p className="text-footnote">
              <span className="text-text-subtle">Attendu : </span>
              {task.expected}
            </p>
          )}
          {task.validation && (
            <p className="text-footnote">
              <span className="text-text-subtle">Vérification : </span>
              {task.validation}
            </p>
          )}
          {deps.length > 0 && (
            <p className="text-footnote">
              <span className="text-text-subtle">Attend : </span>
              {deps.map((d) => `${d.title} (${TASK_STATUS[d.status].label.toLowerCase()})`).join(" · ")}
            </p>
          )}
          {task.result && (
            <p className="rounded-md bg-surface-2 px-3 py-2 text-footnote">
              <span className="text-text-subtle">Compte rendu : </span>
              {task.result}
            </p>
          )}
          <div className="flex flex-wrap gap-1">
            {!["done", "cancelled"].includes(task.status) && (
              <Button
                size="sm"
                variant="secondary"
                icon={<Bot size={13} />}
                onClick={() => {
                  const store = useGameStudioStore.getState();
                  if (!store.openId) return;
                  void gameStudioApi
                    .taskRequest(store.openId, task.id)
                    .then((text) => store.openAssistant({ role: task.role, taskId: task.id, text }))
                    .catch((e) => setError(errorText(e)));
                }}
              >
                Confier à l'agent {ROLE[task.role].label.toLowerCase()}
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => setEditing(true)}>
              Modifier
            </Button>
            <ConfirmButton
              label="Supprimer"
              confirmLabel={blockers.length ? "D'autres tâches l'attendent" : "Confirmer la suppression"}
              icon={<Trash2 size={13} />}
              disabled={blockers.length > 0}
              onConfirm={() => void apply({ op: "removeTask", id: task.id }).then(setError)}
            />
          </div>
        </div>
      )}
    </li>
  );
}

/** Plan de travail : tâches, ordre, spécialité de l'agent, vérification attendue. */
export function TasksSection() {
  const tasks = useGameStudioStore((s) => s.current?.graph.tasks ?? []);
  const [filter, setFilter] = useState<Filter>("open");
  const [creating, setCreating] = useState(false);
  const ready = useMemo(() => new Set(readyTasks(tasks).map((t) => t.id)), [tasks]);
  const shown = [...tasks]
    .sort((a, b) => a.order - b.order)
    .filter((t) => {
      switch (filter) {
        case "ready":
          return ready.has(t.id);
        case "open":
          return !["done", "cancelled"].includes(t.status);
        case "done":
          return t.status === "done";
        default:
          return true;
      }
    });
  const done = tasks.filter((t) => t.status === "done").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Filtrer les tâches"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "open", label: "À faire" },
            { value: "ready", label: `Prêtes (${ready.size})` },
            { value: "done", label: "Terminées" },
            { value: "all", label: "Toutes" },
          ]}
        />
        <span className="text-footnote tabular-nums text-text-muted">
          {done} sur {tasks.length} terminée(s)
        </span>
        <span className="ml-auto" />
        <Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={() => setCreating(true)}>
          Nouvelle tâche
        </Button>
      </div>
      {creating && <TaskForm task={blankTask(0)} onDone={() => setCreating(false)} />}
      {shown.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface-1 px-4 py-6 text-center text-body-sm text-text-muted">
          {tasks.length === 0 ? "Aucune tâche. Ajoutez-en, ou demandez un plan à l'assistant." : "Aucune tâche dans ce filtre."}
        </p>
      ) : (
        <ul className="rounded-lg border border-border bg-surface-1">
          {shown.map((task) => (
            <TaskRow key={task.id} task={task} ready={ready.has(task.id)} />
          ))}
        </ul>
      )}
      <p className="text-footnote text-text-subtle">
        <ToneBadge tone="accent">Prête</ToneBadge> : toutes les tâches qu'elle attend sont terminées.
      </p>
    </div>
  );
}
