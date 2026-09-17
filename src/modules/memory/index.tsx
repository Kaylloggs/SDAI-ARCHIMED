import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Brain, Check, Eye, FolderOpen, Globe, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Button, EmptyState, SectionHeader, Tooltip } from "@/design-system/primitives";
import { memoryApi, type MemorySettings, type Note, type NotePatch } from "./api";

const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
const message = (error: unknown) => (error as { message?: string }).message ?? String(error);

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors",
        checked ? "bg-accent" : "bg-surface-3",
      )}
    >
      <span
        className={cn(
          "size-4 rounded-full bg-text shadow-sm transition-transform duration-150",
          checked ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
}

/** Choix de portée : partout ou un dossier de projet. */
function ScopePicker({ project, onChange }: { project: string | null; onChange: (project: string | null) => void }) {
  const pick = async () => {
    const selected = await open({ directory: true, title: "Projet concerné par cette information" });
    if (typeof selected === "string") onChange(selected);
  };
  return (
    <div role="group" aria-label="Portée" className="flex h-7 shrink-0 items-center rounded-sm border border-border bg-surface-1 p-0.5">
      <button
        type="button"
        aria-pressed={project === null}
        onClick={() => onChange(null)}
        className={cn(
          "flex h-full items-center gap-1 rounded-xs px-2 text-caption transition-colors",
          project === null ? "bg-surface-3 text-text" : "text-text-subtle hover:text-text",
        )}
      >
        <Globe size={11} strokeWidth={1.75} />
        Partout
      </button>
      <button
        type="button"
        aria-pressed={project !== null}
        onClick={() => void pick()}
        title={project ?? undefined}
        className={cn(
          "flex h-full max-w-40 items-center gap-1 rounded-xs px-2 text-caption transition-colors",
          project !== null ? "bg-surface-3 text-text" : "text-text-subtle hover:text-text",
        )}
      >
        <FolderOpen size={11} strokeWidth={1.75} className="shrink-0" />
        <span className="truncate">{project ? folderName(project) : "Un projet…"}</span>
      </button>
    </div>
  );
}

function NoteRow({ note, onPatch, onDelete }: { note: Note; onPatch: (patch: NotePatch) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.text);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(timer);
  }, [confirming]);

  const save = () => {
    if (draft.trim() && draft.trim() !== note.text) onPatch({ text: draft.trim() });
    setEditing(false);
  };

  return (
    <li
      className={cn(
        "group rounded-md border bg-surface-1 p-3 transition-colors",
        note.enabled ? "border-border" : "border-dashed border-border",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="pt-0.5">
          <Tooltip label={note.enabled ? "Transmise aux IA" : "Non transmise aux IA"} side="bottom">
            <Switch
              checked={note.enabled}
              label={note.enabled ? "Ne plus transmettre aux IA" : "Transmettre aux IA"}
              onChange={(enabled) => onPatch({ enabled })}
            />
          </Tooltip>
        </div>

        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-2">
              <textarea
                autoFocus
                rows={Math.min(8, Math.max(2, draft.split("\n").length))}
                value={draft}
                aria-label="Modifier l'information"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) save();
                  if (event.key === "Escape") setEditing(false);
                }}
                className="selectable w-full resize-y rounded-sm border border-border-strong bg-surface-2 p-2 text-body-sm outline-none"
              />
              <div className="flex items-center gap-2">
                <ScopePicker project={note.project} onChange={(project) => onPatch({ project })} />
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEditing(false)}>
                  Annuler
                </Button>
                <Button size="sm" variant="primary" onClick={save}>
                  Enregistrer
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p
                className={cn(
                  "selectable whitespace-pre-wrap text-body-sm",
                  note.enabled ? "text-text" : "text-text-subtle",
                )}
              >
                {note.text}
              </p>
              <p className="mt-1.5 flex items-center gap-1 text-caption text-text-subtle" title={note.project ?? undefined}>
                {note.project ? <FolderOpen size={11} strokeWidth={1.75} /> : <Globe size={11} strokeWidth={1.75} />}
                {note.project ? folderName(note.project) : "Toutes les conversations"}
              </p>
            </>
          )}
        </div>

        {!editing && (
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            {confirming ? (
              <>
                <button
                  onClick={onDelete}
                  className="flex h-6 items-center gap-1 rounded-sm bg-danger-soft px-2 text-caption font-medium text-danger"
                >
                  <Check size={11} strokeWidth={2} /> Supprimer
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  aria-label="Annuler"
                  className="flex size-6 items-center justify-center rounded-sm text-text-subtle hover:bg-surface-2 hover:text-text"
                >
                  <X size={12} strokeWidth={1.75} />
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => {
                    setDraft(note.text);
                    setEditing(true);
                  }}
                  aria-label="Modifier"
                  className="flex size-6 items-center justify-center rounded-sm text-text-subtle hover:bg-surface-2 hover:text-text"
                >
                  <Pencil size={12} strokeWidth={1.75} />
                </button>
                <button
                  onClick={() => setConfirming(true)}
                  aria-label="Supprimer"
                  className="flex size-6 items-center justify-center rounded-sm text-text-subtle hover:bg-danger-soft hover:text-danger"
                >
                  <Trash2 size={12} strokeWidth={1.75} />
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export default function MemoryModule() {
  const [settings, setSettings] = useState<MemorySettings | null>(null);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [draftProject, setDraftProject] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewProject, setPreviewProject] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null | undefined>(undefined);

  const reload = useCallback(async () => {
    try {
      const [nextSettings, nextNotes] = await Promise.all([memoryApi.getSettings(), memoryApi.listNotes()]);
      setSettings(nextSettings);
      setNotes(nextNotes);
      setError(null);
    } catch (e) {
      setError(message(e));
      setNotes((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!previewOpen) return;
    setPreview(undefined);
    memoryApi
      .previewContext(previewProject)
      .then(setPreview)
      .catch((e: unknown) => setError(message(e)));
  }, [previewOpen, previewProject, notes]);

  const activeCount = useMemo(() => notes?.filter((note) => note.enabled).length ?? 0, [notes]);

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      await reload();
    } catch (e) {
      setError(message(e));
    }
  };

  const addNote = () =>
    run(async () => {
      if (!draft.trim()) return;
      await memoryApi.addNote(draft.trim(), draftProject);
      setDraft("");
    });

  if (!settings && !error) {
    return (
      <div className="flex h-full items-center justify-center text-text-subtle">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[860px] px-8 py-8">
      <SectionHeader
        title="Mémoire"
        description="Ce que vous voulez que les IA sachent : préférences, conventions, contexte d'un projet. Les informations actives sont transmises au début de chaque nouvelle conversation. Tout reste sur ce poste."
      />

      {error && <p className="pb-4 text-footnote text-danger">{error}</p>}

      {settings && (
        <div className="mb-6 flex items-center gap-3 rounded-md border border-border bg-surface-1 p-3">
          <Switch
            checked={settings.inject}
            label="Transmettre la mémoire aux IA"
            onChange={(inject) => {
              const next = { ...settings, inject };
              setSettings(next);
              void memoryApi.setSettings(next).catch((e: unknown) => setError(message(e)));
            }}
          />
          <div className="min-w-0 flex-1">
            <p className="text-body-sm font-medium text-text">Transmettre la mémoire aux IA</p>
            <p className="text-footnote text-text-muted">
              {settings.inject
                ? `${activeCount} information${activeCount > 1 ? "s" : ""} active${activeCount > 1 ? "s" : ""}, ajoutée${activeCount > 1 ? "s" : ""} au premier message (Chat et Code).`
                : "Désactivé : aucune information n'est envoyée."}
            </p>
          </div>
          <Button size="sm" variant={previewOpen ? "secondary" : "ghost"} onClick={() => setPreviewOpen((v) => !v)}>
            <Eye size={13} strokeWidth={1.75} />
            Aperçu
          </Button>
        </div>
      )}

      {previewOpen && (
        <section className="mb-6 space-y-2">
          <div className="flex items-center gap-2">
            <p className="text-footnote text-text-muted">Ce que reçoit une IA dans :</p>
            <ScopePicker project={previewProject} onChange={setPreviewProject} />
          </div>
          {preview === undefined ? (
            <Loader2 size={16} className="animate-spin text-text-subtle" />
          ) : preview ? (
            <pre className="selectable overflow-x-auto whitespace-pre-wrap rounded-md border border-border bg-surface-1 p-4 font-mono text-footnote text-text-muted">
              {preview}
            </pre>
          ) : (
            <p className="text-footnote text-text-subtle">Rien : aucune information active pour ce contexte.</p>
          )}
        </section>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void addNote();
        }}
        className="mb-4 space-y-2 rounded-md border border-border bg-surface-1 p-3 focus-within:border-border-strong"
      >
        <textarea
          value={draft}
          rows={3}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void addNote();
            }
          }}
          placeholder="Ex. : Réponds toujours en français. Ce projet utilise pnpm et Tauri 2."
          aria-label="Nouvelle information"
          className="selectable w-full resize-y bg-transparent text-body-sm text-text outline-none placeholder:text-text-subtle"
        />
        <div className="flex items-center gap-2">
          <ScopePicker project={draftProject} onChange={setDraftProject} />
          <Button type="submit" size="sm" variant="primary" className="ml-auto" disabled={!draft.trim()}>
            <Plus size={13} strokeWidth={2} />
            Ajouter
          </Button>
        </div>
      </form>

      {notes && notes.length === 0 ? (
        <EmptyState
          icon={<Brain size={28} strokeWidth={1.5} />}
          title="Aucune information"
          description="Ajoutez ce que les IA doivent savoir. Chaque information peut être activée ou mise de côté."
        />
      ) : (
        <ul className="space-y-2">
          {notes?.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              onPatch={(patch) => void run(() => memoryApi.updateNote(note.id, patch))}
              onDelete={() => void run(() => memoryApi.deleteNote(note.id))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
