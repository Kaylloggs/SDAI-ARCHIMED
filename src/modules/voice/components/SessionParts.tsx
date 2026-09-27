import { useEffect, useId, useState } from "react";
import { Check, Eye, Loader2, Square, X } from "lucide-react";
import { useSessionStore } from "@/core/engine/session.store";
import { cn } from "@/core/lib/cn";
import { useUiStore } from "@/core/stores/ui.store";
import { Button } from "@/design-system/primitives";
import { agentName } from "../lib/agents";
import { privacyRows } from "../lib/privacy";
import type { VoiceSettings } from "../lib/settings";
import { orchestrator } from "../runtime/instance";
import type { Confirmation, VoiceTask } from "../store";
import { LocationTag } from "./controls";

/** Ce qui sort de l'ordinateur à chaque étape, en une ligne. */
export function PrivacyStrip({ settings, agent }: { settings: VoiceSettings; agent: string }) {
  const rows = privacyRows(settings, agentName(agent));
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
      {rows.map((row) => (
        <div key={row.stage} className="flex min-w-0 items-center justify-between gap-2" title={row.detail}>
          <dt className="truncate text-footnote text-text-muted">{row.stage}</dt>
          <dd>
            <LocationTag location={row.location} compact />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Question fermée de l'assistant (action sensible, permission d'un agent). Réponse à la voix
 * ou aux boutons ; « Non » reçoit le focus : la réponse sans risque est la plus proche.
 */
export function ConfirmCard({ confirmation }: { confirmation: Confirmation }) {
  const titleId = useId();
  const answer = (value: "yes" | "always" | "no") => orchestrator().resolve(confirmation.id, value);
  return (
    <div role="alertdialog" aria-labelledby={titleId} className="space-y-2.5 rounded-md bg-warning-soft p-3">
      <p id={titleId} className="text-body-sm font-medium text-text">
        {confirmation.question}
      </p>
      <p className="text-footnote text-text-muted">
        Dites « oui »{confirmation.always ? ", « oui, toujours »" : ""} ou « non ». Sans réponse dans deux minutes, rien n'est fait.
      </p>
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="secondary" onClick={() => answer("no")} autoFocus>
          Non
        </Button>
        <span className="flex-1" />
        {confirmation.always && (
          <Button size="sm" variant="ghost" onClick={() => answer("always")} title="Accepter aussi les prochaines demandes du même type pendant cette session">
            Oui, toujours
          </Button>
        )}
        <Button size="sm" variant="primary" onClick={() => answer("yes")}>
          Oui
        </Button>
      </div>
    </div>
  );
}

function elapsed(from: number, to = Date.now()): string {
  const seconds = Math.max(0, Math.round((to - from) / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

const TASK_STATUS: Record<VoiceTask["status"], string> = {
  running: "En cours",
  done: "Terminée",
  failed: "Échec",
  stopped: "Arrêtée",
};

/** Tâches confiées aux agents pendant la session (conversations du module Chat). */
export function TaskList({ tasks, compact }: { tasks: VoiceTask[]; compact?: boolean }) {
  const [, setNow] = useState(0);
  const running = tasks.some((t) => t.status === "running");
  // Le temps écoulé avance chaque seconde tant qu'une tâche tourne.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const open = (task: VoiceTask) => {
    useSessionStore.getState().setActive(task.conversationId);
    useUiStore.getState().navigate("chat");
  };

  return (
    <ul className="space-y-1.5" aria-label="Tâches confiées">
      {tasks.map((task) => {
        const Icon = task.status === "running" ? Loader2 : task.status === "done" ? Check : task.status === "failed" ? X : Square;
        return (
          <li key={task.id} className="flex items-start gap-2 rounded-sm border border-border bg-surface-1 px-2.5 py-2">
            <Icon
              size={14}
              strokeWidth={1.75}
              aria-hidden
              className={cn(
                "mt-0.5 shrink-0",
                task.status === "running" && "animate-spin text-text-muted motion-reduce:animate-none",
                task.status === "done" && "text-success",
                task.status === "failed" && "text-danger",
                task.status === "stopped" && "text-text-subtle",
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-body-sm text-text">{task.title}</p>
              <p className={cn("text-footnote text-text-subtle", compact && "truncate")}>
                <span className="sr-only">{TASK_STATUS[task.status]} · </span>
                {agentName(task.agent)} · {elapsed(task.startedAt, task.endedAt)}
                {task.status === "running" && task.activity ? ` · ${task.activity}` : ""}
                {task.status !== "running" && task.summary ? ` · ${task.summary}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <Button size="sm" variant="ghost" onClick={() => open(task)} aria-label={`Voir « ${task.title} » dans le Chat`} className="px-1.5">
                <Eye size={13} strokeWidth={1.75} />
              </Button>
              {task.status === "running" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => orchestrator().stopTask(task.id)}
                  aria-label={`Arrêter « ${task.title} »`}
                  className="px-1.5"
                >
                  <Square size={12} strokeWidth={2} />
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
