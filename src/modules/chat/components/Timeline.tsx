import { useEffect, useRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion } from "motion/react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { PromptCard } from "@/core/cards/PromptCard";
import { ToolCallCard } from "@/core/cards/ToolCallCard";
import type { SessionState } from "@/core/engine/session.store";
import type { PromptAnswer } from "@/core/engine/types";
import { enterUp } from "@/design-system/motion";

type Props = {
  session: SessionState;
  agentName: string;
  onAnswer: (promptId: string, answer: PromptAnswer) => void;
};

export function Timeline({ session, agentName, onAnswer }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [session.timeline.length, session.timeline.at(-1)]);

  return (
    <div className="mx-auto flex w-full max-w-[var(--spacing-column)] flex-col gap-6 px-6 py-6">
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
                <div className="selectable max-w-[80%] rounded-lg bg-surface-2 px-3.5 py-2.5 text-message whitespace-pre-wrap">
                  {item.text}
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
