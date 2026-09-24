import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  FileCode2,
  FilePlus,
  FolderPlus,
  Lock,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/core/lib/cn";
import { CodeEditor, FileTree, languageOfPath, type TreeChanges, type TreeEntry } from "@/core/editor";
import { Button, ContextMenu, EmptyState, type ContextMenuItem } from "@/design-system/primitives";
import type { ProjectSummary } from "@/core/ipc/bindings/ProjectSummary";
import { errorText, mcstudioApi } from "../../api";
import { useEditorStore, type OpenFile } from "../../editor";
import { joinPath, megabytes } from "../../lib/format";
import { isBuildScript, nameOf, newPathProblem, parentOf } from "../../lib/paths";
import { Checker, focusRing, inputClass, PixelImage } from "../ui";
import { ProblemsPanel } from "./ProblemsPanel";

type Prompt =
  | { kind: "file" | "folder"; base: string }
  | { kind: "rename"; entry: TreeEntry }
  | { kind: "trash"; entry: TreeEntry };

/** Création, renommage ou mise à la Corbeille, en ligne au-dessus de l'arbre. */
function PromptBar({
  prompt,
  onDone,
  onCancel,
  run,
}: {
  prompt: Prompt;
  onDone: () => void;
  onCancel: () => void;
  run: (prompt: Prompt, value: string) => Promise<void>;
}) {
  const initial =
    prompt.kind === "rename"
      ? prompt.entry.path
      : prompt.kind === "trash"
        ? ""
        : prompt.base
          ? `${prompt.base}/`
          : "";
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = prompt.kind === "trash" ? null : newPathProblem(value);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await run(prompt, value.trim());
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (prompt.kind === "trash") {
    return (
      <div role="alert" className="space-y-2 border-b border-border bg-danger-soft px-3 py-2">
        <p className="text-footnote">
          Mettre <span className="font-mono">{prompt.entry.path}</span> à la Corbeille ?
        </p>
        {error && <p className="text-footnote text-danger">{error}</p>}
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="danger" disabled={busy} onClick={() => void submit()}>
            Mettre à la Corbeille
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Annuler
          </Button>
        </div>
      </div>
    );
  }

  const title = { file: "Nouveau fichier", folder: "Nouveau dossier", rename: "Renommer" }[prompt.kind];
  return (
    <form
      className="space-y-2 border-b border-border px-3 py-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!problem) void submit();
      }}
    >
      <label htmlFor="mc-path-prompt" className="block text-caption font-medium text-text-muted">
        {title}
      </label>
      <input
        id="mc-path-prompt"
        autoFocus
        spellCheck={false}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => event.key === "Escape" && onCancel()}
        className={cn(inputClass, "font-mono text-footnote")}
      />
      {(error ?? (value !== initial ? problem : null)) && (
        <p className="text-caption text-danger">{error ?? problem}</p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={busy || !!problem || value.trim() === initial}>
          Valider
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

function TabBar({
  tabs,
  active,
  onSelect,
  onClose,
}: {
  tabs: OpenFile[];
  active: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}) {
  return (
    <div role="tablist" aria-label="Fichiers ouverts" className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border">
      {tabs.map(({ file, draft }) => {
        const selected = file.path === active;
        return (
          <div
            key={file.path}
            className={cn(
              "group flex shrink-0 items-center gap-1 border-r border-border pl-3 pr-1 text-body-sm",
              selected ? "bg-surface-1 text-text" : "text-text-muted hover:bg-surface-1/60",
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              title={file.path}
              onClick={() => onSelect(file.path)}
              className={cn("max-w-[200px] truncate rounded-xs", focusRing)}
            >
              {nameOf(file.path)}
            </button>
            <button
              type="button"
              aria-label={draft !== null ? `Fermer ${nameOf(file.path)} (modifié)` : `Fermer ${nameOf(file.path)}`}
              onClick={() => onClose(file.path)}
              className={cn(
                "flex size-5 items-center justify-center rounded-xs text-text-subtle hover:bg-surface-2 hover:text-text",
                focusRing,
              )}
            >
              {draft !== null ? (
                <span aria-hidden className="size-2 rounded-full bg-accent group-hover:hidden" />
              ) : null}
              <X size={12} className={cn(draft !== null && "hidden group-hover:block")} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Onglet Fichiers : explorateur du projet et éditeur (Java, JSON, TOML, Gradle…).
 * Les brouillons survivent au changement d'onglet ; un fichier changé ailleurs depuis
 * son ouverture n'est jamais écrasé sans le demander.
 */
export function FilesPanel({ project }: { project: ProjectSummary }) {
  const id = project.id;
  const editor = useEditorStore((s) => s.editors[id]);
  const report = useEditorStore((s) => s.reports[id]);
  const problemsOpen = useEditorStore((s) => s.problemsOpen[id] ?? false);
  const reveal = useEditorStore((s) => s.reveal[id] ?? null);
  const [checking, setChecking] = useState(false);
  const store = useEditorStore.getState();
  const [changes, setChanges] = useState<TreeChanges>({ dirs: [], revision: 0 });
  const [reloadKey, setReloadKey] = useState(0);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: TreeEntry } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);

  const tabs = editor?.tabs ?? [];
  const active = tabs.find((tab) => tab.file.path === editor?.active) ?? null;

  const list = useCallback((dir: string) => mcstudioApi.listFiles(id, dir), [id]);
  const touched = (...paths: string[]) =>
    setChanges((current) => ({ dirs: paths.map(parentOf), revision: current.revision + 1 }));

  const check = useCallback(async () => {
    setChecking(true);
    try {
      await useEditorStore.getState().validate(id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setChecking(false);
    }
  }, [id]);

  // Fichiers changés pendant l'absence (textures, IA, autre éditeur) : relus, et le
  // projet revérifié.
  useEffect(() => {
    void useEditorStore.getState().refreshClean(id);
    void check();
  }, [id, check]);

  const attempt = async (work: () => Promise<void>) => {
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const save = async (path: string, overwrite = false) => {
    setError(null);
    try {
      await useEditorStore.getState().save(id, path, overwrite);
      setConflict(null);
      void check();
    } catch (e) {
      const message = errorText(e);
      if (message.includes("modifié en dehors")) setConflict(path);
      else setError(message);
    }
  };

  const close = (path: string) => {
    const tab = tabs.find((t) => t.file.path === path);
    if (tab?.draft !== null && tab?.draft !== undefined) setClosing(path);
    else store.close(id, path);
  };

  const runPrompt = async (current: Prompt, value: string) => {
    switch (current.kind) {
      case "file":
      case "folder": {
        const created = await mcstudioApi.createFile(id, value, current.kind === "folder");
        touched(created.path);
        if (current.kind === "file") await useEditorStore.getState().open(id, created.path);
        break;
      }
      case "rename":
        await mcstudioApi.renameFile(id, current.entry.path, value);
        useEditorStore.getState().moved(id, current.entry.path, value);
        touched(current.entry.path, value);
        break;
      case "trash":
        await mcstudioApi.trashFile(id, current.entry.path);
        useEditorStore.getState().removed(id, current.entry.path);
        touched(current.entry.path);
        break;
    }
    void check();
  };

  const menuItems = (entry: TreeEntry): ContextMenuItem[] => {
    const base = entry.isDir ? entry.path : parentOf(entry.path);
    return [
      ...(!entry.isDir
        ? [{ id: "open", label: "Ouvrir", icon: <FileCode2 size={14} />, onSelect: () => void attempt(() => store.open(id, entry.path)) }]
        : []),
      { id: "file", label: "Nouveau fichier ici…", icon: <FilePlus size={14} />, onSelect: () => setPrompt({ kind: "file", base }) },
      { id: "folder", label: "Nouveau dossier ici…", icon: <FolderPlus size={14} />, onSelect: () => setPrompt({ kind: "folder", base }) },
      { id: "sep", separator: true },
      { id: "rename", label: "Renommer…", icon: <Pencil size={14} />, disabled: !!entry.ignored, onSelect: () => setPrompt({ kind: "rename", entry }) },
      {
        id: "trash",
        label: "Mettre à la Corbeille…",
        icon: <Trash2 size={14} />,
        danger: true,
        disabled: !!entry.ignored,
        onSelect: () => setPrompt({ kind: "trash", entry }),
      },
    ];
  };

  const file = active?.file ?? null;
  const absolute = file ? joinPath(project.path, ...file.path.split("/")) : "";
  const filePath = file?.path ?? null;
  const markers = useMemo(
    () =>
      (report?.issues ?? [])
        .filter((issue) => issue.file === filePath && issue.line !== null)
        .map((issue) => ({ line: issue.line ?? 1, severity: issue.severity, message: issue.message })),
    [report, filePath],
  );

  return (
    <div className="flex h-full min-h-0">
      <aside aria-label="Explorateur du projet" className="flex w-[260px] shrink-0 flex-col border-r border-border bg-bg-subtle">
        <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border px-2">
          <span className="flex-1 truncate px-1 text-caption font-semibold uppercase tracking-[0.04em] text-text-subtle">
            {project.meta?.modId ?? "Projet"}
          </span>
          {[
            { label: "Nouveau fichier", Icon: FilePlus, onClick: () => setPrompt({ kind: "file", base: file ? parentOf(file.path) : "" }) },
            { label: "Nouveau dossier", Icon: FolderPlus, onClick: () => setPrompt({ kind: "folder", base: file ? parentOf(file.path) : "" }) },
            { label: "Rafraîchir", Icon: RefreshCw, onClick: () => setReloadKey((key) => key + 1) },
          ].map(({ label, Icon, onClick }) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              title={label}
              onClick={onClick}
              className={cn(
                "flex size-7 items-center justify-center rounded-sm text-text-subtle transition-colors hover:bg-surface-2 hover:text-text",
                focusRing,
              )}
            >
              <Icon size={14} strokeWidth={1.75} />
            </button>
          ))}
        </div>
        {prompt && (
          <PromptBar
            key={JSON.stringify(prompt)}
            prompt={prompt}
            run={runPrompt}
            onDone={() => setPrompt(null)}
            onCancel={() => setPrompt(null)}
          />
        )}
        <div className="min-h-0 flex-1 overflow-auto py-1">
          <FileTree
            root=""
            list={list}
            activePath={editor?.active ?? null}
            onOpenFile={(entry) => void attempt(() => store.open(id, entry.path))}
            onContextMenu={(entry, event) => setMenu({ x: event.clientX, y: event.clientY, entry })}
            changes={changes}
            reloadKey={reloadKey}
            label="Fichiers du projet"
          />
        </div>
      </aside>

      <section aria-label="Éditeur" className="flex min-w-0 flex-1 flex-col">
        {tabs.length > 0 && (
          <TabBar tabs={tabs} active={editor?.active ?? null} onSelect={(path) => store.activate(id, path)} onClose={close} />
        )}

        {closing && (
          <div role="alert" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-warning-soft px-4 py-2">
            <p className="flex-1 text-footnote">
              <span className="font-mono">{nameOf(closing)}</span> a des modifications non enregistrées.
            </p>
            <Button
              type="button"
              size="sm"
              variant="primary"
              onClick={() =>
                void save(closing).then(() => {
                  const still = useEditorStore.getState().editors[id]?.tabs.find((t) => t.file.path === closing);
                  if (still?.draft === null) store.close(id, closing);
                  setClosing(null);
                })
              }
            >
              Enregistrer et fermer
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                store.close(id, closing);
                setClosing(null);
              }}
            >
              Fermer sans enregistrer
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setClosing(null)}>
              Annuler
            </Button>
          </div>
        )}

        {conflict && conflict === file?.path && (
          <div role="alert" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-warning-soft px-4 py-2">
            <AlertTriangle size={14} className="text-warning" />
            <p className="flex-1 text-footnote">
              Ce fichier a changé sur le disque depuis son ouverture (autre éditeur, génération, IA).
            </p>
            <Button type="button" size="sm" onClick={() => void attempt(() => store.reload(id, conflict)).then(() => setConflict(null))}>
              Recharger (perdre mes modifications)
            </Button>
            <Button type="button" size="sm" variant="danger" onClick={() => void save(conflict, true)}>
              Écraser
            </Button>
          </div>
        )}

        {file && isBuildScript(file.path) && (
          <p className="flex shrink-0 items-center gap-2 border-b border-border bg-warning-soft px-4 py-1.5 text-footnote">
            <AlertTriangle size={14} className="shrink-0 text-warning" />
            Script de build : Gradle l'exécute à chaque compilation. Une erreur ici empêche de compiler.
          </p>
        )}

        {error && (
          <p role="alert" className="shrink-0 border-b border-border bg-danger-soft px-4 py-2 text-footnote">
            {error}
          </p>
        )}

        <div className="min-h-0 flex-1">
          {!file ? (
            <EmptyState
              icon={<FileCode2 size={28} strokeWidth={1.5} />}
              title="Aucun fichier ouvert"
              description="Choisissez un fichier dans l'explorateur. Clic droit : créer, renommer, mettre à la Corbeille."
            />
          ) : file.image ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
              <Checker size={272}>
                <PixelImage path={absolute} version={file.modified} size={256} alt={file.path} />
              </Checker>
              <p className="text-footnote text-text-subtle">
                Image · {megabytes(file.size) === "—" ? `${file.size} o` : megabytes(file.size)} · modifiable depuis l'onglet Textures
              </p>
            </div>
          ) : file.binary ? (
            <EmptyState
              icon={<Lock size={28} strokeWidth={1.5} />}
              title="Fichier binaire"
              description={`${file.path} ne peut pas être affiché comme du texte.`}
            />
          ) : (
            <CodeEditor
              key={file.path}
              language={languageOfPath(file.path)}
              value={active?.draft ?? file.content}
              readOnly={file.truncated}
              onChange={(content) => store.edit(id, file.path, content)}
              onSave={() => void save(file.path)}
              markers={markers}
              reveal={reveal && reveal.path === file.path ? reveal : null}
            />
          )}
        </div>

        {file && !file.image && !file.binary && (
          <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-border px-4 text-caption text-text-subtle">
            <span className="selectable truncate font-mono">{file.path}</span>
            <span>{languageOfPath(file.path) ?? "texte"}</span>
            {file.truncated && <span className="text-warning">Tronqué (lecture seule)</span>}
            <span className="ml-auto">{active?.draft !== null ? "Modifié" : "Enregistré"}</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={active?.draft === null}
              onClick={() => void save(file.path)}
              icon={<Save size={12} />}
            >
              Enregistrer (Ctrl+S)
            </Button>
          </footer>
        )}

        <ProblemsPanel
          report={report}
          open={problemsOpen}
          checking={checking}
          onToggle={() => store.showProblems(id, !problemsOpen)}
          onCheck={() => void check()}
          onSelect={(issue) => {
            // Un dossier mal nommé n'a pas de contenu à ouvrir.
            if (nameOf(issue.file).includes(".")) void attempt(() => store.goTo(id, issue.file, issue.line));
          }}
        />
      </section>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.entry)} label={menu.entry.name} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}
