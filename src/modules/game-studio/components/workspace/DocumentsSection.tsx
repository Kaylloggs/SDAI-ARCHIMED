import { useCallback, useEffect, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText, RefreshCw } from "lucide-react";
import { Button } from "@/design-system/primitives";
import type { GameDocuments } from "@/core/ipc/bindings/GameDocuments";
import { errorText, gameStudioApi } from "../../api";
import { useGameStudioStore } from "../../store";
import { ConfirmButton, ErrorLine, Segmented } from "../ui";

const components: Components = {
  h1: ({ children }) => <h1 className="pb-2 text-title-2 font-semibold">{children}</h1>,
  h2: ({ children }) => <h2 className="pb-1 pt-5 text-title-3 font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="pb-1 pt-3 text-body font-semibold">{children}</h3>,
  p: ({ children }) => <p className="pb-2 text-body-sm leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="list-disc space-y-0.5 pb-2 pl-5 text-body-sm">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-0.5 pb-2 pl-5 text-body-sm">{children}</ol>,
  blockquote: ({ children }) => <blockquote className="mb-3 border-l border-border-strong pl-3 text-footnote text-text-muted">{children}</blockquote>,
  code: ({ children }) => <code className="rounded-xs bg-surface-2 px-1 font-mono text-caption">{children}</code>,
  strong: ({ children }) => <strong className="font-semibold text-text">{children}</strong>,
};

/** GDD et TDD tirés du graphe : aperçu, puis écriture dans docs/ du projet. */
export function DocumentsSection() {
  const projectId = useGameStudioStore((s) => s.openId);
  const revision = useGameStudioStore((s) => s.current?.graph.revision ?? 0);
  const [docs, setDocs] = useState<GameDocuments | null>(null);
  const [tab, setTab] = useState<"gdd" | "tdd">("gdd");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setDocs(await gameStudioApi.documents(projectId));
    } catch (e) {
      setError(errorText(e));
    }
  }, [projectId]);

  // Le graphe change (agent, voix, autre section) : l'aperçu suit.
  useEffect(() => {
    void load();
  }, [load, revision]);

  if (!projectId) return null;

  const write = async () => {
    setError(null);
    try {
      const written = await gameStudioApi.writeDocuments(projectId);
      setNotice(written.length ? `Écrit : ${written.join(", ")} (point de restauration pris avant).` : "Les fichiers de docs/ sont déjà à jour.");
      void useGameStudioStore.getState().reload();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="max-w-[860px] space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Document"
          value={tab}
          onChange={setTab}
          options={[
            { value: "gdd", label: "Game design (GDD)" },
            { value: "tdd", label: "Technique (TDD)" },
          ]}
        />
        <span className="ml-auto" />
        <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} onClick={() => void load()}>
          Actualiser
        </Button>
        <ConfirmButton label="Écrire dans docs/" confirmLabel="Remplacer docs/GDD.md et docs/TDD.md" icon={<FileText size={13} />} onConfirm={() => void write()} />
      </div>
      <ErrorLine message={error} onClose={() => setError(null)} />
      {notice && <p className="rounded-md bg-success-soft px-3 py-2 text-footnote">{notice}</p>}
      <article className="rounded-lg border border-border bg-surface-1 px-6 py-5">
        {docs ? <Markdown remarkPlugins={[remarkGfm]} components={components}>{tab === "gdd" ? docs.gdd : docs.tdd}</Markdown> : <p className="text-footnote text-text-subtle">Rédaction…</p>}
      </article>
    </div>
  );
}
