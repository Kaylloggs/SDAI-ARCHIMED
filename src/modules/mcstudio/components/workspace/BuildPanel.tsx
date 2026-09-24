import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Eraser, ExternalLink, Gamepad2, Hammer, Loader2, Server, Square, TerminalSquare, WifiOff } from "lucide-react";
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
import { focusRing, Segmented, Switch } from "../ui";
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

function LogView({ lines, dropped, empty }: { lines: LogLine[]; dropped: number; empty: string }) {
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
          <p className="text-text-subtle">{lines.length === 0 ? empty : "Aucune ligne à ce niveau."}</p>
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

/** Console du serveur de test : une ligne = une commande, ↑ / ↓ pour les précédentes. */
function ServerConsole({ projectId, disabled }: { projectId: string; disabled: boolean }) {
  const [command, setCommand] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const past = useRef<string[]>([]);
  const cursor = useRef(-1);

  const send = async () => {
    const line = command.trim();
    if (!line || sending) return;
    setSending(true);
    setError(null);
    try {
      await useMcStudioStore.getState().sendServerCommand(projectId, line);
      past.current = [line, ...past.current.filter((p) => p !== line)].slice(0, 50);
      cursor.current = -1;
      setCommand("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSending(false);
    }
  };

  const browse = (step: number) => {
    const next = Math.min(past.current.length - 1, Math.max(-1, cursor.current + step));
    cursor.current = next;
    setCommand(next === -1 ? "" : (past.current[next] ?? ""));
  };

  return (
    <div className="shrink-0 space-y-1">
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label htmlFor="mc-server-command" className="sr-only">
          Commande du serveur
        </label>
        <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-bg px-3 focus-within:border-accent">
          <TerminalSquare size={14} className="shrink-0 text-text-subtle" aria-hidden />
          <input
            id="mc-server-command"
            value={command}
            disabled={disabled}
            spellCheck={false}
            autoComplete="off"
            placeholder="Commande du serveur : op Dev, time set day, gamemode creative @a…"
            onChange={(event) => {
              setCommand(event.target.value);
              cursor.current = -1;
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp") {
                event.preventDefault();
                browse(1);
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                browse(-1);
              }
            }}
            className="min-w-0 flex-1 bg-transparent font-mono text-footnote text-text outline-none placeholder:font-sans placeholder:text-text-subtle disabled:opacity-50"
          />
        </div>
        <Button type="submit" size="sm" disabled={disabled || sending || !command.trim()} icon={<CornerDownLeft size={13} />}>
          Envoyer
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-footnote text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

type View = "main" | "server";

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
  const server = useMcStudioStore((s) => s.servers[project.id]);
  const { startBuild, cancelBuild, stopServer } = useMcStudioStore.getState();
  const [offline, setOffline] = useState(false);
  const [archived, setArchived] = useState<{ record: BuildRecord; lines: LogLine[] } | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  // Deux journaux : compilation ou partie, et serveur de test qui tourne à côté.
  const [view, setView] = useState<View>(server?.running ? "server" : "main");
  const running = session?.running ?? false;
  const serving = server?.running ?? false;
  const shown = view === "server" && server ? server : session;
  const record = view === "server" ? server?.record : (archived?.record ?? session?.record ?? project.lastBuild);

  const openArchived = async (past: BuildRecord) => {
    try {
      const text = await mcstudioApi.readBuildLog(project.id, past.id);
      const lines = text.split("\n").map((raw, index) => ({ id: -1 - index, level: levelOf(raw), text: raw }));
      setArchived({ record: past, lines });
      setArchiveError(null);
      setView("main");
    } catch (e) {
      setArchiveError(errorText(e));
    }
  };

  const run = (task: BuildTask) => {
    setArchived(null);
    setView(task === "runServer" ? "server" : "main");
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
  const serverReady = serving && !server?.stopping && server?.lines.some((line) => /Done \(\d/.test(line.text));

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto px-6 py-5">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {running ? (
          <Button onClick={() => void cancelBuild(project.id)} icon={<Square size={12} fill="currentColor" />}>
            {session?.task === "runClient" ? "Arrêter le jeu" : "Arrêter"}
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
        {serving ? (
          <Button
            variant={server?.stopping ? "danger" : "secondary"}
            onClick={() => void stopServer(project.id, Boolean(server?.stopping))}
            icon={<Square size={12} fill="currentColor" />}
            title={
              server?.stopping
                ? "Le serveur enregistre le monde. Forcer l'arrêt peut perdre ses dernières modifications."
                : "Envoie « stop » au serveur : il enregistre le monde puis s'arrête."
            }
          >
            {server?.stopping ? "Forcer l'arrêt" : "Arrêter le serveur"}
          </Button>
        ) : (
          <Button
            disabled={!java?.install}
            onClick={() => void startServer()}
            icon={<Server size={14} strokeWidth={1.75} />}
            title="Lance un serveur dédié avec le mod, à côté du jeu : vérifie qu'il démarre sans code réservé au client, et se rejoint depuis « Tester en jeu »."
          >
            Serveur de test
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={running || serving || !java?.install}
          onClick={() => run("clean")}
          icon={<Eraser size={14} />}
          title={serving ? "Arrêtez d'abord le serveur de test : il utilise les fichiers compilés." : undefined}
        >
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
        <p role="status" className="shrink-0 text-footnote text-text-muted">
          <span className="font-medium text-success">Serveur prêt.</span> Pour le rejoindre : « Tester en jeu », puis
          Multijoueur, Connexion directe, adresse <span className="font-mono text-text">localhost</span>.
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

      {server && (
        <Segmented<View>
          label="Journal affiché"
          value={view}
          options={[
            { value: "main", label: running ? (session?.task === "runClient" ? "Jeu · en cours" : "Compilation · en cours") : "Compilation et jeu" },
            { value: "server", label: serving ? "Serveur · en marche" : "Serveur" },
          ]}
          onChange={(next) => {
            setView(next);
            if (next === "server") setArchived(null);
          }}
        />
      )}

      {shown?.running && (
        <div aria-live="polite" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-footnote text-text-muted">
          <Loader2 size={14} className="animate-spin text-info" />
          <span className="font-mono text-text">
            {shown.stopping ? "Arrêt du serveur, enregistrement du monde…" : (shown.currentTask ?? "Démarrage de Gradle…")}
          </span>
          <Elapsed since={shown.startedAt} />
          {shown.command && <span className="font-mono text-text-subtle">{shown.command}</span>}
          {shown.javaVersion && <span className="text-text-subtle">Java {shown.javaVersion}</span>}
        </div>
      )}

      {!shown?.running && record && (
        <div className="shrink-0">
          <BuildResult record={record} />
        </div>
      )}
      {archiveError && <p className="text-footnote text-danger">{archiveError}</p>}
      {archived && view === "main" && (
        <p className="text-footnote text-text-subtle">
          Journal d'une compilation passée ({ago(archived.record.startedAt)}).{" "}
          <button type="button" className={cn("rounded-sm underline underline-offset-2 hover:text-text", focusRing)} onClick={() => setArchived(null)}>
            Revenir à la dernière
          </button>
        </p>
      )}

      <div className="flex min-h-[320px] flex-1 flex-col">
        <LogView
          key={view}
          lines={view === "main" && archived ? archived.lines : (shown?.lines ?? [])}
          dropped={view === "main" && archived ? 0 : (shown?.dropped ?? 0)}
          empty={view === "server" ? "La console du serveur s'affichera ici." : "Le journal de Gradle s'affichera ici."}
        />
      </div>
      {view === "server" && serving && <ServerConsole projectId={project.id} disabled={Boolean(server?.stopping)} />}

      <History
        projectId={project.id}
        refreshKey={`${session?.record?.id ?? ""}|${server?.record?.id ?? ""}`}
        onOpen={(r) => void openArchived(r)}
      />
    </div>
  );
}
