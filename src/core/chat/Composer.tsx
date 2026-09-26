import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowUp,
  Bot,
  FileCode2,
  FolderOpen,
  Mic,
  Paperclip,
  Sparkles,
  Square,
  TerminalSquare,
  X,
} from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Slot } from "@/core/modules";
import type { AdapterInfo, AutoMode } from "@/core/engine/types";
import { Button, Kbd, Select, Tooltip } from "@/design-system/primitives";
import { useUiStore } from "@/core/stores/ui.store";
import { FILE_DRAG_TYPE, useOsFileDrop } from "./useOsFileDrop";
import { onPasteFiles } from "./paste";
import { useDictation } from "./useDictation";
import { useDropTarget } from "@/core/dnd";
import { EffortSlider } from "./EffortSlider";
import { resolveModel, switchModel } from "./models";

const AUTO_LABELS: Record<AutoMode, string> = {
  off: "Validation manuelle",
  smart: "Auto intelligent",
  full: "Auto complet",
};

export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

type Props = {
  /** Texte à déposer dans la zone de saisie (message préparé par un module). */
  prefill?: string;
  adapters: AdapterInfo[];
  adapterId: string;
  model: string | null;
  autoMode: AutoMode;
  busy: boolean;
  /** Une conversation est déjà engagée : changer d'agent repart d'un contexte vide. */
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
  /** L'agent réfléchit ou répond : le bouton d'envoi devient « Arrêter ». */
  running?: boolean;
  onStop?: () => void;
};

/** Cinq barres qui montent avec la voix : la preuve visuelle que le micro capte. */
function VoiceLevel({ level }: { level: number }) {
  return (
    <span className="flex h-3 shrink-0 items-end gap-px" aria-hidden>
      {[0.06, 0.16, 0.3, 0.16, 0.06].map((threshold, index) => (
        <span
          key={index}
          className="w-0.5 rounded-full bg-current transition-[height] duration-100"
          style={{
            height: `${Math.max(2, Math.min(12, (level / threshold) * 12))}px`,
            opacity: level > threshold * 0.25 ? 1 : 0.35,
          }}
        />
      ))}
    </span>
  );
}

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
  running = false,
  onStop,
  prefill,
}: Props) {
  const [text, setText] = useState("");
  /** Texte déjà saisi ou dicté avant la phrase en cours (la dictée ne réécrit que la fin). */
  const dictationBase = useRef("");
  /** Dernier texte reçu de l'extérieur : le même ne se réinjecte pas deux fois. */
  const lastPrefill = useRef<string | null>(null);
  const [attachments, setAttachments] = useState<string[]>([]);
  /** Collage de fichiers refusé (trop lourd, illisible). */
  const [pasteError, setPasteError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const toggleRawTerminal = useUiStore((s) => s.toggleRawTerminal);

  // Message préparé ailleurs (par exemple une candidature à faire relire) : il arrive dans
  // la zone de saisie, prêt à être modifié, jamais envoyé sans l'accord de la personne.
  useEffect(() => {
    if (!prefill || prefill === lastPrefill.current) return;
    lastPrefill.current = prefill;
    setText(prefill);
    dictationBase.current = prefill;
    requestAnimationFrame(() => {
      const field = textareaRef.current;
      if (!field) return;
      field.focus();
      field.setSelectionRange(prefill.length, prefill.length);
    });
  }, [prefill]);
  const adapter = adapters.find((a) => a.id === adapterId);
  /** Modèle affiché (nom réel) et son niveau d'effort, à partir de l'identifiant de la session. */
  const choice = adapter ? resolveModel(adapter.models, model, adapter.defaultModel) : null;

  const addAttachments = useCallback((paths: string[]) => {
    setAttachments((current) => [...new Set([...current, ...paths])]);
  }, []);

  const osDragging = useOsFileDrop(addAttachments);

  // Ctrl+V : fichiers copiés dans l'Explorateur ou image copiée ailleurs, joints au message.
  const onPaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      setPasteError(null);
      onPasteFiles(addAttachments, setPasteError)(event);
    },
    [addAttachments],
  );

  // Dictée locale : le texte provisoire remplace la fin du message, la phrase confirmée s'y ajoute.
  const dictation = useDictation(
    useCallback((spoken: string, final: boolean) => {
      setText(() => {
        const base = dictationBase.current;
        const separator = base && !base.endsWith(" ") ? " " : "";
        const next = `${base}${separator}${spoken}`;
        if (final) dictationBase.current = next;
        return next;
      });
      requestAnimationFrame(() => textareaRef.current?.focus());
    }, []),
  );

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
    dictationBase.current = "";
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

        {(dictation.recording || dictation.error) && (
          <p
            className={cn(
              "flex items-center gap-1.5 pb-2 text-footnote",
              dictation.error
                ? "text-danger"
                : dictation.warning
                  ? "text-warning"
                  : "text-text-muted",
            )}
          >
            {dictation.error ? (
              dictation.error
            ) : (
              <>
                <span className="relative flex size-2 shrink-0">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-danger opacity-60" />
                  <span className="relative inline-flex size-2 rounded-full bg-danger" />
                </span>
                <VoiceLevel level={dictation.level} />
                <span className="[overflow-wrap:anywhere]">
                  {dictation.warning ??
                    `Dictée en cours${dictation.device ? ` (${dictation.device})` : ""} — parlez, le texte s'écrit tout seul. Échap pour arrêter.`}
                </span>
              </>
            )}
          </p>
        )}

        {pasteError && (
          <p role="alert" className="pb-2 text-footnote text-danger">
            {pasteError}
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
          onPaste={onPaste}
          onChange={(event) => {
            setText(event.target.value);
            dictationBase.current = event.target.value;
            const el = event.target;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, compact ? 160 : 240)}px`;
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && dictation.recording) {
              event.preventDefault();
              dictation.toggle();
              return;
            }
            if (event.key === "Escape" && running && onStop) {
              event.preventDefault();
              onStop();
              return;
            }
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
            title={
              locked
                ? "Changer d'agent : le nouvel agent ne connaîtra pas les messages précédents"
                : "Agent"
            }
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
              value={choice?.model.id ?? ""}
              onChange={(id) => {
                const next = adapter.models.find((m) => m.id === id);
                if (next && next.id !== choice?.model.id) onModelChange(switchModel(next, choice?.effort ?? null));
              }}
              className="min-w-24 max-w-48"
              options={adapter.models.map((m) => ({
                value: m.id,
                label: m.label,
                // Un seul niveau (« Thinking »…) : pas de curseur, le niveau reste lisible ici.
                hint: m.efforts.length === 1 ? m.efforts[0]?.label : undefined,
              }))}
            />
          )}

          {choice && choice.model.efforts.length > 1 && (
            <EffortSlider
              efforts={choice.model.efforts}
              value={choice.effort}
              onChange={(effort) => onModelChange(effort.id)}
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

          <Tooltip
            side="bottom"
            label={
              dictation.error ? (
                <span className="text-danger">{dictation.error}</span>
              ) : dictation.recording ? (
                "Arrêter la dictée"
              ) : (
                `Dicter le message — reconnaissance vocale de Windows, aucun token${
                  dictation.device ? ` · micro : ${dictation.device}` : ""
                }`
              )
            }
          >
            <button
              onClick={dictation.toggle}
              aria-label={dictation.recording ? "Arrêter la dictée" : "Dicter le message"}
              aria-pressed={dictation.recording}
              className={cn(
                "flex size-7 items-center justify-center rounded-sm transition-colors",
                dictation.recording
                  ? "bg-danger-soft text-danger"
                  : dictation.error
                    ? "text-danger hover:bg-surface-2"
                    : "text-text-subtle hover:bg-surface-2 hover:text-text",
              )}
            >
              {dictation.recording ? (
                <span className="relative flex size-3.5 items-center justify-center">
                  <span
                    className="absolute inline-flex size-full rounded-full bg-danger transition-transform duration-100"
                    style={{
                      // Échelle pilotée par le niveau d'entrée : immobile = micro muet.
                      transform: `scale(${1 + Math.min(dictation.level * 6, 1.1)})`,
                      opacity: 0.25 + Math.min(dictation.level * 3, 0.45),
                    }}
                  />
                  <Mic size={14} strokeWidth={2} className="relative" />
                </span>
              ) : (
                <Mic size={14} strokeWidth={1.75} />
              )}
            </button>
          </Tooltip>

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

            {running && onStop ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={onStop}
                aria-label="Arrêter la réponse"
                title="Arrêter la réponse (Échap)"
                className="border-danger/40 text-danger hover:bg-danger-soft"
              >
                <Square size={11} strokeWidth={2.5} className="fill-current" />
                {!compact && "Arrêter"}
              </Button>
            ) : (
              <Button variant="primary" size="sm" disabled={!text.trim() || busy} onClick={submit}>
                <ArrowUp size={14} strokeWidth={2} />
                {!compact && <Kbd>⏎</Kbd>}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
