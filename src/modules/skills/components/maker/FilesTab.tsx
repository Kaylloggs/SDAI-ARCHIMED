import { useCallback, useEffect, useRef, useState } from "react";
import { FileCode2, FileText, FolderOpen, Save } from "lucide-react";
import { CodeEditor, languageOfPath } from "@/core/editor";
import { engineApi } from "@/core/engine/engine.api";
import { cn } from "@/core/lib/cn";
import { Button, EmptyState } from "@/design-system/primitives";
import { errorText, skillsApi, type DraftFile, type DraftInfo } from "../../api";
import { formatSize } from "./ui";

export type FileFocus = { path: string; line: number; nonce: number };

type Props = {
  draft: DraftInfo;
  files: DraftFile[];
  revision: number;
  focus: FileFocus | null;
  onChanged: () => void;
};

const isCode = (path: string) => /\.(py|ps1|psm1|sh|bat|cmd|js|mjs|ts)$/i.test(path);

/** Fichiers du skill : liste, lecture et retouche à la main (Ctrl+S enregistre). */
export function FilesTab({ draft, files, revision, focus, onChanged }: Props) {
  const [path, setPath] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [saved, setSaved] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const loadedFor = useRef<string | null>(null);

  const current = path && files.some((f) => f.path === path) ? path : (files.find((f) => f.path === "SKILL.md")?.path ?? files[0]?.path ?? null);
  const dirty = content !== saved;

  useEffect(() => {
    if (focus && files.some((f) => f.path === focus.path)) setPath(focus.path);
  }, [focus, files]);

  const load = useCallback(
    async (target: string) => {
      try {
        const text = (await skillsApi.draftRead(draft.id, `skill/${target}`)) ?? "";
        setContent(text);
        setSaved(text);
        setError(null);
      } catch (e) {
        setContent("");
        setSaved("");
        setError(errorText(e));
      }
    },
    [draft.id],
  );

  // Changement de fichier : lecture. Fin de tour de l'IA : relecture, sauf retouche en cours.
  useEffect(() => {
    if (!current) return;
    const key = `${draft.id}:${current}`;
    if (loadedFor.current !== key) {
      loadedFor.current = key;
      void load(current);
    } else if (!dirty) {
      void load(current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, draft.id, revision, load]);

  const save = async () => {
    if (!current || !dirty) return;
    setSaving(true);
    try {
      await skillsApi.draftWrite(draft.id, `skill/${current}`, content);
      setSaved(content);
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  if (files.length === 0) {
    return (
      <EmptyState
        icon={<FileText size={24} strokeWidth={1.5} />}
        title="Aucun fichier pour l'instant"
        description="Les fichiers du skill apparaissent ici dès que l'IA de l'atelier les écrit."
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 pb-1 pt-2">
        <p className="text-footnote text-text-subtle">
          {files.length} fichier{files.length > 1 ? "s" : ""}
        </p>
        <span className="ml-auto" />
        <Button size="sm" variant="ghost" onClick={() => void engineApi.openPath(draft.skillPath)} icon={<FolderOpen size={13} strokeWidth={1.75} />}>
          Ouvrir le dossier
        </Button>
      </div>
      <ul aria-label="Fichiers du skill" className="max-h-40 shrink-0 overflow-y-auto border-b border-border px-1.5 pb-1.5">
        {files.map((file) => {
          const Icon = isCode(file.path) ? FileCode2 : FileText;
          return (
            <li key={file.path}>
              <button
                type="button"
                aria-current={file.path === current}
                onClick={() => setPath(file.path)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-footnote transition-colors",
                  file.path === current ? "bg-surface-3 text-text" : "text-text-muted hover:bg-surface-2 hover:text-text",
                )}
              >
                <Icon size={13} strokeWidth={1.75} className="shrink-0 text-text-subtle" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
                <span className="shrink-0 tabular-nums text-text-subtle">{formatSize(file.size)}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {current && (
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3">
          <span className="min-w-0 flex-1 truncate font-mono text-footnote text-text-muted" title={current}>
            {current}
          </span>
          {dirty && <span className="shrink-0 text-caption text-warning">non enregistré</span>}
          <Button
            size="sm"
            variant="ghost"
            disabled={!dirty || saving}
            onClick={() => void save()}
            title="Enregistrer (Ctrl+S)"
            icon={<Save size={13} strokeWidth={1.75} />}
          >
            Enregistrer
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {error ? (
          <p className="px-3 py-4 text-footnote text-text-muted">{error}</p>
        ) : current ? (
          <CodeEditor
            key={`${draft.id}:${current}`}
            language={languageOfPath(current)}
            value={content}
            readOnly={false}
            onChange={setContent}
            onSave={() => void save()}
            reveal={focus && focus.path === current ? { line: focus.line, nonce: focus.nonce } : null}
          />
        ) : null}
      </div>
    </div>
  );
}
