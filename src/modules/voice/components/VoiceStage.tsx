import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Loader2, MessageSquareText, Mic, MicOff, Minimize2, Pause, Play, Settings2, Square, Wrench, X } from "lucide-react";
import { useSessionStore } from "@/core/engine/session.store";
import { cn } from "@/core/lib/cn";
import { useUiStore } from "@/core/stores/ui.store";
import { duration, ease } from "@/design-system/motion";
import { Kbd, Tooltip } from "@/design-system/primitives";
import { agentName } from "../lib/agents";
import { privacyRows } from "../lib/privacy";
import { shortcutLabel } from "../lib/shortcuts";
import { busy, statusSentence, waveMode } from "../lib/status";
import { orchestrator } from "../runtime/instance";
import { useVoiceStore, type Turn } from "../store";
import { Transcript } from "./Transcript";
import { VoiceAura } from "./VoiceAura";

/** Bouton rond de la barre de commandes (libellé lu par les lecteurs d'écran et en info-bulle). */
function RoundButton({
  label,
  onClick,
  children,
  size = "md",
  tone = "neutral",
  pressed,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  size?: "md" | "lg";
  tone?: "neutral" | "accent" | "danger";
  pressed?: boolean;
  disabled?: boolean;
}) {
  return (
    <Tooltip label={label} side="top" disabled={disabled}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "flex shrink-0 cursor-pointer items-center justify-center rounded-full transition-[background-color,color,transform,opacity] duration-[140ms] ease-standard",
          "active:scale-[0.96] disabled:pointer-events-none disabled:opacity-30 motion-reduce:active:scale-100",
          size === "lg" ? "size-16" : "size-11",
          tone === "accent" && "bg-accent text-accent-fg hover:bg-accent-hover",
          tone === "danger" && "bg-danger-soft text-danger hover:bg-danger hover:text-text",
          tone === "neutral" && "glass-chrome text-text hover:bg-surface-2",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

const lastOf = (turns: Turn[], role: Turn["role"]) => [...turns].reverse().find((t) => t.role === role) ?? null;

/**
 * Vue de conversation vocale, inspirée de Gemini Live : une lueur qui suit la voix, la phrase en
 * cours en grand, les commandes en bas. Couleurs et fond viennent du thème de l'application.
 * `overlay` : plein écran sous la barre de titre ; `page` : encadrée dans la page du module ;
 * `fill` : toute la place du module (liste des sections masquée). `leading` : bouton en tête
 * de l'en-tête (réafficher la liste des sections).
 */
export function VoiceStage({
  variant,
  onClose,
  leading,
}: {
  variant: "overlay" | "page" | "fill";
  onClose?: () => void;
  leading?: ReactNode;
}) {
  const status = useVoiceStore((s) => s.status);
  const micOn = useVoiceStore((s) => s.micOn);
  const session = useVoiceStore((s) => s.session);
  const settings = useVoiceStore((s) => s.settings);
  const partial = useVoiceStore((s) => s.partial);
  const caption = useVoiceStore((s) => s.caption);
  const tools = useVoiceStore((s) => s.tools);
  const error = useVoiceStore((s) => s.error);
  const confirmation = useVoiceStore((s) => s.confirmation);
  const [showTranscript, setShowTranscript] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const voice = orchestrator();

  const turns = session?.turns ?? [];
  const lastUser = lastOf(turns, "user");
  const lastReply = lastOf(turns, "assistant");
  const mode = micOn && waveMode(status) === "rest" ? "input" : waveMode(status);
  const tool = tools.at(-1) ?? null;
  const working = busy(status);
  const running = session?.tasks.filter((t) => t.status === "running") ?? [];
  const agent = session?.agent ?? settings.agent.adapter;
  const keys = shortcutLabel(settings.general.mode === "push" ? settings.shortcuts.pushToTalk : settings.shortcuts.toggle);

  // Ce qui s'affiche en grand : la question en attente, la phrase dite, ce que vous dites, la dernière réponse.
  const main: { text: string; tone: "reply" | "user" | "hint" | "error"; key: string } = confirmation
    ? { text: confirmation.question, tone: "reply", key: `c-${confirmation.id}` }
    : error && status === "error"
      ? { text: error, tone: "error", key: "error" }
      : caption
        ? { text: caption, tone: "reply", key: `s-${caption}` }
        : partial
          ? { text: partial, tone: "user", key: "partial" }
          : (status === "thinking" || status === "tool") && lastUser
            ? { text: lastUser.text, tone: "user", key: `u-${lastUser.id}` }
            : lastReply
              ? { text: lastReply.text, tone: "reply", key: `r-${lastReply.id}` }
              : {
                  text: micOn ? "Je vous écoute." : session ? "Micro coupé. Touchez le micro pour reprendre." : "Touchez le micro et parlez.",
                  tone: "hint",
                  key: "hint",
                };
  const above = main.tone === "reply" && !confirmation && lastUser && (caption || lastReply) ? lastUser.text : null;

  // Plein écran : le focus entre dans la vue (sans ouvrir d'info-bulle sur un bouton).
  useEffect(() => {
    if (variant === "overlay") rootRef.current?.focus();
  }, [variant]);

  const openChat = (conversationId: string) => {
    useSessionStore.getState().setActive(conversationId);
    useUiStore.getState().navigate("chat");
    onClose?.();
  };

  return (
    <section
      ref={rootRef}
      tabIndex={-1}
      aria-labelledby={titleId}
      className={cn(
        "outline-none",
        "relative isolate flex h-full min-h-0 flex-col overflow-hidden bg-[var(--color-bg)]",
        variant === "page" && "rounded-lg border border-border",
      )}
    >
      <VoiceAura mode={mode} animate={settings.overlay.animations} />

      {/* En-tête : session, où passent les données, fermeture. */}
      <header className="relative z-10 flex items-start gap-3 px-6 pt-5">
        {leading}
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="truncate text-body font-semibold">
            {session?.title ?? "Conversation vocale"}
          </h2>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-footnote text-text-muted">
            <span>{agentName(agent)}</span>
            {privacyRows(settings, agentName(agent))
              .slice(1)
              .map((row) => (
                <span key={row.stage} className="inline-flex items-center gap-1" title={row.detail}>
                  <span aria-hidden className={cn("size-1.5 rounded-full", row.location === "local" ? "bg-success" : "bg-info")} />
                  {row.stage} {row.location === "local" ? "local" : "en ligne"}
                </span>
              ))}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip label="Réglages de la voix" side="bottom">
            <button
              type="button"
              aria-label="Réglages de la voix"
              onClick={() => {
                useUiStore.getState().openModule("voice", { section: "general" });
                onClose?.();
              }}
              className="flex size-9 cursor-pointer items-center justify-center rounded-full text-text-muted transition-colors duration-[80ms] hover:bg-surface-2 hover:text-text"
            >
              <Settings2 size={16} strokeWidth={1.75} />
            </button>
          </Tooltip>
          {onClose && (
            <Tooltip label="Réduire (Échap)" side="bottom">
              <button
                type="button"
                aria-label="Réduire la vue de conversation"
                onClick={onClose}
                className="flex size-9 cursor-pointer items-center justify-center rounded-full text-text-muted transition-colors duration-[80ms] hover:bg-surface-2 hover:text-text"
              >
                <Minimize2 size={16} strokeWidth={1.75} />
              </button>
            </Tooltip>
          )}
        </div>
      </header>

      {/* Tâches confiées en cours. */}
      {running.length > 0 && (
        <div className="relative z-10 flex flex-wrap justify-center gap-2 px-6 pt-4">
          {running.map((task) => (
            <button
              key={task.id}
              type="button"
              onClick={() => openChat(task.conversationId)}
              className="glass-chrome inline-flex max-w-[28rem] cursor-pointer items-center gap-2 rounded-full px-3 py-1.5 text-footnote text-text-muted transition-colors duration-[80ms] hover:text-text"
            >
              <Loader2 size={13} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
              <span className="truncate">
                {agentName(task.agent)} · {task.title}
                {task.activity ? ` · ${task.activity}` : ""}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* La phrase en cours, en grand. */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-8 py-6 text-center">
        <p className="flex items-center gap-2 text-footnote text-text-muted" aria-live="polite">
          <span
            aria-hidden
            className={cn(
              "size-1.5 rounded-full",
              micOn ? "bg-accent" : status === "error" ? "bg-danger" : working ? "bg-info" : "bg-text-subtle",
            )}
          />
          {statusSentence(status, tool)}
        </p>
        {above && <p className="line-clamp-2 max-w-[48ch] text-body text-text-subtle">{above}</p>}
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={main.key}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: duration.base, ease: ease.emphasized }}
            className={cn(
              "line-clamp-6 max-w-[34ch] text-balance text-[clamp(1.25rem,2.4vw,2rem)] font-medium leading-snug tracking-[-0.01em]",
              main.tone === "reply" && "text-text",
              main.tone === "user" && "text-text-muted",
              main.tone === "hint" && "text-text-subtle",
              main.tone === "error" && "text-danger",
            )}
          >
            {main.text}
          </motion.p>
        </AnimatePresence>
        {(status === "tool" || status === "thinking") && tools.length > 0 && (
          <ul className="flex max-w-[40rem] flex-wrap justify-center gap-1.5" aria-label="Outils utilisés">
            {[...new Set(tools)].slice(-5).map((name) => (
              <li key={name} className="glass-chrome inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-caption text-text-muted">
                <Wrench size={11} strokeWidth={2} aria-hidden />
                {name}
              </li>
            ))}
          </ul>
        )}
        {confirmation && (
          <div role="group" aria-label="Répondre à la question" className="flex items-center gap-2 pt-2">
            <button
              type="button"
              autoFocus
              onClick={() => voice.resolve(confirmation.id, "no")}
              className="glass-chrome h-10 cursor-pointer rounded-full px-5 text-body-sm font-medium text-text transition-colors duration-[80ms] hover:bg-surface-2"
            >
              Non
            </button>
            {confirmation.always && (
              <button
                type="button"
                onClick={() => voice.resolve(confirmation.id, "always")}
                className="h-10 cursor-pointer rounded-full px-5 text-body-sm font-medium text-text-muted transition-colors duration-[80ms] hover:bg-surface-2 hover:text-text"
              >
                Oui, toujours
              </button>
            )}
            <button
              type="button"
              onClick={() => voice.resolve(confirmation.id, "yes")}
              className="h-10 cursor-pointer rounded-full bg-accent px-6 text-body-sm font-medium text-accent-fg transition-colors duration-[80ms] hover:bg-accent-hover"
            >
              Oui
            </button>
          </div>
        )}
      </div>

      {/* Commandes : positions fixes, les boutons inutiles sont seulement estompés. */}
      <footer className="relative z-10 flex flex-col items-center gap-3 px-6 pb-6">
        <div className="flex items-center gap-4">
          <RoundButton label={showTranscript ? "Masquer la conversation écrite" : "Afficher la conversation écrite"} pressed={showTranscript} onClick={() => setShowTranscript((v) => !v)}>
            <MessageSquareText size={18} strokeWidth={1.75} />
          </RoundButton>
          <RoundButton
            label={status === "paused" ? "Reprendre la voix" : "Mettre la voix en pause"}
            disabled={status !== "speaking" && status !== "paused"}
            onClick={() => (status === "paused" ? voice.continueSpeech() : voice.pauseSpeech())}
          >
            {status === "paused" ? <Play size={18} strokeWidth={1.75} /> : <Pause size={18} strokeWidth={1.75} />}
          </RoundButton>
          <RoundButton label={micOn ? "Couper le micro" : "Parler"} size="lg" tone={micOn ? "accent" : "neutral"} pressed={micOn} onClick={() => void voice.toggle()}>
            {micOn ? <Mic size={24} strokeWidth={1.75} /> : <MicOff size={24} strokeWidth={1.75} />}
          </RoundButton>
          <RoundButton label="Arrêter la réponse" disabled={!working} onClick={() => voice.cancel()}>
            <Square size={15} strokeWidth={2.25} />
          </RoundButton>
          <RoundButton
            label="Terminer la session"
            tone="danger"
            disabled={!session}
            onClick={() => {
              void voice.endSession();
              onClose?.();
            }}
          >
            <X size={19} strokeWidth={2} />
          </RoundButton>
        </div>
        <p className="glass-chrome flex items-center gap-1 rounded-full py-1 pl-2.5 pr-1 text-caption text-text-muted">
          {settings.general.mode === "push" ? "Maintenir" : "Micro"}
          {keys.map((key) => (
            <Kbd key={key}>{key}</Kbd>
          ))}
        </p>
      </footer>

      {/* Conversation écrite, en panneau latéral. */}
      <AnimatePresence>
        {showTranscript && (
          <motion.aside
            aria-label="Conversation écrite"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 16 }}
            transition={{ duration: duration.base, ease: ease.emphasized }}
            className="glass absolute bottom-24 right-4 top-16 z-20 flex w-[min(380px,calc(100%-2rem))] flex-col rounded-lg p-4"
          >
            <div className="flex items-center justify-between pb-3">
              <p className="text-body-sm font-semibold">Conversation écrite</p>
              <button
                type="button"
                aria-label="Fermer la conversation écrite"
                onClick={() => setShowTranscript(false)}
                className="flex size-7 cursor-pointer items-center justify-center rounded-full text-text-muted hover:bg-surface-2 hover:text-text"
              >
                <X size={14} strokeWidth={2} />
              </button>
            </div>
            {turns.length > 0 ? (
              <Transcript turns={turns} partial={partial} caption={caption} className="min-h-0 flex-1 pr-1" />
            ) : (
              <p className="text-footnote text-text-subtle">Rien encore : parlez, la conversation s'écrit ici.</p>
            )}
          </motion.aside>
        )}
      </AnimatePresence>
    </section>
  );
}
