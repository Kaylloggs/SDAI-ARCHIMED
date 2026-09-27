import { useEffect } from "react";
import { FolderOpen, Hammer, Loader2, Puzzle } from "lucide-react";
import { engineApi } from "@/core/engine/engine.api";
import { useSessionStore } from "@/core/engine/session.store";
import { Badge, Button, Popover } from "@/design-system/primitives";
import type { LocalModule } from "./api";
import { readySignature, scheduleLocalChecks, useLocalUpdateStore } from "./local";

const ACTIVE = ["starting", "running", "awaiting"];
const norm = (path: string) => path.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
const folder = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

function ago(ms: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return `il y a ${seconds} s`;
  return `il y a ${Math.round(seconds / 60)} min`;
}

function ModuleRow({ module }: { module: LocalModule }) {
  return (
    <li className="flex items-center gap-2 py-1">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-sm text-text">{module.name}</span>
        <span className="block truncate font-mono text-caption text-text-subtle">{module.id}</span>
      </span>
      {module.ready ? (
        <Badge tone={module.state === "new" ? "info" : "neutral"}>{module.state === "new" ? "nouveau" : "modifié"}</Badge>
      ) : (
        <span className="shrink-0 text-caption text-text-subtle">
          {module.unfinished ? "encore le modèle" : `modifié ${ago(module.modifiedAt)}`}
        </span>
      )}
    </li>
  );
}

/**
 * Pastille bleue de la barre de titre : un module a été créé (ou modifié) dans le code source
 * d'ARCHIMED et n'est pas encore dans l'application. Un clic l'intègre en recompilant.
 */
export function LocalUpdateButton() {
  const { status, error, rebuilding, dismissed, rebuild, dismiss } = useLocalUpdateStore();
  const sessions = useSessionStore((s) => s.sessions);

  useEffect(() => scheduleLocalChecks(), []);

  const modules = status?.modules ?? [];
  const ready = modules.filter((m) => m.ready);
  const waiting = modules.filter((m) => !m.ready);
  const signature = readySignature(modules);
  if (!status?.sourceDir || (!rebuilding && (ready.length === 0 || signature === dismissed))) return null;

  const source = norm(status.sourceDir);
  const working = sessions.filter((s) => ACTIVE.includes(s.status) && s.cwd && norm(s.cwd).startsWith(source)).length;
  const title = ready.length === 1 ? `« ${ready[0]!.name} » est prêt` : `${ready.length} modules prêts à intégrer`;

  return (
    <div className="glass-chrome flex shrink-0 items-center rounded-full p-0.5">
      <Popover
        label="Mise à jour : intégrer vos modules"
        title={rebuilding ? "Recompilation en cours" : title}
        value={rebuilding ? "Recompilation" : "Mise à jour"}
        icon={
          rebuilding ? (
            <Loader2 size={14} strokeWidth={1.75} className="animate-spin" aria-hidden />
          ) : (
            <span className="relative flex" aria-hidden>
              <Puzzle size={14} strokeWidth={1.75} />
              <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-info" />
            </span>
          )
        }
        width={340}
        align="end"
        chevron={false}
        className="h-8 rounded-full border-transparent bg-transparent px-3 font-medium text-info hover:border-transparent hover:bg-surface-2"
      >
        <div className="-m-3 max-h-[calc(100vh-72px)] space-y-3 overflow-y-auto overscroll-contain p-3">
          <div className="flex items-start gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-info-soft text-info" aria-hidden>
              <Puzzle size={15} strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <p className="text-body-sm font-semibold">{title}</p>
              <p className="truncate text-footnote text-text-muted" title={status.sourceDir}>
                Dans votre code : {folder(status.sourceDir)}
              </p>
            </div>
          </div>

          <ul className="divide-y divide-border rounded-sm border border-border px-2.5">
            {ready.map((module) => (
              <ModuleRow key={module.id} module={module} />
            ))}
          </ul>
          {waiting.length > 0 && (
            <div className="space-y-1">
              <p className="text-footnote font-medium text-text-muted">En cours d'écriture</p>
              <ul className="rounded-sm border border-dashed border-border px-2.5">
                {waiting.map((module) => (
                  <ModuleRow key={module.id} module={module} />
                ))}
              </ul>
            </div>
          )}

          {rebuilding ? (
            <p className="rounded-sm bg-info-soft px-2.5 py-1.5 text-footnote text-text" aria-live="polite">
              La recompilation se poursuit dans la fenêtre PowerShell. Vous pouvez continuer à travailler : ARCHIMED se fermera à la
              fin pour installer la version avec vos modules.
            </p>
          ) : (
            <>
              {working > 0 && (
                <p className="rounded-sm bg-warning-soft px-2.5 py-1.5 text-footnote text-text">
                  Une IA travaille encore dans ce dossier : attendez qu'elle ait fini avant d'intégrer.
                </p>
              )}
              {error && (
                <p role="alert" className="rounded-sm bg-danger-soft px-2.5 py-1.5 text-footnote text-text">
                  {error}
                </p>
              )}
              <p className="text-footnote text-text-subtle">
                ARCHIMED est recompilé avec votre code puis réinstallé. Une fenêtre PowerShell montre l'avancement (quelques minutes) ;
                le code est d'abord mis au niveau de la dernière version publiée. Conversations, réglages et clés sont gardés.
              </p>
            </>
          )}

          <div className="flex items-center gap-1 border-t border-border pt-3">
            {!rebuilding && (
              <Button size="sm" variant="ghost" onClick={dismiss} className="whitespace-nowrap">
                Plus tard
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void engineApi.openPath(ready[0]?.path ?? status.sourceDir!)}
              className="whitespace-nowrap"
              icon={<FolderOpen size={13} strokeWidth={1.75} />}
            >
              Dossier
            </Button>
            <span className="ml-auto" />
            <Button
              size="sm"
              variant="primary"
              disabled={rebuilding || ready.length === 0}
              onClick={() => void rebuild()}
              className="whitespace-nowrap"
              title="Recompiler ARCHIMED avec ces modules et l'installer"
              icon={rebuilding ? <Loader2 size={13} className="animate-spin" /> : <Hammer size={13} strokeWidth={1.75} />}
            >
              Intégrer
            </Button>
          </div>
        </div>
      </Popover>
    </div>
  );
}
