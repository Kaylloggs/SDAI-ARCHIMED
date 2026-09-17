import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Brain, Check, FolderOpen, Globe, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Badge, Button, EmptyState, SectionHeader } from "@/design-system/primitives";
import { memoryApi, type JournalEntry, type MemorySettings, type Note } from "./api";

type Tab = "notes" | "journal" | "preview";

const dateFormatter = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });
const formatDate = (seconds: number) => dateFormatter.format(new Date(seconds * 1000));
const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
const message = (error: unknown) => (error as { message?: string }).message ?? String(error);

const SOURCE_LABEL: Record<string, string> = { user: "vous", ai: "IA", message: "réponse" };

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 rounded-md border border-border bg-surface-1 p-3 text-left transition-colors hover:border-border-strong"
    >
      <span
        className={cn(
          "mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors",
          checked ? "bg-accent" : "bg-surface-3",
        )}
      >
        <span
          className={cn(
            "size-4 rounded-full bg-text shadow-sm transition-transform duration-150",
            checked ? "translate-x-4" : "translate-x-0",
          )}
        />
      </span>
      <span className="space-y-0.5">
        <span className="block text-body-sm font-medium text-text">{label}</span>
        <span className="block text-footnote text-text-muted">{description}</span>
      </span>
    </button>
  );
}

function NoteRow({ note, onChanged }: { note: Note; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.text);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(timer);
  }, [confirming]);

  const save = async () => {
    if (draft.trim() && draft.trim() !== note.text) await memoryApi.updateNote(note.id, draft.trim());
    setEditing(false);
    onChanged();
  };

  return (
    <li className="group rounded-md border border-border bg-surface-1 p-3">
      {editing ? (
        <div className="space-y-2">
          <textarea
            autoFocus
            rows={3}
            value={draft}
            aria-label="Modifier la note"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void save();
              if (event.key === "Escape") setEditing(false);
            }}
            className="selectable w-full resize-none rounded-sm border border-border-strong bg-surface-2 p-2 text-body-sm outline-none"
          />
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Annuler
            </Button>
            <Button size="sm" variant="primary" onClick={() => void save()}>
              Enregistrer
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <p className="selectable min-w-0 flex-1 whitespace-pre-wrap text-body-sm text-text">{note.text}</p>
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            {confirming ? (
              <button
                onClick={() => void memoryApi.deleteNote(note.id).then(onChanged)}
                className="flex h-6 items-center gap-1 rounded-sm bg-danger-soft px-2 text-caption font-medium text-danger"
              >
                <Check size={11} strokeWidth={2} /> Oublier
              </button>
            ) : (
              <>
                <button
                  onClick={() => {
                    setDraft(note.text);
                    setEditing(true);
                  }}
                  aria-label="Modifier la note"
                  className="flex size-6 items-center justify-center rounded-sm text-text-subtle hover:bg-surface-2 hover:text-text"
                >
                  <Pencil size={12} strokeWidth={1.75} />
                </button>
                <button
                  onClick={() => setConfirming(true)}
                  aria-label="Oublier la note"
                  className="flex size-6 items-center justify-center rounded-sm text-text-subtle hover:bg-danger-soft hover:text-danger"
                >
                  <Trash2 size={12} strokeWidth={1.75} />
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {!editing && (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-caption text-text-subtle">
          {note.project ? (
            <Badge tone="accent">
              <FolderOpen size={10} strokeWidth={1.75} />
              {folderName(note.project)}
            </Badge>
          ) : (
            <Badge tone="neutral">
              <Globe size={10} strokeWidth={1.75} />
              Partout
            </Badge>
          )}
          <span>
            {formatDate(note.createdAt)} · par {SOURCE_LABEL[note.source] ?? note.source}
          </span>
        </p>
      )}
    </li>
  );
}

export default function MemoryModule() {
  const [tab, setTab] = useState<Tab>("notes");
  const [settings, setSettings] = useState<MemorySettings | null>(null);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [journal, setJournal] = useState<JournalEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [draftGlobal, setDraftGlobal] = useState(false);
  const [preview, setPreview] = useState<string | null | undefined>(undefined);
  const [clearArmed, setClearArmed] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [nextSettings, nextNotes, nextJournal] = await Promise.all([
        memoryApi.getSettings(),
        memoryApi.listNotes(),
        memoryApi.journal(project, 100),
      ]);
      setSettings(nextSettings);
      setNotes(nextNotes);
      setJournal(nextJournal);
      setError(null);
    } catch (e) {
      setError(message(e));
      setNotes((current) => current ?? []);
      setJournal((current) => current ?? []);
    }
  }, [project]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (tab !== "preview") return;
    setPreview(undefined);
    memoryApi
      .previewContext(project)
      .then(setPreview)
      .catch((e: unknown) => setError(message(e)));
  }, [tab, project, notes, journal]);

  useEffect(() => {
    if (!clearArmed) return;
    const timer = setTimeout(() => setClearArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [clearArmed]);

  const visibleNotes = useMemo(() => {
    if (!notes) return [];
    if (!project) return notes;
    const root = project.replaceAll("\\", "/").toLowerCase();
    return notes.filter((note) => {
      if (!note.project) return true;
      const noteRoot = note.project.replaceAll("\\", "/").toLowerCase();
      return root === noteRoot || root.startsWith(`${noteRoot}/`) || noteRoot.startsWith(`${root}/`);
    });
  }, [notes, project]);

  const updateSettings = async (next: MemorySettings) => {
    setSettings(next);
    await memoryApi.setSettings(next).catch((e: unknown) => setError(message(e)));
  };

  const pickProject = async () => {
    const selected = await open({ directory: true, title: "Filtrer la mémoire sur un projet" });
    if (typeof selected === "string") setProject(selected);
  };

  const addNote = async () => {
    if (!draft.trim()) return;
    try {
      await memoryApi.addNote(draft.trim(), draftGlobal ? null : project, "user");
      setDraft("");
      await reload();
    } catch (e) {
      setError(message(e));
    }
  };

  if (!settings && !error) {
    return (
      <div className="flex h-full items-center justify-center text-text-subtle">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: "notes", label: "Notes", count: visibleNotes.length },
    { id: "journal", label: "Journal", count: journal?.length },
    { id: "preview", label: "Ce que l'IA reçoit" },
  ];

  return (
    <div className="mx-auto max-w-[960px] px-8 py-8">
      <SectionHeader
        title="Mémoire"
        description="ARCHIMED garde une trace du travail fait avec les IA et la leur rappelle au début de chaque nouvelle conversation. Tout reste sur ce poste."
        actions={
          <div className="flex items-center gap-1">
            <Button size="sm" variant="secondary" onClick={() => void pickProject()}>
              <FolderOpen size={13} strokeWidth={1.75} />
              {project ? folderName(project) : "Tous les projets"}
            </Button>
            {project && (
              <Button size="sm" variant="ghost" aria-label="Tous les projets" onClick={() => setProject(null)}>
                <X size={13} strokeWidth={1.75} />
              </Button>
            )}
          </div>
        }
      />

      {error && <p className="pb-4 text-footnote text-danger">{error}</p>}

      {settings && (
        <div className="grid gap-2 pb-6 sm:grid-cols-2">
          <Toggle
            checked={settings.inject}
            onChange={(inject) => void updateSettings({ ...settings, inject })}
            label="Rappeler la mémoire aux IA"
            description="Notes et derniers travaux du projet ajoutés au premier message d'une conversation."
          />
          <Toggle
            checked={settings.capture}
            onChange={(capture) => void updateSettings({ ...settings, capture })}
            label="Tenir le journal"
            description="Chaque réponse est résumée ; les lignes « 📌 Mémoire : » de l'IA deviennent des notes."
          />
        </div>
      )}

      <div role="tablist" aria-label="Sections" className="mb-4 flex gap-1 border-b border-border">
        {tabs.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={cn(
              "-mb-px flex h-9 items-center gap-1.5 border-b-2 px-3 text-body-sm transition-colors",
              tab === item.id ? "border-accent text-text" : "border-transparent text-text-subtle hover:text-text",
            )}
          >
            {item.label}
            {item.count !== undefined && <span className="text-caption text-text-subtle">{item.count}</span>}
          </button>
        ))}
      </div>

      {tab === "notes" && (
        <section className="space-y-3">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void addNote();
            }}
            className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 focus-within:border-border-strong"
          >
            <Plus size={14} strokeWidth={1.75} className="shrink-0 text-text-subtle" />
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={project ? `À retenir pour ${folderName(project)}…` : "À retenir partout (préférence, convention…)"}
              className="h-10 min-w-0 flex-1 bg-transparent text-body-sm outline-none placeholder:text-text-subtle"
            />
            {project && (
              <button
                type="button"
                aria-pressed={draftGlobal}
                onClick={() => setDraftGlobal((value) => !value)}
                className={cn(
                  "flex h-6 shrink-0 items-center gap-1 rounded-sm px-2 text-caption transition-colors",
                  draftGlobal ? "bg-surface-3 text-text" : "text-text-subtle hover:text-text",
                )}
              >
                <Globe size={11} strokeWidth={1.75} />
                Partout
              </button>
            )}
          </form>

          {visibleNotes.length === 0 ? (
            <EmptyState
              icon={<Brain size={28} strokeWidth={1.5} />}
              title="Aucune note"
              description="Ajoutez ce que les IA doivent toujours savoir, ou utilisez « Mémoriser » sous une réponse."
            />
          ) : (
            <ul className="space-y-2">
              {visibleNotes.map((note) => (
                <NoteRow key={note.id} note={note} onChanged={() => void reload()} />
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "journal" && (
        <section className="space-y-3">
          {(journal?.length ?? 0) > 0 && (
            <div className="flex justify-end">
              <Button
                size="sm"
                variant={clearArmed ? "danger" : "ghost"}
                onClick={() => {
                  if (!clearArmed) {
                    setClearArmed(true);
                    return;
                  }
                  setClearArmed(false);
                  void memoryApi.clearJournal().then(reload);
                }}
              >
                <Trash2 size={13} strokeWidth={1.75} />
                {clearArmed ? "Confirmer : vider le journal" : "Vider le journal"}
              </Button>
            </div>
          )}
          {journal?.length === 0 ? (
            <EmptyState
              icon={<Brain size={28} strokeWidth={1.5} />}
              title="Journal vide"
              description="Il se remplit à chaque réponse d'une IA, dans le Chat comme dans Code."
            />
          ) : (
            <ol className="space-y-2">
              {journal?.map((entry) => (
                <li key={`${entry.conversationId}-${entry.at}`} className="rounded-md border border-border bg-surface-1 p-3">
                  <p className="flex flex-wrap items-center gap-1.5 text-caption text-text-subtle">
                    <span>{formatDate(entry.at)}</span>
                    <Badge tone="neutral">{entry.adapter}</Badge>
                    {entry.project && (
                      <Badge tone="accent">
                        <FolderOpen size={10} strokeWidth={1.75} />
                        {folderName(entry.project)}
                      </Badge>
                    )}
                  </p>
                  {entry.request && <p className="mt-1.5 text-body-sm font-medium text-text">{entry.request}</p>}
                  {entry.outcome && (
                    <p className="selectable mt-1 line-clamp-3 whitespace-pre-wrap text-footnote text-text-muted">{entry.outcome}</p>
                  )}
                  {(entry.files.length > 0 || entry.commands.length > 0) && (
                    <p className="mt-1.5 text-caption text-text-subtle">
                      {entry.files.length > 0 && `${entry.files.length} fichier${entry.files.length > 1 ? "s" : ""} : ${entry.files.map(folderName).join(", ")}`}
                      {entry.files.length > 0 && entry.commands.length > 0 && " · "}
                      {entry.commands.length > 0 && `${entry.commands.length} commande${entry.commands.length > 1 ? "s" : ""}`}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {tab === "preview" && (
        <section className="space-y-2">
          <p className="text-footnote text-text-muted">
            Bloc ajouté au premier message d'une nouvelle conversation
            {project ? ` ouverte dans ${folderName(project)}` : " (sans dossier de projet)"}
            {settings && !settings.inject && " — actuellement désactivé"}.
          </p>
          {preview === undefined ? (
            <Loader2 size={16} className="animate-spin text-text-subtle" />
          ) : preview ? (
            <pre className="selectable overflow-x-auto whitespace-pre-wrap rounded-md border border-border bg-surface-1 p-4 font-mono text-footnote text-text-muted">
              {preview}
            </pre>
          ) : (
            <EmptyState
              icon={<Brain size={28} strokeWidth={1.5} />}
              title="Rien à rappeler"
              description="Aucune note ni aucun travail récent pour ce contexte."
            />
          )}
        </section>
      )}
    </div>
  );
}
