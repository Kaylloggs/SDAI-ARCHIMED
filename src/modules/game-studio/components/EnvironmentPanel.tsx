import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AlertTriangle, CheckCircle2, ChevronDown, CircleDashed, Download, ExternalLink, FolderSearch, Loader2, RefreshCw, RotateCcw, XCircle } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Button } from "@/design-system/primitives";
import type { GameTool } from "@/core/ipc/bindings/GameTool";
import type { GameToolCategory } from "@/core/ipc/bindings/GameToolCategory";
import { errorText, gameStudioApi } from "../api";
import { TOOL_STATE } from "../lib/labels";
import { useGameStudioStore } from "../store";
import { ErrorLine, focusRing, ToneBadge } from "./ui";

const INSTALLABLE = new Set(["godot", "unity", "unreal", "blender", "git", "python", "node", "dotnet"]);

const CATEGORY_TITLE: Record<GameToolCategory, string> = {
  engine: "Moteurs de jeu",
  content: "Création de contenu",
  vcs: "Historique et versions",
  runtime: "Environnements d'exécution",
  sdk: "Kits de développement",
  ai: "Fournisseurs d'IA",
};

function StateIcon({ tool }: { tool: GameTool }) {
  const common = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;
  switch (tool.state) {
    case "ready":
      return <CheckCircle2 {...common} className="text-success" />;
    case "missing":
    case "error":
      return <XCircle {...common} className="text-danger" />;
    case "optional":
      return <CircleDashed {...common} className="text-text-subtle" />;
    default:
      return <AlertTriangle {...common} className="text-warning" />;
  }
}

function ToolRow({ tool, onError }: { tool: GameTool; onError: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const setEnvironment = useGameStudioStore((s) => s.setEnvironment);
  const loadEnvironment = useGameStudioStore((s) => s.loadEnvironment);
  const state = TOOL_STATE[tool.state];

  const run = async (label: string, work: () => Promise<void>) => {
    setBusy(label);
    try {
      await work();
    } catch (error) {
      onError(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  const choose = () =>
    run("choose", async () => {
      const picked = await openDialog({ multiple: false, directory: tool.id === "unreal", title: `Choisir ${tool.label}` });
      if (typeof picked === "string") setEnvironment(await gameStudioApi.setToolPath(tool.id, picked));
    });

  return (
    <li className="border-b border-border last:border-b-0">
      <div className="flex flex-wrap items-center gap-3 py-3">
        <StateIcon tool={tool} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-body-sm font-medium">{tool.label}</p>
            <ToneBadge tone={state.tone}>{state.label}</ToneBadge>
            {tool.version && <span className="font-mono text-caption text-text-muted">{tool.version}</span>}
          </div>
          <p className="text-footnote text-text-muted">{tool.purpose}</p>
          {tool.path && <p className="truncate font-mono text-caption text-text-subtle" title={tool.path}>{tool.path}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          {tool.state !== "ready" && INSTALLABLE.has(tool.id) && (
            <Button
              size="sm"
              variant="secondary"
              icon={busy === "install" ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              disabled={busy !== null}
              onClick={() =>
                run("install", async () => {
                  await gameStudioApi.installTool(tool.id);
                  await loadEnvironment(true);
                })
              }
            >
              {busy === "install" ? "Installation…" : "Installer"}
            </Button>
          )}
          {tool.overridable && (
            <Button size="sm" variant="ghost" icon={<FolderSearch size={13} />} disabled={busy !== null} onClick={() => void choose()}>
              Désigner l'exécutable
            </Button>
          )}
          {tool.checks.some((c) => c.label.startsWith("Chemin choisi")) && (
            <Button
              size="sm"
              variant="ghost"
              icon={<RotateCcw size={13} />}
              disabled={busy !== null}
              onClick={() => run("reset", async () => setEnvironment(await gameStudioApi.setToolPath(tool.id, null)))}
            >
              Oublier le chemin
            </Button>
          )}
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className={cn("inline-flex h-7 cursor-pointer items-center gap-1 rounded-sm px-2 text-footnote text-text-muted hover:bg-surface-2 hover:text-text", focusRing)}
          >
            Détails
            <ChevronDown size={13} className={cn("transition-transform duration-[140ms]", open && "rotate-180")} aria-hidden />
          </button>
        </div>
      </div>
      {open && (
        <div className="grid gap-4 pb-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-caption font-medium text-text-subtle">Ce qui a été vérifié</p>
            <ul className="space-y-1">
              {tool.checks.map((check) => (
                <li key={check.label} className="flex gap-2 text-footnote">
                  {check.ok ? (
                    <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" aria-label="réussi" />
                  ) : (
                    <XCircle size={13} className="mt-0.5 shrink-0 text-text-subtle" aria-label="échoué" />
                  )}
                  <span className="min-w-0">
                    <span className="break-words">{check.label}</span>
                    {check.detail && <span className="block break-words text-text-subtle">{check.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {tool.state !== "ready" && tool.setup.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-caption font-medium text-text-subtle">Pour l'installer</p>
              <ol className="space-y-1">
                {tool.setup.map((step, index) => (
                  <li key={step} className="flex gap-2 text-footnote">
                    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-surface-2 font-mono text-caption text-text-muted">{index + 1}</span>
                    <span className="min-w-0">{step}</span>
                  </li>
                ))}
              </ol>
              {tool.url && (
                <Button size="sm" variant="ghost" icon={<ExternalLink size={13} />} onClick={() => void openUrl(tool.url!)}>
                  Page officielle
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Rapport d'environnement : ce que la machine permet (moteurs, Blender, Git, SDK), ce qui a
 * été vérifié pour le dire, et comment installer ce qui manque.
 */
export function EnvironmentPanel({ compact = false }: { compact?: boolean }) {
  const environment = useGameStudioStore((s) => s.environment);
  const loading = useGameStudioStore((s) => s.environmentLoading);
  const loadEnvironment = useGameStudioStore((s) => s.loadEnvironment);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!environment) void loadEnvironment(false);
  }, [environment, loadEnvironment]);

  const categories: GameToolCategory[] = compact ? ["engine"] : ["engine", "content", "vcs", "sdk", "runtime", "ai"];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-footnote text-text-muted">
          {environment
            ? `Vérifié ${new Date(environment.checkedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} · ${environment.engines.length} installation(s) de moteur trouvée(s)`
            : "Détection des outils de la machine…"}
        </p>
        <Button
          size="sm"
          variant="secondary"
          icon={<RefreshCw size={13} className={cn(loading && "animate-spin")} />}
          disabled={loading}
          onClick={() => void loadEnvironment(true)}
        >
          {loading ? "Détection…" : "Détecter à nouveau"}
        </Button>
      </div>
      <ErrorLine message={error} onClose={() => setError(null)} />
      {!environment && loading && (
        <div className="space-y-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-surface-1" />
          ))}
        </div>
      )}
      {environment &&
        categories.map((category) => {
          const tools = environment.tools.filter((t) => t.category === category);
          if (tools.length === 0) return null;
          return (
            <section key={category} aria-label={CATEGORY_TITLE[category]} className="space-y-2">
              {!compact && <h2 className="text-title-3 font-semibold">{CATEGORY_TITLE[category]}</h2>}
              <ul className="rounded-lg border border-border bg-surface-1 px-4">
                {tools.map((tool) => (
                  <ToolRow key={tool.id} tool={tool} onError={setError} />
                ))}
              </ul>
            </section>
          );
        })}
    </div>
  );
}
