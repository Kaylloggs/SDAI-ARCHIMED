import { EditorView } from "@codemirror/view";
import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/**
 * Thème CodeMirror branché sur les tokens de l'application (design.md §7.3.bis).
 * Passé en prop `theme` : sans cela, @uiw/react-codemirror applique son thème
 * clair par défaut (fond blanc) quel que soit le preset choisi.
 */
export const archimedTheme = EditorView.theme({
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
export const archimedHighlight = HighlightStyle.define([
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
