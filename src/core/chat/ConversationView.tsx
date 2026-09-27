import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import { openUrl } from "@tauri-apps/plugin-opener";
import remarkGfm from "remark-gfm";
import { motion } from "motion/react";
import { AlertTriangle, Check, Copy, Paperclip, RotateCcw } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { PromptCard } from "@/core/cards/PromptCard";
import type { ChatSession } from "@/core/engine/session.store";
import type { PromptAnswer } from "@/core/engine/types";
import { enterUp } from "@/design-system/motion";
import { Slot } from "@/core/modules";
import { ActivityGroup, LiveActivity, TurnFooter, groupTimeline } from "./ActivityViews";
import { FileLink, ResolvedPathsProvider, useResolvedPath } from "./FileLink";
import { decodeLinkTarget } from "./paths";
import { ThinkingBlock } from "./ThinkingBlock";

/** Copie dans le presse-papiers, avec un « Copié » passager. */
function CopyButton({ text, label = "Copier", compact = false }: { text: () => string; label?: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          .writeText(text())
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => undefined);
      }}
      aria-label={copied ? "Copié" : label}
      title={copied ? "Copié" : label}
      className="flex h-6 items-center gap-1 rounded-xs px-1.5 text-caption text-text-subtle transition-colors hover:bg-surface-2 hover:text-text"
    >
      {copied ? <Check size={12} strokeWidth={1.75} className="text-success" /> : <Copy size={12} strokeWidth={1.75} />}
      {!compact && <span>{copied ? "Copié" : label}</span>}
    </button>
  );
}

/** Bloc de code : langage en haut à gauche, bouton Copier en haut à droite. */
function CodeBlock({ children, ...props }: ComponentProps<"pre">) {
  const ref = useRef<HTMLPreElement>(null);
  const child = Array.isArray(children) ? children[0] : children;
  const className = (child as { props?: { className?: string } } | undefined)?.props?.className ?? "";
  const language = /language-([\w+#-]+)/.exec(className)?.[1];
  return (
    <div className="group/code relative my-2">
      <div className="absolute right-1.5 top-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover/code:opacity-100 focus-within:opacity-100">
        {language && <span className="font-mono text-caption text-text-subtle">{language}</span>}
        <CopyButton text={() => ref.current?.innerText ?? ""} compact />
      </div>
      <pre ref={ref} {...props}>
        {children}
      </pre>
    </div>
  );
}

function textOf(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(textOf).join("");
  return "";
}

/** Code en ligne : devient un lien quand il désigne un fichier existant. */
function InlineCode({ children, className }: ComponentProps<"code">) {
  const text = textOf(children);
  const target = useResolvedPath(text);
  const code = <code className={className}>{children}</code>;
  // Les blocs (```) ont une classe de langage ou plusieurs lignes : jamais de lien.
  if (!target || className || text.includes("\n")) return code;
  return <FileLink target={target}>{code}</FileLink>;
}

const WEB_LINK = /^(?:https?|mailto):/i;

/**
 * Liens des réponses. Jamais de navigation dans la WebView : les liens web s'ouvrent dans
 * le navigateur, les liens de fichiers (`file:///…`, chemins relatifs) passent par `FileLink`.
 */
function MarkdownLink({ href = "", children }: ComponentProps<"a">) {
  const web = WEB_LINK.test(href);
  const target = useResolvedPath(web ? "" : decodeLinkTarget(href));
  if (target) return <FileLink target={target}>{children}</FileLink>;
  if (web) {
    return (
      <a
        href={href}
        onClick={(event) => {
          event.preventDefault();
          void openUrl(href).catch(() => undefined);
        }}
      >
        {children}
      </a>
    );
  }
  // Fichier introuvable (déplacé, supprimé, ou encore en cours de résolution) : texte simple.
  return <span className="text-accent">{children}</span>;
}

/** react-markdown vide par défaut les URL `file:` ; on les garde (aucune n'est suivie telle quelle). */
const keepUrl = (url: string) => (/^\s*(?:javascript|data|vbscript):/i.test(url) ? "" : url);

const MARKDOWN_COMPONENTS: Components = { code: InlineCode, a: MarkdownLink, pre: CodeBlock };

type Props = {
  session: ChatSession;
  agentName: string;
  onAnswer: (promptId: string, answer: PromptAnswer) => void;
  /** Colonne étroite (panneau latéral du module Code). */
  compact?: boolean;
  /** Renvoie la dernière demande (bouton « Réessayer » sous la dernière réponse). */
  onRetry?: () => void;
};

export function ConversationView({ session, agentName, onAnswer, compact = false, onRetry }: Props) {
  const lastAssistant = [...session.timeline].reverse().find((item) => item.kind === "assistant")?.id;
  const idle = session.status === "idle" || session.status === "ended" || session.status === "error";
  const endRef = useRef<HTMLDivElement>(null);
  /** La personne lit le bas de la conversation : la suite s'affiche d'elle-même. */
  const pinned = useRef(true);
  const last = session.timeline.at(-1);

  // Défilement suivi tant que la personne est en bas ; remonter pour relire l'arrête.
  useEffect(() => {
    const scroller = endRef.current?.closest<HTMLElement>(".overflow-y-auto");
    if (!scroller) return;
    const onScroll = () => {
      pinned.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 96;
    };
    // Zone rétrécie (liste de tâches, file d'attente, saisie sur deux lignes) : le bas reste visible.
    const observer = new ResizeObserver(() => {
      if (pinned.current) scroller.scrollTop = scroller.scrollHeight;
    });
    observer.observe(scroller);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", onScroll);
    };
  }, []);

  useEffect(() => {
    // Un message envoyé ramène toujours en bas.
    if (last?.kind === "user") pinned.current = true;
    if (pinned.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [session.timeline.length, last, session.activity?.label]);

  // Autre conversation : on part du bas.
  useEffect(() => {
    pinned.current = true;
    endRef.current?.scrollIntoView({ block: "end" });
  }, [session.id]);

  return (
    <div
      className={cn(
        // Chemins et URL sans espace : coupés n'importe où plutôt que de déborder de la colonne.
        "mx-auto flex w-full min-w-0 flex-col gap-6 py-6 [overflow-wrap:anywhere]",
        compact ? "max-w-full px-3" : "max-w-[var(--spacing-column)] px-6",
      )}
    >
      {groupTimeline(session.timeline).map((item, index, all) => {
        switch (item.kind) {
          case "user":
            return (
              <motion.div
                key={item.id}
                variants={enterUp}
                initial="hidden"
                animate="visible"
                className="group/user flex flex-col items-end gap-1"
              >
                <div className="selectable min-w-0 max-w-[80%] space-y-2 rounded-lg bg-surface-2 px-3.5 py-2.5">
                  <p className="whitespace-pre-wrap text-message">{item.text}</p>
                  {item.attachments && item.attachments.length > 0 && (
                    <ul className="flex flex-wrap gap-1.5 border-t border-border pt-2">
                      {item.attachments.map((path) => (
                        <li
                          key={path}
                          title={path}
                          className="flex max-w-56 items-center gap-1 text-caption text-text-subtle"
                        >
                          <Paperclip size={10} strokeWidth={1.75} className="shrink-0" />
                          <span className="truncate">{path.split(/[\\/]/).at(-1)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="opacity-0 transition-opacity group-hover/user:opacity-100 focus-within:opacity-100">
                  <CopyButton text={() => item.text} compact />
                </div>
              </motion.div>
            );

          case "thinking":
            return <ThinkingBlock key={item.id} text={item.text} done={item.done} />;

          case "assistant":
            return (
              <motion.div key={item.id} variants={enterUp} initial="hidden" animate="visible" className="min-w-0">
                <p className="pb-1.5 text-footnote text-text-subtle">{agentName}</p>
                <div
                  className={cn(
                    "selectable text-message leading-6",
                    "[&_code]:rounded-xs [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-body-sm",
                    "[&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-surface-1 [&_pre]:p-3",
                    "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
                    "[&_p]:py-1 [&_ul]:list-disc [&_ul]:py-1 [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:py-1 [&_ol]:pl-5",
                    "[&_a]:text-accent [&_a]:underline",
                  )}
                >
                  <ResolvedPathsProvider text={item.text} cwd={session.cwd} enabled={item.done}>
                    <Markdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS} urlTransform={keepUrl}>
                      {item.text}
                    </Markdown>
                  </ResolvedPathsProvider>
                  {!item.done && (
                    <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-accent align-middle" />
                  )}
                </div>
                {item.done && (
                  <div className="flex flex-wrap items-center gap-1 pt-2">
                    <CopyButton text={() => item.text} />
                    {onRetry && idle && item.id === lastAssistant && (
                      <button
                        type="button"
                        onClick={onRetry}
                        title="Renvoyer votre dernière demande"
                        className="flex h-6 items-center gap-1 rounded-xs px-1.5 text-caption text-text-subtle transition-colors hover:bg-surface-2 hover:text-text"
                      >
                        <RotateCcw size={12} strokeWidth={1.75} />
                        Réessayer
                      </button>
                    )}
                    <Slot name="chat.message.actions" props={{ text: item.text, cwd: session.cwd }} />
                  </div>
                )}
              </motion.div>
            );

          case "tools":
            return (
              <motion.div key={item.id} variants={enterUp} initial="hidden" animate="visible">
                <ActivityGroup items={item.items} running={index === all.length - 1 && session.status !== "idle"} />
              </motion.div>
            );

          case "turn":
            return <TurnFooter key={item.id} turn={item} />;

          case "prompt":
            return (
              <PromptCard
                key={item.id}
                prompt={item.prompt}
                resolvedBy={item.resolvedBy}
                resolvedOptionId={item.optionId}
                onAnswer={(answer) => onAnswer(item.prompt.promptId, answer)}
              />
            );

          case "error":
            return (
              <motion.div
                key={item.id}
                variants={enterUp}
                initial="hidden"
                animate="visible"
                className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-3.5 py-2.5"
              >
                <AlertTriangle size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-danger" />
                <div className="selectable min-w-0 space-y-0.5">
                  <p className="text-body text-text">{item.message}</p>
                  <p className="font-mono text-caption text-text-subtle">{item.code}</p>
                </div>
              </motion.div>
            );

          case "system":
            return (
              <p key={item.id} className="text-center text-footnote text-text-subtle">
                {item.text}
              </p>
            );

          default:
            return null;
        }
      })}
      <LiveActivity session={session} />
      <div ref={endRef} />
    </div>
  );
}
