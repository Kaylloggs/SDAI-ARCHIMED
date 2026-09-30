import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ExternalLink, FileText, FlaskConical, FolderOpen, Hammer, Info, Loader2, Package, Play, ShieldCheck, Square, Wrench, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { cn } from "@/core/lib/cn";
import { Button, EmptyState, Select } from "@/design-system/primitives";
import type { GameAction } from "@/core/ipc/bindings/GameAction";
import type { GameBuildRecord } from "@/core/ipc/bindings/GameBuildRecord";
import type { GameDiagnostic } from "@/core/ipc/bindings/GameDiagnostic";
import type { GameLogLevel } from "@/core/ipc/bindings/GameLogLevel";
import type { GamePlatform } from "@/core/ipc/bindings/GamePlatform";
import type { GameProjectState } from "@/core/ipc/bindings/GameProjectState";
import { errorText, gameStudioApi } from "../../api";
import { availability } from "../../lib/actions";
import { fixRequest, MAX_FIX_ROUNDS } from "../../lib/assistant";
import { ACTION, ago, duration, ENGINE_LABEL, PLATFORM_LABEL, PLATFORMS, RUN_STATUS, SEVERITY } from "../../lib/labels";
import { useGameStudioStore, type JobSession, type LogLine } from "../../store";
import { ErrorLine, focusRing, Segmented, ToneBadge } from "../ui";

const ICON: Record<GameAction, LucideIcon> = {
  setup: Hammer,
  check: ShieldCheck,
  test: FlaskConical,
  run: Play,
  build: Package,
  editor: ExternalLink,
};

const LINE_TONE: Record<GameLogLevel, string> = {
  error: "text-danger",
  warning: "text-warning",
  info: "text-text-muted",
};

type Filter = "all" | "error" | "warning";

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <span className="tabular-nums">{duration(now - since)}</span>;
}

/** Sortie d'un outil : suit la fin, sauf quand la personne remonte pour lire. */
function LogView({ lines, dropped, empty }: { lines: LogLine[]; dropped: number; empty: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const shown = useMemo(() => (filter === "all" ? lines : lines.filter((l) => l.level === filter)), [lines, filter]);

  useLayoutEffect(() => {
    const el = box.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [shown]);

  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-border bg-bg">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
        <Segmented
          size="sm"
          label="Lignes affichées"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "Tout" },
            { value: "error", label: "Erreurs" },
            { value: "warning", label: "Avertissements" },
          ]}
        />
        <span className="ml-auto pr-1 text-caption text-text-subtle tabular-nums">
          {shown.length} lignes{dropped > 0 && ` · ${dropped} plus anciennes dans le journal complet`}
        </span>
      </div>
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="h-[min(420px,50vh)] overflow-auto px-3 py-2 font-mono text-caption leading-relaxed"
        role="log"
        aria-live="off"
      >
        {shown.length === 0 ? (
          <p className="text-text-subtle">{empty}</p>
        ) : (
          shown.map((line) => (
            <div key={line.id} className={cn("whitespace-pre-wrap break-words", LINE_TONE[line.level])}>
              {line.text || " "}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function DiagnosticItem({ d }: { d: GameDiagnostic }) {
  const go = useGameStudioStore((s) => s.go);
  const select = useGameStudioStore((s) => s.selectSystem);
  const systems = useGameStudioStore((s) => s.current?.graph.systems ?? []);
  const Icon = d.severity === "error" ? XCircle : d.severity === "warning" ? AlertTriangle : Info;
  const where = d.file ? `${d.file}${d.line ? `:${d.line}${d.column ? `:${d.column}` : ""}` : ""}` : null;
  return (
    <li className="flex gap-3 px-4 py-3">
      <Icon size={15} aria-label={SEVERITY[d.severity].label} className={cn("mt-0.5 shrink-0", d.severity === "error" ? "text-danger" : d.severity === "warning" ? "text-warning" : "text-text-subtle")} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="break-words text-body-sm">{d.message}</p>
        <p className="flex flex-wrap items-center gap-x-2 text-caption text-text-subtle">
          {where && <span className="font-mono text-text-muted">{where}</span>}
          <span>
            {d.source}
            {d.code && d.code !== "parse" ? ` · ${d.code}` : ""}
          </span>
        </p>
        {d.likelyCause && <p className="text-footnote text-text-muted">Cause probable : {d.likelyCause}</p>}
        {d.suggestion && <p className="text-footnote text-text">Piste : {d.suggestion}</p>}
        {d.systems.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {d.systems.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  select(id);
                  go("systems");
                }}
                className={cn("cursor-pointer rounded-xs bg-surface-2 px-1.5 py-0.5 text-caption text-text-muted hover:text-text", focusRing)}
              >
                {systems.find((s) => s.id === id)?.name ?? id}
              </button>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

/** Confie l'échec à l'agent de débogage (message préparé, relu avant envoi), dans la limite des essais. */
function FixButton({ record, projectId }: { record: GameBuildRecord; projectId: string }) {
  const rounds = useGameStudioStore((s) => s.fixRounds[projectId] ?? 0);
  if (rounds >= MAX_FIX_ROUNDS) {
    return <p className="text-footnote text-text-muted">{MAX_FIX_ROUNDS} corrections d'affilée sans succès : relisez l'erreur, ou reformulez la demande.</p>;
  }
  return (
    <Button
      size="sm"
      variant="primary"
      icon={<Wrench size={13} />}
      onClick={() => useGameStudioStore.getState().openAssistant({ role: "debug", taskId: null, text: fixRequest(record), fix: true })}
    >
      Corriger avec l'agent ({rounds + 1}/{MAX_FIX_ROUNDS})
    </Button>
  );
}

/** Résultat d'une exécution : verdict, erreurs expliquées, build produit, journal complet. */
function RunResult({ record, projectId }: { record: GameBuildRecord; projectId: string }) {
  const [log, setLog] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errors = record.diagnostics.filter((d) => d.severity === "error");
  const others = record.diagnostics.filter((d) => d.severity !== "error");
  const lines = useMemo<LogLine[]>(
    () => (log ?? "").split("\n").map((text, id) => ({ id, text, level: /error|erreur/i.test(text) ? "error" : /warning/i.test(text) ? "warning" : "info" })),
    [log],
  );

  useEffect(() => {
    setLog(null);
    setError(null);
  }, [record.id]);

  return (
    <section aria-label="Résultat" className="space-y-3">
      <div className="space-y-2 rounded-lg border border-border bg-surface-1 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <ToneBadge tone={RUN_STATUS[record.status].tone}>{RUN_STATUS[record.status].label}</ToneBadge>
          <span className="text-body-sm font-medium">
            {ACTION[record.action].label}
            {record.platform ? ` · ${PLATFORM_LABEL[record.platform]}${record.development ? " (développement)" : ""}` : ""}
          </span>
          <span className="text-caption text-text-subtle">
            {ago(record.startedAt)}
            {record.durationMs > 0 && ` · ${duration(record.durationMs)}`}
          </span>
        </div>
        <p className="break-words text-body-sm">{record.summary}</p>
        {record.command && <p className="truncate font-mono text-caption text-text-subtle" title={record.command}>{record.command}</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          {record.status === "failed" && record.id && <FixButton record={record} projectId={projectId} />}
          {record.output && (
            <Button size="sm" variant="secondary" icon={<FolderOpen size={13} />} onClick={() => void revealItemInDir(record.output!).catch((e) => setError(errorText(e)))}>
              Montrer le build
            </Button>
          )}
          {record.id && record.logLines > 0 && log === null && (
            <Button
              size="sm"
              variant="ghost"
              icon={<FileText size={13} />}
              onClick={() =>
                void gameStudioApi
                  .runLog(projectId, record.id)
                  .then(setLog)
                  .catch((e) => setError(errorText(e)))
              }
            >
              Journal complet ({record.logLines} lignes)
            </Button>
          )}
        </div>
        <ErrorLine message={error} onClose={() => setError(null)} />
      </div>

      {errors.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-body font-semibold">Erreurs ({errors.length})</h3>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface-1">
            {errors.map((d, i) => (
              <DiagnosticItem key={i} d={d} />
            ))}
          </ul>
        </div>
      )}
      {others.length > 0 && (
        <details className="group">
          <summary className={cn("cursor-pointer text-body-sm text-text-muted hover:text-text", focusRing)}>Avertissements ({others.length})</summary>
          <ul className="mt-1.5 divide-y divide-border rounded-lg border border-border bg-surface-1">
            {others.map((d, i) => (
              <DiagnosticItem key={i} d={d} />
            ))}
          </ul>
        </details>
      )}
      {log !== null && <LogView lines={lines} dropped={0} empty="Journal vide." />}
    </section>
  );
}

function RunningPanel({ job, projectId }: { job: JobSession; projectId: string }) {
  const cancel = useGameStudioStore((s) => s.cancelAction);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setStopping(false), [job.jobId]);
  return (
    <section aria-label="Action en cours" className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-1 px-4 py-3">
        <Loader2 size={15} className="animate-spin text-info motion-reduce:animate-none" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-body-sm font-medium">
            {ACTION[job.action].label} en cours · <Elapsed since={job.startedAt} />
          </p>
          {job.command && <p className="truncate font-mono text-caption text-text-subtle" title={job.command}>{job.command}</p>}
        </div>
        <Button
          size="sm"
          variant="secondary"
          icon={<Square size={12} />}
          disabled={stopping}
          onClick={async () => {
            setStopping(true);
            const failure = await cancel(projectId);
            if (failure) {
              setError(failure);
              setStopping(false);
            }
          }}
        >
          {stopping ? "Arrêt…" : job.action === "run" ? "Arrêter le jeu" : "Arrêter"}
        </Button>
      </div>
      {job.quietFor !== null && (
        <p className="rounded-md bg-warning-soft px-3 py-2 text-footnote">
          Rien d'écrit depuis {Math.round(job.quietFor / 60)} min. L'outil travaille peut-être encore (import, compilation des shaders) ; vous pouvez aussi l'arrêter.
        </p>
      )}
      <ErrorLine message={error} onClose={() => setError(null)} />
      <LogView
        lines={job.lines}
        dropped={job.dropped}
        empty={job.attached ? "Action lancée avant l'ouverture de cette page : sa sortie sera dans le journal complet à la fin." : "En attente de la première ligne…"}
      />
    </section>
  );
}

/** Bouton d'action du moteur ; indisponible, il dit pourquoi au lieu de rester muet. */
function ActionButton({ action, state, busy, onRun, primary }: { action: GameAction; state: GameProjectState; busy: boolean; onRun: (action: GameAction) => void; primary?: boolean }) {
  const { available, reason } = availability(state, action);
  const Icon = ICON[action];
  return (
    <Button
      variant={primary ? "primary" : "secondary"}
      icon={<Icon size={14} />}
      disabled={!available || busy}
      aria-describedby={reason ? `why-${action}` : undefined}
      onClick={() => onRun(action)}
      className="whitespace-nowrap"
    >
      {ACTION[action].verb}
    </Button>
  );
}

/** Raisons des actions indisponibles d'une rangée, sous la rangée. */
function Reasons({ actions, state }: { actions: GameAction[]; state: GameProjectState }) {
  const missing = actions.map((action) => ({ action, reason: availability(state, action).reason })).filter((r) => r.reason);
  if (missing.length === 0) return null;
  return (
    <ul className="space-y-0.5">
      {missing.map(({ action, reason }) => (
        <li key={action} id={`why-${action}`} className="text-caption text-text-subtle">
          <span className="font-medium text-text-muted">{ACTION[action].verb}</span> : {reason}
        </li>
      ))}
    </ul>
  );
}

/** Build et tests : les actions réelles du moteur, leur sortie en direct et leurs erreurs expliquées. */
export function BuildSection() {
  const current = useGameStudioStore((s) => s.current);
  const jobs = useGameStudioStore((s) => s.jobs);
  const allRuns = useGameStudioStore((s) => s.runs);
  const runAction = useGameStudioStore((s) => s.runAction);
  const loadRuns = useGameStudioStore((s) => s.loadRuns);
  const attachRunning = useGameStudioStore((s) => s.attachRunning);
  const go = useGameStudioStore((s) => s.go);
  const [platform, setPlatform] = useState<GamePlatform | null>(null);
  const [development, setDevelopment] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const projectId = current?.project.id ?? "";

  useEffect(() => {
    if (!projectId) return;
    void loadRuns(projectId);
    void attachRunning(projectId);
  }, [projectId, loadRuns, attachRunning]);

  if (!current) return null;
  const { project } = current;
  const job = jobs[projectId];
  const runs = allRuns[projectId] ?? [];
  const running = job?.running ?? false;
  const target = platform ?? project.targets[0] ?? "windows";
  const selected = runs.find((r) => r.id === shown) ?? (job && !job.running ? job.record : null) ?? runs[0] ?? null;

  if (!project.engine) {
    return (
      <EmptyState
        icon={<Hammer size={28} />}
        title="Pas encore de moteur"
        description="Vérifier, tester, lancer et exporter passent par le moteur du jeu. Choisissez-en un : la conception est gardée."
        action={<Button onClick={() => go("settings")}>Choisir le moteur</Button>}
      />
    );
  }

  const start = (action: GameAction) => {
    setShown(null);
    void runAction(projectId, action, action === "build" ? target : null, development);
  };

  const editor = availability(current, "editor");
  const platforms = (project.targets.length ? project.targets : PLATFORMS).filter((p) => p !== "console");

  return (
    <div className="space-y-8">
      <section aria-label="Actions du moteur" className="space-y-4 rounded-lg border border-border bg-surface-1 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <ActionButton action="check" state={current} busy={running} onRun={start} primary />
          <ActionButton action="test" state={current} busy={running} onRun={start} />
          <ActionButton action="run" state={current} busy={running} onRun={start} />
          <ActionButton action="setup" state={current} busy={running} onRun={start} />
          <div>
            <Button
              variant="ghost"
              icon={<ExternalLink size={14} />}
              disabled={!editor.available}
              onClick={() =>
                void gameStudioApi
                  .openEditor(projectId)
                  .then(() => setError(null))
                  .catch((e) => setError(errorText(e)))
              }
              className="whitespace-nowrap"
            >
              Ouvrir {ENGINE_LABEL[project.engine]}
            </Button>
          </div>
        </div>
        <Reasons actions={["check", "test", "run", "setup"]} state={current} />
        <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
          <div className="space-y-1">
            <p className="text-caption font-medium text-text-subtle">Plateforme</p>
            <Select
              label="Plateforme du build"
              value={target}
              onChange={(v) => setPlatform(v as GamePlatform)}
              options={platforms.map((p) => ({ value: p, label: PLATFORM_LABEL[p] }))}
              className="w-44"
            />
          </div>
          <div className="space-y-1">
            <p className="text-caption font-medium text-text-subtle">Version</p>
            <Segmented
              label="Version du build"
              value={development ? "dev" : "release"}
              onChange={(v) => setDevelopment(v === "dev")}
              options={[
                { value: "release", label: "Publication", hint: "Optimisé, sans outils de débogage." },
                { value: "dev", label: "Développement", hint: "Avec les outils de débogage du moteur." },
              ]}
            />
          </div>
          <ActionButton action="build" state={current} busy={running} onRun={start} />
        </div>
        <Reasons actions={["build"]} state={current} />
        <ErrorLine message={error} onClose={() => setError(null)} />
      </section>

      {job?.running && <RunningPanel job={job} projectId={projectId} />}
      {!running && selected && <RunResult record={selected} projectId={projectId} />}

      <section aria-label="Exécutions précédentes" className="space-y-2">
        <h3 className="text-title-3 font-semibold">Exécutions précédentes</h3>
        {runs.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface-1 px-4 py-3 text-body-sm text-text-muted">
            Aucune encore. Commencez par « Vérifier le code » : c'est rapide et cela confirme que le moteur ouvre le projet.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface-1">
            {runs.slice(0, 20).map((run) => (
              <li key={run.id}>
                <button
                  type="button"
                  onClick={() => setShown(run.id)}
                  aria-current={selected?.id === run.id ? "true" : undefined}
                  className={cn("flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-2", focusRing, selected?.id === run.id && "bg-surface-2")}
                >
                  <ToneBadge tone={RUN_STATUS[run.status].tone}>{RUN_STATUS[run.status].label}</ToneBadge>
                  <span className="w-24 shrink-0 text-body-sm">{ACTION[run.action].label}</span>
                  <span className="min-w-0 flex-1 truncate text-footnote text-text-muted">{run.summary}</span>
                  <span className="shrink-0 text-caption text-text-subtle">{ago(run.startedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
