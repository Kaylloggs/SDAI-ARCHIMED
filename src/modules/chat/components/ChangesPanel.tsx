import { useEffect, useState, type CSSProperties } from "react";
import {
  ChevronRight,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  GitCompareArrows,
  GitPullRequest,
  Loader2,
  RefreshCw,
  ScanSearch,
  X,
} from "lucide-react";
import { cn } from "@/core/lib/cn";
import { DiffView } from "@/core/cards/DiffView";
import { engineApi } from "@/core/engine/engine.api";
import { workspaceApi, type FileDiff, type GitFile, type GitStatus } from "@/core/engine/workspace.api";
import { Badge, Button } from "@/design-system/primitives";
import { ASK, STATUS_LABEL, joinPath } from "../lib/changes";

type Tone = "neutral" | "success" | "danger" | "warning" | "info";
const STATUS_TONE: Record<string, Tone> = {
  added: "success",
  untracked: "success",
  deleted: "danger",
  conflicted: "warning",
  renamed: "info",
};

function FileRow({ root, file, revision }: { root: string; file: GitFile; revision: number }) {
  const [open, setOpen] = useState(false);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = file.path.split("/").at(-1) ?? file.path;
  const folder = file.path.slice(0, file.path.length - name.length).replace(/\/$/, "");

  // Le fichier a pu changer depuis la dernière ouverture : relu à chaque révision.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    workspaceApi
      .fileDiff(root, file.path)
      .then((value) => alive && (setDiff(value), setError(null)))
      .catch((e) => alive && setError((e as { message?: string }).message ?? "Lecture impossible"));
    return () => {
      alive = false;
    };
  }, [open, root, file.path, revision]);

  return (
    <li className="border-b border-border last:border-b-0">
      <div className="flex items-center gap-1 pr-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left hover:bg-surface-2"
        >
          <ChevronRight size={12} className={cn("shrink-0 text-text-subtle transition-transform", open && "rotate-90")} />
          <span className="flex min-w-0 flex-1 items-baseline gap-2" title={file.path}>
            <span className="shrink-0 font-mono text-footnote text-text">{name}</span>
            <span className="truncate font-mono text-caption text-text-subtle" dir="rtl">
              {folder}
            </span>
          </span>
          {(file.added > 0 || file.removed > 0) && (
            <span className="shrink-0 font-mono text-caption tabular-nums">
              <span className="text-success">+{file.added}</span> <span className="text-danger">−{file.removed}</span>
            </span>
          )}
          <Badge tone={STATUS_TONE[file.status] ?? "neutral"}>{STATUS_LABEL[file.status] ?? file.status}</Badge>
        </button>
        {file.status !== "deleted" && (
          <button
            type="button"
            aria-label={`Ouvrir ${file.path}`}
            title="Ouvrir le fichier"
            onClick={() => void engineApi.openPath(joinPath(root, file.path))}
            className="flex size-6 shrink-0 items-center justify-center rounded-xs text-text-subtle hover:bg-surface-2 hover:text-text"
          >
            <ExternalLink size={12} strokeWidth={1.75} />
          </button>
        )}
      </div>
      {open && (
        <div className="selectable px-3 pb-3">
          {error ? (
            <p className="text-footnote text-danger">{error}</p>
          ) : !diff ? (
            <Loader2 size={13} className="animate-spin text-text-subtle" aria-label="Chargement" />
          ) : diff.binary ? (
            <p className="text-footnote text-text-subtle">Fichier binaire ou trop gros : pas de comparaison ligne à ligne.</p>
          ) : (
            <DiffView path={file.path} before={diff.before} after={diff.after} bare collapseAfter={80} />
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Modifications du dossier de travail depuis le dernier commit (git) : fichier par fichier,
 * diff au clic. Relire, committer ou ouvrir une pull request se demande à l'agent.
 */
export function ChangesPanel({
  status,
  loading,
  error,
  onRefresh,
  revision,
  running,
  onAsk,
  onClose,
  className,
  style,
}: {
  /** `undefined` : lecture en cours ; `null` : pas un dépôt git. */
  status: GitStatus | null | undefined;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  /** Change quand l'agent agit (outil terminé) : les diffs ouverts sont relus. */
  revision: number;
  running: boolean;
  onAsk: (prompt: string) => void;
  onClose: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  const files = status?.files ?? [];
  const totals = files.reduce((sum, f) => ({ added: sum.added + f.added, removed: sum.removed + f.removed }), { added: 0, removed: 0 });

  return (
    <section aria-labelledby="chat-changes" className={cn("flex min-h-0 flex-col border-l border-border bg-bg-subtle", className)} style={style}>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <GitCompareArrows size={14} className="shrink-0 text-text-subtle" aria-hidden />
        <h2 id="chat-changes" className="flex-1 truncate text-body-sm font-semibold">
          Modifications {files.length > 0 && <span className="font-normal text-text-subtle">· {files.length}</span>}
        </h2>
        <button
          type="button"
          aria-label="Actualiser"
          title="Actualiser"
          onClick={onRefresh}
          className="flex size-7 items-center justify-center rounded-sm text-text-subtle hover:bg-surface-2 hover:text-text"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </button>
        <button
          type="button"
          aria-label="Fermer les modifications"
          onClick={onClose}
          className="flex size-7 items-center justify-center rounded-sm text-text-subtle hover:bg-surface-2 hover:text-text"
        >
          <X size={14} />
        </button>
      </div>

      {status && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-footnote text-text-muted">
          <GitBranch size={12} strokeWidth={1.75} className="shrink-0" aria-hidden />
          <span className="truncate font-mono">{status.branch ?? "HEAD détachée"}</span>
          {status.ahead > 0 && <span className="shrink-0 text-caption text-text-subtle">↑{status.ahead}</span>}
          {status.behind > 0 && <span className="shrink-0 text-caption text-text-subtle">↓{status.behind}</span>}
          {files.length > 0 && (
            <span className="ml-auto shrink-0 font-mono text-caption tabular-nums">
              <span className="text-success">+{totals.added}</span> <span className="text-danger">−{totals.removed}</span>
            </span>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <p role="alert" className="px-4 py-4 text-footnote text-danger">
            {error}
          </p>
        ) : status === undefined ? (
          <p className="flex items-center gap-2 px-4 py-4 text-footnote text-text-subtle">
            <Loader2 size={13} className="animate-spin" /> Lecture du dossier…
          </p>
        ) : status === null ? (
          <div className="space-y-3 px-4 py-4 text-footnote text-text-subtle">
            <p>
              Ce dossier n'est pas suivi par git : les modifications de l'agent restent visibles dans chaque action de la
              conversation (cliquez dessus pour voir le diff).
            </p>
            <Button size="sm" variant="secondary" onClick={() => onAsk(ASK.init)}>
              Demander d'initialiser git
            </Button>
          </div>
        ) : files.length === 0 ? (
          <p className="px-4 py-4 text-footnote text-text-subtle">
            Aucune modification depuis le dernier commit{status.ahead > 0 ? ` · ${status.ahead} commit(s) à pousser` : ""}.
          </p>
        ) : (
          <ul aria-label="Fichiers modifiés">
            {files.map((file) => (
              <FileRow key={file.path} root={status.root} file={file} revision={revision} />
            ))}
          </ul>
        )}
      </div>

      {status && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border p-3">
          <Button
            size="sm"
            variant="ghost"
            disabled={files.length === 0}
            onClick={() => onAsk(ASK.review)}
            icon={<ScanSearch size={13} strokeWidth={1.75} />}
            title="Demander à l'agent de relire ces modifications"
          >
            Relire
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={files.length === 0}
            onClick={() => onAsk(ASK.commit)}
            icon={<GitCommitHorizontal size={13} strokeWidth={1.75} />}
            title="Demander à l'agent de committer ces modifications"
          >
            Commit
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={files.length === 0 && status.ahead === 0}
            onClick={() => onAsk(ASK.pr)}
            icon={<GitPullRequest size={13} strokeWidth={1.75} />}
            title="Demander à l'agent de pousser la branche et d'ouvrir une pull request"
          >
            Pull request
          </Button>
          {running && <span className="text-caption text-text-subtle">envoyé à la fin du tour</span>}
        </div>
      )}
    </section>
  );
}
