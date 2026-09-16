import { useRef, useState } from "react";
import { ArrowUp, Bot, ChevronDown, Sparkles, TerminalSquare } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Slot } from "@/core/modules";
import type { AdapterInfo, AutoMode } from "@/core/engine/types";
import { Button, Kbd } from "@/design-system/primitives";
import { useUiStore } from "@/core/stores/ui.store";

const AUTO_LABELS: Record<AutoMode, string> = {
  off: "Validation manuelle",
  smart: "Auto intelligent",
  full: "Auto complet",
};

type Props = {
  adapters: AdapterInfo[];
  adapterId: string;
  model: string | null;
  autoMode: AutoMode;
  busy: boolean;
  onAdapterChange: (id: string) => void;
  onModelChange: (model: string) => void;
  onAutoModeChange: (mode: AutoMode) => void;
  onSend: (text: string) => void;
};

export function Composer({
  adapters,
  adapterId,
  model,
  autoMode,
  busy,
  onAdapterChange,
  onModelChange,
  onAutoModeChange,
  onSend,
}: Props) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const toggleRawTerminal = useUiStore((s) => s.toggleRawTerminal);
  const adapter = adapters.find((a) => a.id === adapterId);

  const submit = () => {
    const value = text.trim();
    if (!value || busy) return;
    onSend(value);
    setText("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  return (
    <div className="mx-auto w-full max-w-[var(--spacing-column)] px-6 pb-4">
      <div
        className={cn(
          "glass rounded-xl px-3 pb-2 pt-3",
          autoMode === "full" && "ring-1 ring-warning/60",
        )}
      >
        <textarea
          ref={textareaRef}
          value={text}
          rows={1}
          placeholder={`Écrire à ${adapter?.name ?? "l'agent"}…`}
          onChange={(event) => {
            setText(event.target.value);
            const el = event.target;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          className="selectable max-h-60 w-full resize-none bg-transparent px-1 text-message text-text outline-none placeholder:text-text-subtle"
        />

        <div className="flex items-center gap-2 pt-2">
          <label className="sr-only" htmlFor="adapter">
            Agent
          </label>
          <div className="relative">
            <select
              id="adapter"
              value={adapterId}
              onChange={(event) => onAdapterChange(event.target.value)}
              className="h-7 appearance-none rounded-sm border border-border bg-surface-1 pl-6 pr-6 text-footnote text-text outline-none"
            >
              {adapters.map((a) => (
                <option key={a.id} value={a.id} disabled={!a.installed}>
                  {a.name}
                  {a.installed ? "" : " (non installé)"}
                </option>
              ))}
            </select>
            <Bot size={13} strokeWidth={1.75} className="pointer-events-none absolute left-1.5 top-1.5 text-text-subtle" />
            <ChevronDown size={12} className="pointer-events-none absolute right-1.5 top-2 text-text-subtle" />
          </div>

          {adapter && adapter.models.length > 0 && (
            <div className="relative">
              <select
                aria-label="Modèle"
                value={model ?? adapter.defaultModel ?? ""}
                onChange={(event) => onModelChange(event.target.value)}
                className="h-7 max-w-44 appearance-none truncate rounded-sm border border-border bg-surface-1 pl-2 pr-6 text-footnote text-text outline-none"
              >
                {adapter.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <ChevronDown size={12} className="pointer-events-none absolute right-1.5 top-2 text-text-subtle" />
            </div>
          )}

          <Slot name="chat.composer.actions" />

          <button
            onClick={toggleRawTerminal}
            title="Terminal brut (Ctrl+J)"
            className="flex size-7 items-center justify-center rounded-sm text-text-subtle hover:bg-surface-2 hover:text-text"
          >
            <TerminalSquare size={14} strokeWidth={1.75} />
          </button>

          <div className="ml-auto flex items-center gap-2">
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
              {AUTO_LABELS[autoMode]}
            </button>

            <Button variant="primary" size="sm" disabled={!text.trim() || busy} onClick={submit}>
              <ArrowUp size={14} strokeWidth={2} />
              <Kbd>⏎</Kbd>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
