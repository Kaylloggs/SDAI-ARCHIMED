import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Eye, Pencil } from "lucide-react";
import { cn } from "@/core/lib/cn";

/**
 * Notes d'une carte, écrites en Markdown comme un fichier `.md`
 * (`**gras**`, `# titre`, listes, `- [ ]` cases, `code`, liens, tableaux).
 * L'aperçu s'affiche hors édition ; un clic dans le texte rouvre l'écriture.
 */
export function MarkdownNotes({ value, onChange }: { value: string; onChange: (notes: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onChange(draft);
  };

  return (
    <section className="space-y-1.5">
      <div className="flex items-center gap-2">
        <p className="text-caption font-medium text-text-subtle">Notes (Markdown)</p>
        <button
          onClick={() => {
            if (editing) commit();
            else {
              setDraft(value);
              setEditing(true);
            }
          }}
          className="ml-auto flex h-6 items-center gap-1 rounded-sm px-1.5 text-caption text-text-subtle transition-colors hover:bg-surface-2 hover:text-text"
        >
          {editing ? (
            <>
              <Eye size={11} strokeWidth={1.75} />
              Aperçu
            </>
          ) : (
            <>
              <Pencil size={11} strokeWidth={1.75} />
              Écrire
            </>
          )}
        </button>
      </div>

      {editing ? (
        <textarea
          autoFocus
          value={draft}
          rows={8}
          placeholder={"**Gras**, *italique*, `code`\n- liste\n- [ ] à faire\n[lien](https://…)"}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setDraft(value);
              setEditing(false);
            }
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) commit();
          }}
          className="selectable w-full resize-y rounded-md border border-border-strong bg-surface-1 px-2.5 py-2 font-mono text-body-sm outline-none placeholder:text-text-subtle"
        />
      ) : (
        <button
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
          className={cn(
            "selectable w-full rounded-md border border-border bg-surface-1 px-2.5 py-2 text-left text-body-sm transition-colors hover:border-border-strong",
            "[&_a]:text-accent [&_a]:underline [&_code]:rounded-xs [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:font-mono [&_code]:text-caption",
            "[&_h1]:text-body [&_h1]:font-semibold [&_h2]:text-body-sm [&_h2]:font-semibold [&_h3]:font-semibold",
            "[&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:py-0.5 [&_blockquote]:border-l-2 [&_blockquote]:border-border-strong [&_blockquote]:pl-2",
            "[&_table]:w-full [&_td]:border [&_td]:border-border [&_td]:px-1 [&_th]:border [&_th]:border-border [&_th]:px-1",
            !value && "text-text-subtle",
          )}
        >
          {value ? (
            <Markdown remarkPlugins={[remarkGfm]}>{value}</Markdown>
          ) : (
            "Détails, liens, décisions… (Markdown accepté)"
          )}
        </button>
      )}
    </section>
  );
}
