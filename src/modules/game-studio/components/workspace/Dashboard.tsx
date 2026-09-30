import { AlertTriangle, ArrowRight, CheckCircle2, CircleDot } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Button } from "@/design-system/primitives";
import type { GameSystemStatus } from "@/core/ipc/bindings/GameSystemStatus";
import { ago, ENGINE_LABEL, PLATFORM_LABEL, shortVersion, ROLE, SYSTEM_STATUS, TOPOLOGY, WORLD_KIND } from "../../lib/labels";
import { readyTasks } from "../../lib/tasks";
import { useGameStudioStore } from "../../store";
import { focusRing } from "../ui";

const BAR: Record<GameSystemStatus, string> = {
  planned: "bg-surface-3",
  inProgress: "bg-info",
  implemented: "bg-accent",
  validated: "bg-success",
  broken: "bg-danger",
  deprecated: "bg-border-strong",
};

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5 py-2.5">
      <p className="text-caption font-medium text-text-subtle">{label}</p>
      <div className="text-body-sm">{children}</div>
    </div>
  );
}

/** Tableau de bord : la prochaine étape d'abord, puis l'état du projet. */
export function Dashboard() {
  const current = useGameStudioStore((s) => s.current);
  const go = useGameStudioStore((s) => s.go);
  if (!current) return null;
  const { project, graph, install } = current;
  const ready = readyTasks(graph.tasks).slice(0, 3);
  const changes = [...graph.changes].reverse().slice(0, 5);
  const issues = graph.issues.filter((i) => i.open);
  const editable = graph.assumptions.filter((a) => a.status === "editable").length;
  const counts = graph.systems.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.status]: (acc[s.status] ?? 0) + 1 }), {});
  const total = graph.systems.length || 1;

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-8">
        <section aria-label="Prochaine étape" className="space-y-2">
          <div className="flex items-end justify-between gap-2">
            <h3 className="text-title-3 font-semibold">Prochaine étape</h3>
            <Button size="sm" variant="ghost" icon={<ArrowRight size={13} />} onClick={() => go("tasks")}>
              Toutes les tâches
            </Button>
          </div>
          {ready.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface-1 px-4 py-3 text-body-sm text-text-muted">
              {graph.tasks.length === 0 ? "Aucune tâche : ajoutez-en une, ou demandez un plan à l'assistant." : "Aucune tâche prête : les tâches restantes attendent d'autres tâches ou sont terminées."}
            </p>
          ) : (
            <ol className="divide-y divide-border rounded-lg border border-border bg-surface-1">
              {ready.map((task, index) => (
                <li key={task.id} className="flex gap-3 px-4 py-3">
                  <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-caption", index === 0 ? "bg-accent text-accent-fg" : "bg-surface-2 text-text-muted")}>
                    {index + 1}
                  </span>
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-body-sm font-medium">{task.title}</p>
                    <p className="text-footnote text-text-muted">
                      {ROLE[task.role].label}
                      {task.validation ? ` · Vérification : ${task.validation}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        {issues.length > 0 && (
          <section aria-label="Problèmes ouverts" className="space-y-2">
            <h3 className="flex items-center gap-2 text-title-3 font-semibold">
              <AlertTriangle size={16} className="text-warning" aria-hidden /> Problèmes ouverts ({issues.length})
            </h3>
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface-1">
              {issues.slice(0, 5).map((issue) => (
                <li key={issue.id} className="px-4 py-2.5">
                  <p className="text-body-sm">{issue.title}</p>
                  {issue.detail && <p className="text-footnote text-text-muted">{issue.detail}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-label="Dernières modifications" className="space-y-2">
          <div className="flex items-end justify-between gap-2">
            <h3 className="text-title-3 font-semibold">Dernières modifications</h3>
            <Button size="sm" variant="ghost" icon={<ArrowRight size={13} />} onClick={() => go("history")}>
              Historique
            </Button>
          </div>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface-1">
            {changes.map((change) => (
              <li key={change.id} className="px-4 py-2.5">
                <p className="text-body-sm">
                  {change.title} <span className="text-caption text-text-subtle">· {change.by} · {ago(change.at)}</span>
                </p>
                <p className="text-footnote text-text-muted">{change.what}</p>
              </li>
            ))}
            {changes.length === 0 && <li className="px-4 py-3 text-footnote text-text-subtle">Rien encore.</li>}
          </ul>
        </section>
      </div>

      <aside aria-label="État du projet" className="divide-y divide-border rounded-lg border border-border bg-surface-1 px-4">
        <Fact label="Moteur">
          {project.engine ? (
            <>
              {ENGINE_LABEL[project.engine]} {shortVersion(project.engineVersion)}
              <span className={cn("block text-footnote", install ? "text-success" : "text-warning")}>
                {install ? `Installé${install.version ? ` (${shortVersion(install.version)})` : ""}` : "Pas installé sur cette machine"}
              </span>
            </>
          ) : (
            <button type="button" onClick={() => go("settings")} className={cn("cursor-pointer text-accent hover:underline", focusRing)}>
              Choisir le moteur
            </button>
          )}
        </Fact>
        <Fact label="Systèmes">
          <p className="tabular-nums">{graph.systems.length} au total</p>
          <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            {(Object.keys(SYSTEM_STATUS) as GameSystemStatus[]).map((status) =>
              counts[status] ? <span key={status} className={BAR[status]} style={{ width: `${(counts[status]! / total) * 100}%` }} /> : null,
            )}
          </div>
          <ul className="mt-1.5 space-y-0.5">
            {(Object.keys(SYSTEM_STATUS) as GameSystemStatus[])
              .filter((status) => counts[status])
              .map((status) => (
                <li key={status} className="flex items-center justify-between text-footnote text-text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <span className={cn("size-2 rounded-full", BAR[status])} aria-hidden />
                    {SYSTEM_STATUS[status].label}
                  </span>
                  <span className="tabular-nums">{counts[status]}</span>
                </li>
              ))}
          </ul>
        </Fact>
        {graph.world && (
          <Fact label="Monde">
            {WORLD_KIND[graph.world.kind]}
            {graph.world.traits.length > 0 && <span className="block text-footnote text-text-muted">{graph.world.traits.map((t) => WORLD_KIND[t]).join(" · ")}</span>}
          </Fact>
        )}
        {graph.network && (
          <Fact label="Réseau">
            {TOPOLOGY[graph.network.topology]}
            {graph.network.topology !== "none" && graph.network.maxPlayers ? <span className="block text-footnote text-text-muted">{graph.network.maxPlayers} joueurs</span> : null}
          </Fact>
        )}
        <Fact label="Plateformes">{project.targets.map((t) => PLATFORM_LABEL[t]).join(", ") || "Aucune"}</Fact>
        <Fact label="Hypothèses">
          {editable > 0 ? (
            <button type="button" onClick={() => go("design")} className={cn("inline-flex cursor-pointer items-center gap-1.5 text-left hover:underline", focusRing)}>
              <CircleDot size={13} className="text-accent" aria-hidden /> {editable} à confirmer
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-text-muted">
              <CheckCircle2 size={13} className="text-success" aria-hidden /> Toutes confirmées
            </span>
          )}
        </Fact>
      </aside>
    </div>
  );
}
