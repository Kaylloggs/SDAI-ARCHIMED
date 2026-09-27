import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Mic, Square } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { duration, ease, popIn } from "@/design-system/motion";
import { Tooltip } from "@/design-system/primitives";
import { busy, statusLabel, statusSentence, waveMode, type WaveMode } from "../lib/status";
import { shortcutLabel } from "../lib/shortcuts";
import { orchestrator } from "../runtime/instance";
import { useVoiceStore } from "../store";
import { VoicePanel } from "./VoicePanel";
import { VoiceWave } from "./VoiceWave";

const PANEL_WIDTH = 380;

/** Couleur de la vague : le laiton veut dire « micro ouvert », rien d'autre. */
const WAVE_TONE: Record<WaveMode, string> = {
  input: "text-accent",
  output: "text-text",
  busy: "text-text-muted",
  paused: "text-text-muted",
  error: "text-danger",
  rest: "text-text-subtle",
};

/**
 * Pastille vocale de la barre de titre, à côté de la recherche : état de l'assistant d'un coup
 * d'œil (vague), micro en un clic, conversation et contrôles dans le panneau.
 */
export default function VoicePill() {
  const status = useVoiceStore((s) => s.status);
  const micOn = useVoiceStore((s) => s.micOn);
  const tools = useVoiceStore((s) => s.tools);
  const confirmation = useVoiceStore((s) => s.confirmation);
  const error = useVoiceStore((s) => s.error);
  const open = useVoiceStore((s) => s.panelOpen);
  const overlay = useVoiceStore((s) => s.settings.overlay);
  const toggleKeys = useVoiceStore((s) => s.settings.shortcuts.toggle);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const voice = orchestrator();

  const tool = tools.at(-1) ?? null;
  // Pendant une réponse, la vague suit la voix ; mais si le micro est ouvert et que rien
  // d'autre ne se passe, elle suit le micro.
  const mode = waveMode(status);
  const tone = micOn && (mode === "input" || mode === "rest") ? "text-accent" : WAVE_TONE[mode];
  const label = statusLabel(micOn && status === "idle" ? "listening" : status, tool);
  const setOpen = useCallback((value: boolean) => useVoiceStore.getState().patch({ panelOpen: value }), []);

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => setRect(pillRef.current?.getBoundingClientRect() ?? null);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const inside = (target: EventTarget | null) =>
      target instanceof Node && (pillRef.current?.contains(target) || panelRef.current?.contains(target));
    const onPointerDown = (event: PointerEvent) => {
      if ((event.target as Element).closest?.("[role=listbox]")) return;
      if (!inside(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, setOpen]);

  const center = rect ? rect.left + rect.width / 2 : 0;
  const left = rect ? Math.max(8, Math.min(center - PANEL_WIDTH / 2, window.innerWidth - PANEL_WIDTH - 8)) : 0;
  const shortcut = shortcutLabel(toggleKeys).join(" + ");
  const showCaption = overlay.captions && !open && (status === "speaking" || status === "hearing");

  return (
    <>
      <div ref={pillRef} role="group" aria-label="Assistant vocal" className="glass-chrome relative flex shrink-0 items-center rounded-full p-0.5">
        <Tooltip label={micOn ? `Couper le micro (${shortcut})` : `Parler à ARCHIMED (${shortcut})`} side="bottom">
          <button
            type="button"
            aria-label={micOn ? "Couper le micro" : "Parler à ARCHIMED"}
            aria-pressed={micOn}
            onClick={() => void voice.toggle()}
            className={cn(
              "flex size-8 cursor-pointer items-center justify-center rounded-full transition-colors duration-[80ms]",
              micOn ? "bg-accent-soft text-accent hover:bg-accent-soft" : "text-text-muted hover:bg-surface-2 hover:text-text",
            )}
          >
            <Mic size={15} strokeWidth={1.75} />
          </button>
        </Tooltip>

        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`${statusSentence(status, tool)} Ouvrir la conversation vocale`}
          onClick={() => setOpen(!open)}
          className={cn(
            "flex h-8 cursor-pointer items-center gap-2 rounded-full pl-2 transition-colors duration-[80ms] hover:bg-surface-2",
            overlay.mini ? "pr-2" : "pr-3 max-lg:pr-2",
            open && "bg-surface-2",
          )}
        >
          <VoiceWave mode={micOn && mode === "rest" ? "input" : mode} animate={overlay.animations} className={tone} />
          {!overlay.mini && (
            // Fenêtre étroite : la pastille devient compacte, le titre du module garde sa place.
            <span className={cn("w-[88px] truncate text-left text-footnote font-medium max-lg:hidden", status === "error" ? "text-danger" : "text-text-muted")}>
              {label}
            </span>
          )}
        </button>

        {busy(status) && (
          <Tooltip label="Arrêter la réponse" side="bottom">
            <button
              type="button"
              aria-label="Arrêter la réponse"
              onClick={() => voice.cancel()}
              className="flex size-8 cursor-pointer items-center justify-center rounded-full text-text-muted transition-colors duration-[80ms] hover:bg-surface-2 hover:text-text"
            >
              <Square size={11} strokeWidth={2.25} />
            </button>
          </Tooltip>
        )}

        {confirmation && !open && (
          <span aria-hidden className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-warning ring-2 ring-[var(--color-bg)]" />
        )}
        {/* Annonces importantes pour les lecteurs d'écran, panneau fermé ou non. */}
        <span className="sr-only" role="status" aria-live="polite">
          {confirmation ? `Question de l'assistant : ${confirmation.question}` : (error ?? "")}
        </span>
      </div>

      {createPortal(
        <AnimatePresence>
          {open && rect && (
            <motion.div
              ref={panelRef}
              role="dialog"
              aria-label="Conversation vocale"
              variants={popIn}
              initial="hidden"
              animate="visible"
              exit="exit"
              style={{ position: "fixed", left, top: rect.bottom + 6, width: PANEL_WIDTH, transformOrigin: "top center" }}
              className="glass z-50 rounded-md p-3"
            >
              <VoicePanel onClose={() => setOpen(false)} />
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}

      <Caption visible={showCaption} anchor={pillRef} />
    </>
  );
}

/** Sous-titres sous la pastille, panneau fermé : ce que dit l'assistant, ou ce qu'il entend. */
function Caption({ visible, anchor }: { visible: boolean; anchor: React.RefObject<HTMLDivElement | null> }) {
  const caption = useVoiceStore((s) => s.caption);
  const partial = useVoiceStore((s) => s.partial);
  const text = caption || partial;
  const box = visible && text ? anchor.current?.getBoundingClientRect() : null;
  return createPortal(
    <AnimatePresence>
      {box && (
        <motion.div
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: duration.fast, ease: ease.standard }}
          style={{ position: "fixed", top: box.bottom + 8, left: box.left + box.width / 2, transform: "translateX(-50%)" }}
          className="glass pointer-events-none z-40 max-w-[min(520px,calc(100vw-32px))] rounded-md px-3 py-1.5"
        >
          <p className={cn("line-clamp-2 text-center text-body-sm", caption ? "text-text" : "italic text-text-muted")}>{text}</p>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
