import { useEffect, useRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion } from "motion/react";
import { AlertTriangle, Paperclip } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { PromptCard } from "@/core/cards/PromptCard";
import { ToolCallCard } from "@/core/cards/ToolCallCard";
import type { ChatSession } from "@/core/engine/session.store";
import type { PromptAnswer } from "@/core/engine/types";
import { enterUp } from "@/design-system/motion";
import { Slot } from "@/core/modules";

type Props = {
  session: ChatSession;
  agentName: string;
  onAnswer: (promptId: string, answer: PromptAnswer) => void;
  /** Colonne étroite (panneau latéral du module Code). */
  compact?: boolean;
};

export function ConversationView({ session, agentName, onAnswer, compact = false }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [session.timeline.length, session.timeline.at(-1)]);

  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col gap-6 py-6",
        compact ? "max-w-full px-3" : "max-w-[var(--spacing-column)] px-6",
      )}
    >
      {session.timeline.map((item) => {
        switch (item.kind) {
          case "user":
            return (
              <motion.div
                key={item.id}
                variants={enterUp}
                initial="hidden"
                animate="visible"
                className="flex justify-end"
              >
                <div className="selectable max-w-[80%] space-y-2 rounded-lg bg-surface-2 px-3.5 py-2.5">
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
              </motion.div>
            );

          case "assistant":
            return (
              <motion.div key={item.id} variants={enterUp} initial="hidden" animate="visible">
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
                  <Markdown remarkPlugins={[remarkGfm]}>{item.text}</Markdown>
                  {!item.done && (
                    <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-accent align-middle" />
                  )}
                </div>
                {item.done && (
                  <div className="flex flex-wrap items-center gap-2 pt-2 empty:hidden">
                    <Slot name="chat.message.actions" props={{ text: item.text, cwd: session.cwd }} />
                  </div>
                )}
              </motion.div>
            );

          case "tool":
            return (
              <motion.div key={item.id} variants={enterUp} initial="hidden" animate="visible">
                <ToolCallCard tool={item.tool} input={item.input} output={item.output} ok={item.ok} />
              </motion.div>
            );

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
      <div ref={endRef} />
    </div>
  );
}
