import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Eraser, ExternalLink, Gamepad2, Hammer, Loader2, Server, Square, WifiOff } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cn } from "@/core/lib/cn";
import { Button } from "@/design-system/primitives";
import type { BuildRecord } from "@/core/ipc/bindings/BuildRecord";
import type { BuildTask } from "@/core/ipc/bindings/BuildTask";
import type { JavaStatus } from "@/core/ipc/bindings/JavaStatus";
import type { LogLevel } from "@/core/ipc/bindings/LogLevel";
import type { ProjectSummary } from "@/core/ipc/bindings/ProjectSummary";
import { errorText, mcstudioApi } from "../../api";
import { ago, seconds } from "../../lib/format";
import { levelOf, visibleAt, type LevelFilter } from "../../lib/logs";
import { useMcStudioStore, type LogLine } from "../../store";
import { focusRing, Switch } from "../ui";
import { JdkInstallCard } from "../JdkInstallCard";
import { BuildResult } from "./BuildResult";

const FILTERS: { id: LevelFilter; label: string }[] = [
  { id: "all", label: "Tout" },
  { id: "error", label: "Erreurs" },
  { id: "warning", label: "Avertissements" },
  { id: "info", label: "Infos" },
  { id: "debug", label: "Debug" },
];

const LINE_TONE: Record<LogLevel, string> = {
  error: "text-danger",
  warning: "text-warning",
  info: "text-text-muted",
  debug: "text-text-subtle",
};

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <span className="tabular-nums">{seconds(now - since)}</span>;
}

function LogView({ lines, dropped }: { lines: LogLine[]; dropped: number }) {
  const [filter, setFilter] = useState<LevelFilter>("all");
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const shown = useMemo(() => lines.filter((line) => visibleAt(line.level, filter)), [lines, filter]);

  // Suit la fin du journal, sauf si la personne remonte pour lire.
  useLayoutEffect(() => {
    const el = box.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [shown]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-bg">
      <div role="radiogroup" aria-label="Niveau du journal" className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        {FILTERS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={filter === id}
            onClick={() => setFilter(id)}
            className={cn(
              "h-7 rounded-sm px-2 text-footnote transition-colors",
              filter === id ? "bg-surface-2 text-text" : "text-text-subtle hover:text-text",
              focusRing,
            )}
          >
            {label}
          </button>
        ))}
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
        className="selectable min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-footnote leading-5"
        aria-live="off"
      >
        {shown.length === 0 ? (
          <p className="text-text-subtle">{lines.length === 0 ? "Le journal de Gradle s'affichera ici." : "Aucune ligne à ce niveau."}</p>
        ) : (
          shown.map((line) => (
            <div key={line.id} className={cn("whitespace-pre-wrap break-all", LINE_TONE[line.level])}>
              {line.text || " "}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function History({
  projectId,
  refreshKey,
  onOpen,
}: {
  projectId: string;
  refreshKey: string | undefined;
  onOpen: (record: BuildRecord) => void;
}) {
  const [records, setRecords] = useState<BuildRecord[]>([]);
  useEffect(() => {
    mcstudioApi
      .listBuilds(projectId)
      .then((list) => setRecords(list.slice().reverse()))
      .catch(() => setRecords([]));
  }, [projectId, refreshKey]);
  if (records.length === 0) return null;
  return (
    <section aria-labelledby="mc-history" className="space-y-2">
      <h3 id="mc-history" className="text-footnote font-medium text-text-muted">
        Compilations précédentes
      </h3>
      <ul className="divide-y divide-border rounded-md border border-border">
        {records.slice(0, 10).map((record) => (
          <li key={record.id}>
            <button
              type="button"
              onClick={() => onOpen(record)}
              className={cn("flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2", focusRing)}
            >
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  record.status === "success" ? "bg-success" : record.status === "failed" ? "bg-danger" : "bg-text-subtle",
                )}
                aria-hidden
              />
              <span className="flex-1 truncate text-footnote">{record.summary}</span>
              <span className="shrink-0 text-caption text-text-subtle">{ago(record.startedAt)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function BuildPanel({
  project,
  java,
  onJavaChange,
}: {
  project: ProjectSummary;
  java: JavaStatus | null;
  onJavaChange: (status: JavaStatus) => void;
}) {
  const session = useMcStudioStore((s) => s.builds[project.id]);
  const { startBuild, cancelBuild } = useMcStudioStore.getState();
  const [offline, setOffline] = useState(false);
  const [archived, setArchived] = useState<{ record: BuildRecord; lines: LogLine[] } | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const running = session?.running ?? false;
  const record = archived?.record ?? session?.record ?? project.lastBuild;

  const openArchived = async (past: BuildRecord) => {
    try {
      const text = await mcstudioApi.readBuildLog(project.id, past.id);
      const lines = text.split("\n").map((raw, index) => ({ id: -1 - index, level: levelOf(raw), text: raw }));
      setArchived({ record: past, lines });
      setArchiveError(null);
    } catch (e) {
      setArchiveError(errorText(e));
    }
  };

  const run = (task: BuildTask) => {
    setArchived(null);
    void startBuild(project.id, task, offline);
  };

  // Serveur de test : le CLUF de Minecraft s'accepte une fois, par la personne.
  const [askEula, setAskEula] = useState(false);
  const [eulaError, setEulaError] = useState<string | null>(null);
  const startServer = async () => {
    setEulaError(null);
    try {
      if (await mcstudioApi.serverEula(project.id)) run("runServer");
      else setAskEula(true);
    } catch (e) {
      setEulaError(errorText(e));
    }
  };
  const acceptAndStart = async () => {
    try {
      await mcstudioApi.acceptServerEula(project.id);
      setAskEula(false);
      run("runServer");
    } catch (e) {
      setEulaError(errorText(e));
    }
  };
  const serverReady =
    session?.running && session.task === "runServer" && session.lines.some((line) => /Done \(\d/.test(line.text));

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto px-6 py-5">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {running ? (
          <Button onClick={() => void cancelBuild(project.id)} icon={<Square size={12} fill="currentColor" />}>
            {session?.task === "runClient" ? "Arrêter le jeu" : session?.task === "runServer" ? "Arrêter le serveur" : "Arrêter"}
          </Button>
        ) : (
          <Button variant="primary" disabled={!java?.install} onClick={() => run("build")} icon={<Hammer size={14} strokeWidth={1.75} />}>
            Compiler le mod
          </Button>
        )}
        <Button
          disabled={running || !java?.install}
          onClick={() => run("runClient")}
          icon={<Gamepad2 size={14} strokeWidth={1.75} />}
          title="Lance Minecraft avec le mod (la première fois, le jeu télécharge ses ressources : quelques minutes). Fermez le jeu pour terminer."
        >
          Tester en jeu
        </Button>
        <Button
          disabled={running || !java?.install}
          onClick={() => void startServer()}
          icon={<Server size={14} strokeWidth={1.75} />}
          title="Lance un serveur dédié avec le mod : vérifie qu'il démarre sans code réservé au client (erreur fréquente)."
        >
          Serveur de test
        </Button>
        <Button variant="ghost" disabled={running || !java?.install} onClick={() => run("clean")} icon={<Eraser size={14} />}>
          Nettoyer
        </Button>
        <Switch checked={offline} onChange={setOffline} disabled={running} className="ml-2">
          <WifiOff size={12} /> Hors ligne (cache uniquement)
        </Switch>
      </div>

      {askEula && (
        <div role="group" aria-label="Accepter le CLUF de Minecraft" className="shrink-0 space-y-2 rounded-md border border-border bg-surface-1 px-4 py-3">
          <p className="text-body-sm font-medium">Accepter le CLUF de Minecraft ?</p>
          <p className="text-footnote text-text-muted">
            Un serveur Minecraft ne démarre qu'après l'acceptation du contrat de licence de Mojang. Mod Studio l'inscrit
            dans <span className="font-mono">run/eula.txt</span>, et règle le serveur de test hors ligne
            (<span className="font-mono">online-mode=false</span>) s'il n'a pas encore de réglages.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              icon={<ExternalLink size={13} />}
              onClick={() => void openUrl("https://aka.ms/MinecraftEULA").catch(() => undefined)}
            >
              Lire le CLUF
            </Button>
            <span className="ml-auto flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setAskEula(false)}>
                Annuler
              </Button>
              <Button size="sm" variant="primary" onClick={() => void acceptAndStart()}>
                J'accepte, lancer le serveur
              </Button>
            </span>
          </div>
        </div>
      )}
      {eulaError && <p className="shrink-0 text-footnote text-danger">{eulaError}</p>}
      {serverReady && (
        <p role="status" className="shrink-0 text-footnote text-success">
          Serveur démarré : le mod se charge sur un serveur dédié. Arrêtez-le pour terminer le test.
        </p>
      )}

      {java && !java.install && (
        <div role="alert" className="shrink-0 space-y-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-3">
          <p className="text-footnote text-text-muted">{java.problem}</p>
          <JdkInstallCard
            major={java.min}
            exact={java.max === java.min}
            onInstalled={() => void mcstudioApi.projectJava(project.id).then(onJavaChange).catch(() => undefined)}
          />
        </div>
      )}

      {running && session && (
        <div aria-live="polite" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-footnote text-text-muted">
          <Loader2 size={14} className="animate-spin text-info" />
          <span className="font-mono text-text">{session.currentTask ?? "Démarrage de Gradle…"}</span>
          <Elapsed since={session.startedAt} />
          {session.command && <span className="font-mono text-text-subtle">{session.command}</span>}
          {session.javaVersion && <span className="text-text-subtle">Java {session.javaVersion}</span>}
        </div>
      )}

      {!running && record && (
        <div className="shrink-0">
          <BuildResult record={record} />
        </div>
      )}
      {archiveError && <p className="text-footnote text-danger">{archiveError}</p>}
      {archived && (
        <p className="text-footnote text-text-subtle">
          Journal d'une compilation passée ({ago(archived.record.startedAt)}).{" "}
          <button type="button" className={cn("rounded-sm underline underline-offset-2 hover:text-text", focusRing)} onClick={() => setArchived(null)}>
            Revenir à la dernière
          </button>
        </p>
      )}

      <div className="flex min-h-[320px] flex-1 flex-col">
        <LogView lines={archived?.lines ?? session?.lines ?? []} dropped={archived ? 0 : (session?.dropped ?? 0)} />
      </div>

      <History projectId={project.id} refreshKey={session?.record?.id} onOpen={(r) => void openArchived(r)} />
    </div>
  );
}
