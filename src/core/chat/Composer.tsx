import { useCallback, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowUp,
  Bot,
  FileCode2,
  FolderOpen,
  Paperclip,
  Sparkles,
  TerminalSquare,
  X,
} from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Slot } from "@/core/modules";
import type { AdapterInfo, AutoMode } from "@/core/engine/types";
import { Button, Kbd, Select } from "@/design-system/primitives";
import { useUiStore } from "@/core/stores/ui.store";
import { FILE_DRAG_TYPE, useOsFileDrop } from "./useOsFileDrop";
import { useDropTarget } from "@/core/dnd";

const AUTO_LABELS: Record<AutoMode, string> = {
  off: "Validation manuelle",
  smart: "Auto intelligent",
  full: "Auto complet",
};

export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

type Props = {
  adapters: AdapterInfo[];
  adapterId: string;
  model: string | null;
  autoMode: AutoMode;
  busy: boolean;
  /** L'agent ne peut plus changer une fois la conversation démarrée. */
  locked: boolean;
  /** Dossier de travail : masqué si `onCwdChange` est absent. */
  cwd?: string | null;
  onCwdChange?: (cwd: string) => void;
  /** Fichiers désignés pour modification (glissés depuis l'arbre du module Code). */
  targets?: string[];
  onTargetsChange?: (targets: string[]) => void;
  compact?: boolean;
  onAdapterChange: (id: string) => void;
  onModelChange: (model: string) => void;
  onAutoModeChange: (mode: AutoMode) => void;
  onSend: (text: string, attachments: string[], targets: string[]) => void;
};

export function Composer({
  adapters,
  adapterId,
  model,
  autoMode,
  busy,
  locked,
  cwd,
  onCwdChange,
  targets = [],
  onTargetsChange,
  compact = false,
  onAdapterChange,
  onModelChange,
  onAutoModeChange,
  onSend,
}: Props) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const toggleRawTerminal = useUiStore((s) => s.toggleRawTerminal);
  const adapter = adapters.find((a) => a.id === adapterId);

  const addAttachments = useCallback((paths: string[]) => {
    setAttachments((current) => [...new Set([...current, ...paths])]);
  }, []);

  const osDragging = useOsFileDrop(addAttachments);

  /** Contributions du slot `chat.composer.actions` (ex. skill choisi). */
  const insertText = useCallback((snippet: string) => {
    setText((current) => (current.startsWith(snippet) ? current : `${snippet}${current}`));
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, compact ? 160 : 240)}px`;
    });
  }, [compact]);

  // Fichier glissé depuis l'arborescence du module Code → cible de modification.
  const fileDrop = useDropTarget(onTargetsChange ? [FILE_DRAG_TYPE] : [], (item) => {
    onTargetsChange?.([...new Set([...targets, item.payload])]);
  });
  const dropHover = fileDrop.isOver;

  const submit = () => {
    const value = text.trim();
    if (!value || busy) return;
    onSend(value, attachments, targets);
    setText("");
    setAttachments([]);
    onTargetsChange?.([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const pickFolder = async () => {
    const selected = await open({
      directory: true,
      title: "Dossier de travail de la conversation",
      defaultPath: cwd ?? undefined,
    });
    if (typeof selected === "string") onCwdChange?.(selected);
  };

  const pickAttachments = async () => {
    const selected = await open({
      multiple: true,
      title: "Ajouter des fichiers au prompt",
      filters: [
        { name: "Tous les fichiers", extensions: ["*"] },
        { name: "Documents", extensions: ["pdf", "md", "txt", "docx", "csv", "xlsx"] },
        { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg"] },
      ],
    });
    const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
    if (paths.length > 0) addAttachments(paths);
  };

  const chips = [
    ...targets.map((path) => ({ path, kind: "target" as const })),
    ...attachments.map((path) => ({ path, kind: "attachment" as const })),
  ];

  return (
    <div className={cn("mx-auto w-full px-6 pb-4", compact ? "max-w-full px-3" : "max-w-[var(--spacing-column)]")}>
      <div
        {...fileDrop.props}
        className={cn(
          "glass rounded-xl px-3 pb-2 pt-3 transition-shadow",
          autoMode === "full" && "ring-1 ring-warning/60",
          (dropHover || osDragging) && "ring-2 ring-accent",
        )}
      >
        {(dropHover || osDragging) && (
          <p className="pb-2 text-center text-footnote text-accent">
            {dropHover ? "Déposer pour cibler ce fichier" : "Déposer pour joindre les fichiers"}
          </p>
        )}

        {chips.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 pb-2">
            {chips.map(({ path, kind }) => (
              <li
                key={`${kind}:${path}`}
                title={path}
                className={cn(
                  "flex max-w-64 items-center gap-1.5 rounded-xs border px-1.5 py-0.5 text-caption",
                  kind === "target"
                    ? "border-accent/40 bg-accent-soft text-accent"
                    : "border-border bg-surface-2 text-text-muted",
                )}
              >
                {kind === "target" ? (
                  <FileCode2 size={11} strokeWidth={1.75} className="shrink-0" />
                ) : (
                  <Paperclip size={11} strokeWidth={1.75} className="shrink-0" />
                )}
                <span className="truncate">{baseName(path)}</span>
                <button
                  aria-label={`Retirer ${path}`}
                  onClick={() =>
                    kind === "target"
                      ? onTargetsChange?.(targets.filter((p) => p !== path))
                      : setAttachments((c) => c.filter((p) => p !== path))
                  }
                  className="shrink-0 text-text-subtle hover:text-danger"
                >
                  <X size={11} strokeWidth={2} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <textarea
          ref={textareaRef}
          value={text}
          rows={1}
          placeholder={`Écrire à ${adapter?.name ?? "l'agent"}…`}
          onChange={(event) => {
            setText(event.target.value);
            const el = event.target;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, compact ? 160 : 240)}px`;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          className="selectable max-h-60 w-full resize-none bg-transparent px-1 text-message text-text outline-none placeholder:text-text-subtle"
        />

        {/* Une seule ligne : outils à gauche (rétrécissables), Mode Auto et envoi à droite. */}
        <div className={cn("flex items-center gap-2 pt-2", compact && "flex-wrap")}>
          <div className={cn("flex min-w-0 flex-1 items-center gap-2", compact && "flex-wrap")}>
          <Select
            label="Agent"
            value={adapterId}
            disabled={locked}
            title={locked ? "L'agent est fixé une fois la conversation démarrée" : "Agent"}
            icon={<Bot size={13} strokeWidth={1.75} className="shrink-0 text-text-subtle" />}
            onChange={onAdapterChange}
            options={adapters.map((a) => ({
              value: a.id,
              label: a.name,
              disabled: !a.installed,
              hint: a.installed ? undefined : "non installé",
            }))}
          />

          {adapter && adapter.models.length > 0 && (
            <Select
              label="Modèle"
              value={model ?? adapter.defaultModel ?? ""}
              onChange={onModelChange}
              className="min-w-0 max-w-48"
              options={adapter.models.map((m) => ({ value: m.id, label: m.label }))}
            />
          )}

          {onCwdChange && (
            <button
              onClick={() => void pickFolder()}
              title={cwd ?? "Choisir le dossier de travail"}
              className="flex h-7 min-w-0 max-w-52 items-center gap-1.5 rounded-sm border border-border bg-surface-1 px-2 text-footnote text-text-muted hover:text-text"
            >
              <FolderOpen size={13} strokeWidth={1.75} className="shrink-0" />
              <span className="truncate">{cwd ? baseName(cwd) : "dossier par défaut"}</span>
            </button>
          )}

          <button
            onClick={() => void pickAttachments()}
            title="Ajouter des fichiers (PDF, images, documents…)"
            aria-label="Ajouter des fichiers"
            className="flex size-7 items-center justify-center rounded-sm text-text-subtle hover:bg-surface-2 hover:text-text"
          >
            <Paperclip size={14} strokeWidth={1.75} />
          </button>

          <Slot name="chat.composer.actions" props={{ cwd, adapter: adapterId, insertText }} />

          {!compact && (
            <button
              onClick={toggleRawTerminal}
              title="Terminal brut"
              aria-label="Terminal brut"
              className="flex size-7 items-center justify-center rounded-sm text-text-subtle hover:bg-surface-2 hover:text-text"
            >
              <TerminalSquare size={14} strokeWidth={1.75} />
            </button>
          )}
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button
              onClick={() =>
                onAutoModeChange(autoMode === "off" ? "smart" : autoMode === "smart" ? "full" : "off")
              }
              title="Mode Auto"
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-sm border px-2 text-footnote transition-colors",
                autoMode === "off" && "border-border text-text-subtle hover:text-text-muted",
                autoMode === "smart" && "border-transparent bg-accent-soft text-accent",
                autoMode === "full" && "border-transparent bg-warning-soft text-warning",
              )}
            >
              <Sparkles size={13} strokeWidth={1.75} />
              {compact ? AUTO_LABELS[autoMode].split(" ")[0] : AUTO_LABELS[autoMode]}
            </button>

            <Button variant="primary" size="sm" disabled={!text.trim() || busy} onClick={submit}>
              <ArrowUp size={14} strokeWidth={2} />
              {!compact && <Kbd>⏎</Kbd>}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
