import { useCallback, useEffect, useState } from "react";
import { FilePlus2, FileMinus2, FilePen, GitBranch, History, Loader2, RotateCcw, Save } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Badge, Button } from "@/design-system/primitives";
import type { GameCheckpoint } from "@/core/ipc/bindings/GameCheckpoint";
import type { GameFileChange } from "@/core/ipc/bindings/GameFileChange";
import type { GameVcsState } from "@/core/ipc/bindings/GameVcsState";
import { errorText, gameStudioApi } from "../../api";
import { ago } from "../../lib/labels";
import { useGameStudioStore } from "../../store";
import { Bullets, ConfirmButton, ErrorLine, focusRing, Group, TextInput } from "../ui";

const KIND = {
  added: { icon: FilePlus2, label: "ajouté depuis", tone: "text-success" },
  modified: { icon: FilePen, label: "modifié depuis", tone: "text-info" },
  deleted: { icon: FileMinus2, label: "supprimé depuis", tone: "text-danger" },
} as const;

/** Diff unifié de Git, lignes teintées (+ / −). */
function Patch({ text }: { text: string }) {
  const lines = text.split("\n").filter((l) => !l.startsWith("diff --git") && !l.startsWith("index "));
  return (
    <pre className="max-h-80 overflow-auto rounded-md border border-border bg-bg p-2 font-mono text-caption leading-5">
      {lines.map((line, i) => (
        <div
          key={i}
          className={cn(
            "whitespace-pre-wrap break-all px-1",
            line.startsWith("+") && !line.startsWith("+++") && "bg-success-soft",
            line.startsWith("-") && !line.startsWith("---") && "bg-danger-soft",
            line.startsWith("@@") && "text-text-subtle",
          )}
        >
          {line || " "}
        </div>
      ))}
    </pre>
  );
}

function CheckpointRow({ projectId, checkpoint, onRestored }: { projectId: string; checkpoint: GameCheckpoint; onRestored: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [changes, setChanges] = useState<GameFileChange[] | null>(null);
  const [diff, setDiff] = useState<{ path: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setOpen((v) => !v);
    if (changes) return;
    try {
      setChanges(await gameStudioApi.checkpointChanges(projectId, checkpoint.id));
    } catch (e) {
      setError(errorText(e));
    }
  };

  const restore = async (paths: string[] | null) => {
    setBusy(true);
    try {
      onRestored(await gameStudioApi.restore(projectId, checkpoint.id, paths));
      setChanges(null);
      setOpen(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="border-b border-border py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-body-sm">{checkpoint.label}</p>
          <p className="text-footnote text-text-muted">
            {checkpoint.by} · {ago(checkpoint.at)} · <span className="font-mono">{checkpoint.commit.slice(0, 8)}</span>
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void load()} aria-expanded={open}>
          {open ? "Masquer" : "Voir ce qui a changé depuis"}
        </Button>
        <ConfirmButton label="Revenir à ce point" confirmLabel="Confirmer le retour" icon={busy ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} disabled={busy} onConfirm={() => void restore(null)} />
      </div>
      <ErrorLine message={error} onClose={() => setError(null)} />
      {open && (
        <div className="space-y-2 pt-2">
          {!changes ? (
            <p className="text-footnote text-text-subtle">Comparaison…</p>
          ) : changes.length === 0 ? (
            <p className="text-footnote text-text-subtle">Aucun fichier n'a changé depuis ce point.</p>
          ) : (
            <ul className="space-y-0.5">
              {changes.map((change) => {
                const look = KIND[change.kind];
                return (
                  <li key={change.path} className="flex items-center gap-2">
                    <look.icon size={13} className={cn("shrink-0", look.tone)} aria-label={look.label} />
                    <button
                      type="button"
                      onClick={() =>
                        void gameStudioApi
                          .checkpointDiff(projectId, checkpoint.id, change.path)
                          .then((text) => setDiff({ path: change.path, text }))
                          .catch((e) => setError(errorText(e)))
                      }
                      className={cn("min-w-0 flex-1 cursor-pointer truncate text-left font-mono text-caption text-text-muted hover:text-text", focusRing)}
                    >
                      {change.path}
                    </button>
                    <ConfirmButton label="Rétablir" confirmLabel="Rétablir ce fichier ?" size="sm" onConfirm={() => void restore([change.path])} />
                  </li>
                );
              })}
            </ul>
          )}
          {diff && (
            <div className="space-y-1">
              <p className="font-mono text-caption text-text-subtle">{diff.path}</p>
              <Patch text={diff.text || "(fichier binaire ou identique)"} />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** Historique : points de restauration (Git), versions du jeu et modifications tracées. */
export function HistorySection() {
  const current = useGameStudioStore((s) => s.current);
  const reload = useGameStudioStore((s) => s.reload);
  const [vcs, setVcs] = useState<GameVcsState | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const id = current?.project.id;

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      setVcs(await gameStudioApi.vcsState(id));
    } catch (e) {
      setError(errorText(e));
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!current || !id) return null;
  const { graph } = current;

  const run = async (work: () => Promise<string | void>) => {
    setBusy(true);
    setError(null);
    try {
      const message = await work();
      if (message) setNotice(message);
      await refresh();
      await reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      {notice && <p className="rounded-md bg-success-soft px-3 py-2 text-footnote">{notice}</p>}
      <ErrorLine message={error} onClose={() => setError(null)} />

      <Group
        title="Points de restauration"
        description="Un instantané de tout le projet (hors fichiers ignorés), sans toucher à vos branches. Revenir en arrière garde toujours l'état d'avant."
      >
        {!vcs ? (
          <p className="py-3 text-footnote text-text-subtle">Lecture de l'état Git…</p>
        ) : !vcs.gitAvailable ? (
          <p className="py-3 text-body-sm text-text-muted">Git n'est pas installé : installez-le depuis l'onglet Outils pour avoir des points de restauration.</p>
        ) : !vcs.repository ? (
          <div className="flex flex-wrap items-center gap-3 py-3">
            <p className="min-w-0 flex-1 text-body-sm text-text-muted">Ce projet n'est pas encore suivi par Git.</p>
            <Button size="sm" variant="primary" icon={<GitBranch size={13} />} disabled={busy} onClick={() => void run(() => gameStudioApi.vcsInit(id))}>
              Initialiser Git
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-border py-3 text-footnote text-text-muted">
              <GitBranch size={13} aria-hidden /> {vcs.branch ?? "branche détachée"}
              <span>· {vcs.dirty} fichier(s) modifié(s) depuis votre dernier commit</span>
              {vcs.lfs && <Badge tone="neutral">Git LFS</Badge>}
            </div>
            <form
              className="flex flex-wrap gap-2 border-b border-border py-3"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await gameStudioApi.checkpoint(id, label);
                  setLabel("");
                  return "Point de restauration créé.";
                });
              }}
            >
              <TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Avant d'ajouter les véhicules" aria-label="Nom du point de restauration" className="min-w-[240px] flex-1" />
              <Button size="sm" variant="secondary" type="submit" icon={busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} disabled={busy}>
                Créer un point de restauration
              </Button>
            </form>
            <ul>
              {[...vcs.checkpoints].reverse().map((checkpoint) => (
                <CheckpointRow key={checkpoint.id} projectId={id} checkpoint={checkpoint} onRestored={(message) => void run(async () => message)} />
              ))}
              {vcs.checkpoints.length === 0 && <li className="py-3 text-footnote text-text-subtle">Aucun point pour l'instant.</li>}
            </ul>
          </>
        )}
      </Group>

      <Group title="Versions du jeu">
        <ul className="divide-y divide-border">
          {[...graph.versions].reverse().map((v) => (
            <li key={v.version} className="flex gap-3 py-3">
              <span className="font-mono text-body-sm text-accent">v{v.version}</span>
              <div className="min-w-0">
                <p className="text-body-sm">{v.label}</p>
                {v.summary && <p className="text-footnote text-text-muted">{v.summary}</p>}
                <p className="text-caption text-text-subtle">{ago(v.at)}</p>
              </div>
            </li>
          ))}
        </ul>
      </Group>

      <Group title="Modifications tracées" description="Ce qui a changé, pourquoi, avec quel impact, quels fichiers et quels risques.">
        <ul className="divide-y divide-border">
          {[...graph.changes].reverse().map((change) => (
            <li key={change.id} className="space-y-1 py-3">
              <p className="flex items-center gap-2 text-body-sm">
                <History size={13} className="shrink-0 text-text-subtle" aria-hidden />
                {change.title} <span className="text-caption text-text-subtle">· {change.by} · {ago(change.at)}</span>
              </p>
              <p className="text-footnote text-text-muted">{change.what}</p>
              {change.why && <p className="text-footnote text-text-muted">Pourquoi : {change.why}</p>}
              {change.impact && <p className="text-footnote text-text-muted">Impact : {change.impact}</p>}
              {change.risks.length > 0 && <Bullets items={change.risks.map((r) => `Risque : ${r}`)} />}
              {change.files.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-footnote text-text-subtle">{change.files.length} fichier(s)</summary>
                  <ul className="pt-1">
                    {change.files.map((f) => (
                      <li key={f} className="truncate font-mono text-caption text-text-subtle">
                        {f}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
          {graph.changes.length === 0 && <li className="py-3 text-footnote text-text-subtle">Aucune modification tracée.</li>}
        </ul>
      </Group>
    </div>
  );
}
