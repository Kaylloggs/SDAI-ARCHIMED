import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { loadLanguage, type LanguageName } from "@uiw/codemirror-extensions-langs";
import { FileCode2, Lock } from "lucide-react";
import { EmptyState } from "@/design-system/primitives";
import type { FileContent } from "../api";

/** Thème CodeMirror branché sur les tokens de l'application (design.md §3). */
const archimedTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    color: "var(--color-text)",
    fontSize: "13px",
    height: "100%",
  },
  ".cm-content": {
    fontFamily: "var(--font-mono)",
    caretColor: "var(--color-accent)",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--color-text-subtle)",
    border: "none",
    borderRight: "1px solid var(--color-border)",
  },
  ".cm-activeLine": { backgroundColor: "color-mix(in oklab, var(--color-surface-2) 60%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--color-text-muted)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--color-accent-soft)",
  },
  ".cm-cursor": { borderLeftColor: "var(--color-accent)" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.55" },
  "&.cm-focused": { outline: "none" },
});

/** Correspondance langage backend → extension CodeMirror. */
const LANGUAGE_MAP: Record<string, LanguageName> = {
  typescript: "ts",
  tsx: "tsx",
  javascript: "js",
  jsx: "jsx",
  rust: "rs",
  python: "py",
  go: "go",
  java: "java",
  kotlin: "kt",
  swift: "swift",
  c: "c",
  cpp: "cpp",
  csharp: "cs",
  php: "php",
  ruby: "rb",
  shell: "sh",
  powershell: "ps1",
  sql: "sql",
  html: "html",
  css: "css",
  sass: "scss",
  json: "json",
  yaml: "yaml",
  toml: "toml",
  xml: "xml",
  markdown: "md",
  vue: "vue",
  svelte: "svelte",
  dart: "dart",
  lua: "lua",
  r: "r",
  elixir: "erl",
  zig: "rs",
  dockerfile: "sh",
  makefile: "sh",
};

type Props = {
  file: FileContent | null;
  onChange?: (content: string) => void;
  readOnly?: boolean;
};

export function CodeEditor({ file, onChange, readOnly = true }: Props) {
  const extensions = useMemo(() => {
    const name = file ? LANGUAGE_MAP[file.language] : undefined;
    const language = name ? loadLanguage(name) : null;
    return [archimedTheme, EditorView.lineWrapping, ...(language ? [language] : [])];
  }, [file]);

  if (!file) {
    return (
      <EmptyState
        icon={<FileCode2 size={28} strokeWidth={1.5} />}
        title="Aucun fichier ouvert"
        description="Choisissez un fichier dans l'arborescence, ou glissez-le vers le chat pour demander une modification."
      />
    );
  }

  if (file.binary) {
    return (
      <EmptyState
        icon={<Lock size={28} strokeWidth={1.5} />}
        title="Fichier binaire"
        description={`${file.path} ne peut pas être affiché comme du texte.`}
      />
    );
  }

  return (
    <div className="h-full overflow-hidden">
      <CodeMirror
        value={file.content}
        extensions={extensions}
        editable={!readOnly}
        readOnly={readOnly}
        onChange={onChange}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: !readOnly,
          autocompletion: false,
          searchKeymap: true,
        }}
        height="100%"
        style={{ height: "100%" }}
      />
    </div>
  );
}
