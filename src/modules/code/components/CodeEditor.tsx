import { FileCode2, Lock } from "lucide-react";
import { CodeEditor as Editor } from "@/core/editor";
import { EmptyState } from "@/design-system/primitives";
import type { FileContent } from "../api";

type Props = {
  file: FileContent | null;
  /** Contenu en cours d'édition (peut différer du fichier sur disque). */
  value?: string;
  onChange?: (content: string) => void;
  onSave?: () => void;
  readOnly?: boolean;
  /** Ligne à montrer (résultat de recherche) ; `nonce` change à chaque demande. */
  reveal?: { line: number; nonce: number } | null;
};

/** Éditeur du module : l'éditeur partagé (`@/core/editor`), avec les états vide et binaire. */
export function CodeEditor({ file, value, onChange, onSave, readOnly = true, reveal }: Props) {
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
    <Editor
      language={file.language}
      value={value ?? file.content}
      onChange={onChange}
      onSave={onSave}
      readOnly={readOnly}
      reveal={reveal}
    />
  );
}
