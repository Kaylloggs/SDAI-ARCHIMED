import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Brain, Check } from "lucide-react";
import type { SlotContext } from "@/core/modules";
import { cn } from "@/core/lib/cn";
import { Button } from "@/design-system/primitives";
import { popIn } from "@/design-system/motion";
import { memoryApi } from "../api";

/** Premier paragraphe utile du message, sans balisage markdown. */
function suggestion(text: string): string {
  const paragraph =
    text
      .split(/\n{2,}/)
      .map((part) => part.replace(/[#>*_`]/g, "").trim())
      .find((part) => part.length > 20) ?? text.trim();
  return paragraph.length > 280 ? `${paragraph.slice(0, 277)}…` : paragraph;
}

/** « Mémoriser » sous un message de l'assistant (slot `chat.message.actions`). */
export default function RememberAction({ text = "", cwd = null }: SlotContext) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [scope, setScope] = useState<"project" | "global">(cwd ? "project" : "global");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  if (!text.trim()) return null;

  const save = async () => {
    if (!draft.trim()) return;
    setError(null);
    try {
      await memoryApi.addNote(draft.trim(), scope === "project" ? cwd : null, "message");
      setSaved(true);
      setOpen(false);
    } catch (e) {
      setError((e as { message?: string }).message ?? "Enregistrement impossible");
    }
  };

  return (
    <div ref={container} className="relative">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setDraft(suggestion(text));
          setSaved(false);
          setOpen((value) => !value);
        }}
      >
        {saved ? <Check size={13} strokeWidth={2} className="text-success" /> : <Brain size={13} strokeWidth={1.75} />}
        {saved ? "Mémorisé" : "Mémoriser"}
      </Button>

      <AnimatePresence>
        {open && (
          <motion.div
            variants={popIn}
            initial="hidden"
            animate="visible"
            exit="hidden"
            className="glass absolute bottom-full left-0 z-30 mb-2 w-96 space-y-2 rounded-md p-3"
          >
            <p className="text-footnote font-medium text-text">Ajouter à la mémoire</p>
            <textarea
              autoFocus
              rows={4}
              value={draft}
              aria-label="Texte à mémoriser"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void save();
                if (event.key === "Escape") setOpen(false);
              }}
              className="selectable w-full resize-none rounded-sm border border-border bg-surface-1 p-2 text-body-sm text-text outline-none focus:border-border-strong"
            />
            <div className="flex items-center gap-2">
              <div role="group" aria-label="Portée" className="flex rounded-sm border border-border bg-surface-1 p-0.5">
                {(
                  [
                    { id: "project", label: "Ce projet", disabled: !cwd },
                    { id: "global", label: "Partout", disabled: false },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.id}
                    disabled={option.disabled}
                    aria-pressed={scope === option.id}
                    onClick={() => setScope(option.id)}
                    className={cn(
                      "h-6 rounded-xs px-2 text-caption transition-colors disabled:opacity-40",
                      scope === option.id ? "bg-surface-3 text-text" : "text-text-subtle hover:text-text",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <Button size="sm" variant="primary" className="ml-auto" disabled={!draft.trim()} onClick={() => void save()}>
                Enregistrer
              </Button>
            </div>
            {error && <p className="text-caption text-danger">{error}</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
