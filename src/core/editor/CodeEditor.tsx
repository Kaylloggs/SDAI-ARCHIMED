import { useEffect, useMemo, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, keymap } from "@codemirror/view";
import { syntaxHighlighting } from "@codemirror/language";
import { languageExtension } from "./languages";
import { archimedHighlight, archimedTheme } from "./theme";

/** Ligne signalée dans la marge (erreur de validation, de compilation…). */
export type EditorMarker = {
  /** Numéro de ligne, à partir de 1. */
  line: number;
  severity: "error" | "warning";
  message: string;
};

const markerTheme = EditorView.theme({
  ".cm-marker-error": { backgroundColor: "color-mix(in oklab, var(--color-danger) 16%, transparent)" },
  ".cm-marker-warning": { backgroundColor: "color-mix(in oklab, var(--color-warning) 14%, transparent)" },
});

/** Lignes surlignées ; le message apparaît au survol. */
function markerDecorations(markers: EditorMarker[]) {
  return EditorView.decorations.compute([], (state) => {
    const builder = new RangeSetBuilder<Decoration>();
    const sorted = [...markers]
      .filter((marker) => marker.line >= 1 && marker.line <= state.doc.lines)
      .sort((a, b) => a.line - b.line);
    let previous = 0;
    for (const marker of sorted) {
      if (marker.line === previous) continue;
      previous = marker.line;
      const line = state.doc.line(marker.line);
      builder.add(
        line.from,
        line.from,
        Decoration.line({ attributes: { class: `cm-marker-${marker.severity}`, title: marker.message } }),
      );
    }
    return builder.finish();
  });
}

type Props = {
  /** Nom de langage (`java`, `json`, `groovy`…) ; `null` : texte brut. */
  language: string | null;
  value: string;
  onChange?: (content: string) => void;
  onSave?: () => void;
  readOnly?: boolean;
  markers?: EditorMarker[];
  /** Amène le curseur sur une ligne ; `nonce` change à chaque demande. */
  reveal?: { line: number; nonce: number } | null;
};

/**
 * Éditeur CodeMirror aux couleurs de l'application, partagé par les modules
 * (Code, Mod Studio). Ctrl+S appelle `onSave`.
 */
export function CodeEditor({ language, value, onChange, onSave, readOnly = true, markers, reveal }: Props) {
  const view = useRef<EditorView | null>(null);
  /** Demande reçue avant que CodeMirror n'ait créé sa vue (fichier juste ouvert). */
  const pendingReveal = useRef<number | null>(null);

  const revealLine = (current: EditorView, target: number) => {
    const doc = current.state.doc;
    const line = doc.line(Math.min(Math.max(1, target), doc.lines));
    current.dispatch({
      selection: { anchor: line.from, head: line.to },
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
    current.focus();
  };

  useEffect(() => {
    if (!reveal) return;
    if (view.current) revealLine(view.current, reveal.line);
    else pendingReveal.current = reveal.line;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.nonce]);

  const extensions = useMemo(() => {
    const syntax = languageExtension(language);
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
      ...(syntax ? [syntax] : []),
      ...(markers?.length ? [markerTheme, markerDecorations(markers)] : []),
    ];
  }, [language, onSave, markers]);

  return (
    <div className="h-full overflow-hidden">
      <CodeMirror
        value={value}
        theme={archimedTheme}
        extensions={extensions}
        editable={!readOnly}
        readOnly={readOnly}
        onChange={onChange}
        onCreateEditor={(created) => {
          view.current = created;
          const pending = pendingReveal.current;
          pendingReveal.current = null;
          // Après la première mise en page, sinon le défilement part de zéro.
          if (pending !== null) requestAnimationFrame(() => revealLine(created, pending));
        }}
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
