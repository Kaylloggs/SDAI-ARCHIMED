import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { loadLanguage, type LanguageName } from "@uiw/codemirror-extensions-langs";
import { FileCode2, Lock } from "lucide-react";
import { EmptyState } from "@/design-system/primitives";
import type { FileContent } from "../api";

/**
 * Thème CodeMirror branché sur les tokens de l'application (design.md §7.3.bis).
 * Passé en prop `theme` : sans cela, @uiw/react-codemirror applique son thème
 * clair par défaut (fond blanc) quel que soit le preset choisi.
 */
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
  ".cm-activeLine": {
    backgroundColor: "color-mix(in oklab, var(--color-surface-2) 55%, transparent)",
  },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--color-text-muted)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "color-mix(in oklab, var(--color-accent) 28%, transparent) !important",
  },
  ".cm-selectionMatch": { backgroundColor: "var(--color-accent-soft)" },
  ".cm-matchingBracket": {
    backgroundColor: "var(--color-accent-soft)",
    outline: "1px solid color-mix(in oklab, var(--color-accent) 50%, transparent)",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-accent)" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.55" },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--color-surface-2)",
    border: "1px solid var(--color-border)",
    color: "var(--color-text-muted)",
  },
  ".cm-searchMatch": { backgroundColor: "var(--color-warning-soft)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--color-accent-soft)" },
  ".cm-panels": {
    backgroundColor: "var(--color-surface-1)",
    color: "var(--color-text)",
    borderColor: "var(--color-border)",
  },
  ".cm-panel input, .cm-panel button": {
    backgroundColor: "var(--color-surface-2)",
    color: "var(--color-text)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-xs)",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--color-surface-3)",
    color: "var(--color-text)",
    border: "1px solid var(--color-border-strong)",
  },
  "&.cm-focused": { outline: "none" },
});

/** Couleurs syntaxiques = tokens `--color-syntax-*` (tokens.css), donc suivent le preset. */
const archimedHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.modifier], color: "var(--color-syntax-keyword)" },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], color: "var(--color-syntax-string)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--color-syntax-number)" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "var(--color-syntax-comment)", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: "var(--color-syntax-function)" },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], color: "var(--color-syntax-type)" },
  { tag: [t.tagName, t.angleBracket], color: "var(--color-syntax-tag)" },
  { tag: [t.attributeName], color: "var(--color-syntax-attribute)" },
  { tag: [t.propertyName], color: "var(--color-syntax-property)" },
  { tag: [t.variableName, t.self], color: "var(--color-syntax-variable)" },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: "var(--color-syntax-operator)" },
  { tag: [t.heading], color: "var(--color-syntax-keyword)", fontWeight: "600" },
  { tag: [t.link, t.url], color: "var(--color-syntax-function)", textDecoration: "underline" },
  { tag: [t.emphasis], fontStyle: "italic" },
  { tag: [t.strong], fontWeight: "600" },
  { tag: [t.invalid], color: "var(--color-syntax-invalid)" },
  { tag: [t.meta, t.processingInstruction], color: "var(--color-syntax-comment)" },
]);

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
  /** Contenu en cours d'édition (peut différer du fichier sur disque). */
  value?: string;
  onChange?: (content: string) => void;
  onSave?: () => void;
  readOnly?: boolean;
};

export function CodeEditor({ file, value, onChange, onSave, readOnly = true }: Props) {
  const extensions = useMemo(() => {
    const name = file ? LANGUAGE_MAP[file.language] : undefined;
    const language = name ? loadLanguage(name) : null;
    return [
      syntaxHighlighting(archimedHighlight),
      EditorView.lineWrapping,
      keymap.of([
        {
          key: "Mod-s",
          preventDefault: true,
          run: () => {
            onSave?.();
            return true;
          },
        },
      ]),
      ...(language ? [language] : []),
    ];
  }, [file, onSave]);

  if (!file) {
    return (
      <EmptyState
        icon={<FileCode2 size={28} strokeWidth={1.5} />}
        title="Aucun fichier ouvert"
        description="Choisissez un fichier dans l'arborescence (ou Ctrl+P), ou glissez-le vers l'assistant pour demander une modification."
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
        value={value ?? file.content}
        theme={archimedTheme}
        extensions={extensions}
        editable={!readOnly}
        readOnly={readOnly}
        onChange={onChange}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: !readOnly,
          highlightActiveLineGutter: !readOnly,
          autocompletion: false,
          searchKeymap: true,
          syntaxHighlighting: false,
        }}
        height="100%"
        style={{ height: "100%" }}
      />
    </div>
  );
}
