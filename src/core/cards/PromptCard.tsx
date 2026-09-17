import { useEffect, useState } from "react";
import { motion } from "motion/react";
import {
  ShieldAlert,
  ShieldCheck,
  Terminal,
  FileDiff,
  MessageCircleQuestion,
  Sparkles,
} from "lucide-react";
import { cn } from "@/core/lib/cn";
import type { InteractivePrompt, ResolvedBy, RiskLevel } from "@/core/engine/types";
import { Badge, Button, Kbd } from "@/design-system/primitives";
import { enterCard } from "@/design-system/motion";
import { DiffView } from "./DiffView";

const riskLabel: Record<RiskLevel, { label: string; tone: "success" | "info" | "warning" | "danger" }> = {
  low: { label: "Risque faible", tone: "success" },
  medium: { label: "Risque modéré", tone: "info" },
  high: { label: "Risque élevé", tone: "warning" },
  critical: { label: "Critique", tone: "danger" },
};

function PromptIcon({ prompt }: { prompt: InteractivePrompt }) {
  const detail = prompt.detail?.type;
  if (detail === "diff") return <FileDiff size={16} strokeWidth={1.75} />;
  if (detail === "command") return <Terminal size={16} strokeWidth={1.75} />;
  if (prompt.kind === "permission") {
    return prompt.risk === "critical" || prompt.risk === "high" ? (
      <ShieldAlert size={16} strokeWidth={1.75} />
    ) : (
      <ShieldCheck size={16} strokeWidth={1.75} />
    );
  }
  return <MessageCircleQuestion size={16} strokeWidth={1.75} />;
}

type Props = {
  prompt: InteractivePrompt;
  resolvedBy?: ResolvedBy;
  resolvedOptionId?: string | null;
  onAnswer: (answer: { optionId?: string; text?: string; editedInput?: unknown }) => void;
};

export function PromptCard({ prompt, resolvedBy, resolvedOptionId, onAnswer }: Props) {
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const resolved = Boolean(resolvedBy);
  const risk = riskLabel[prompt.risk];

  const answer = (optionId: string) => {
    // Une action critique exige un second clic explicite (design.md §7.3).
    if (prompt.risk === "critical" && confirming !== optionId) {
      const option = prompt.options.find((o) => o.id === optionId);
      if (option?.variant !== "default") {
        setConfirming(optionId);
        return;
      }
    }
    setBusy(true);
    onAnswer({ optionId });
  };

  useEffect(() => {
    if (resolved) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const index = Number.parseInt(event.key, 10);
      if (index >= 1 && index <= prompt.options.length) {
        const option = prompt.options[index - 1];
        if (option) answer(option.id);
      }
      if (event.key === "Enter" && prompt.defaultOption) answer(prompt.defaultOption);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt, resolved, confirming]);

  return (
    <motion.div
      variants={enterCard}
      initial="hidden"
      animate="visible"
      className={cn(
        "rounded-lg border bg-surface-1",
        resolved ? "border-border opacity-70" : "border-border-strong",
        !resolved && prompt.risk === "critical" && "border-danger/50",
      )}
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span className={cn("text-text-muted", prompt.risk === "critical" && "text-danger")}>
          <PromptIcon prompt={prompt} />
        </span>
        <h3 className="min-w-0 flex-1 text-title-3 font-semibold">{prompt.title}</h3>
        <Badge tone={risk.tone}>{risk.label}</Badge>
        {prompt.source.type === "screen" && (
          <Badge tone="neutral">écran · {Math.round(prompt.source.confidence * 100)}%</Badge>
        )}
      </header>

      {prompt.detail && (
        <div className="selectable border-b border-border px-4 py-3">
          {prompt.detail.type === "diff" && (
            <DiffView path={prompt.detail.path} before={prompt.detail.before} after={prompt.detail.after} />
          )}
          {prompt.detail.type === "command" && (
            <div className="space-y-1">
              <pre className="whitespace-pre-wrap rounded-md bg-bg px-3 py-2 font-mono text-body-sm text-text [overflow-wrap:anywhere]">
                {prompt.detail.line}
              </pre>
              {prompt.detail.cwd && (
                <p className="text-footnote text-text-subtle">dans {prompt.detail.cwd}</p>
              )}
            </div>
          )}
          {prompt.detail.type === "text" && (
            <p className="whitespace-pre-wrap text-body text-text-muted">{prompt.detail.text}</p>
          )}
          {prompt.detail.type === "json" && (
            <pre className="max-h-48 overflow-auto rounded-md bg-bg px-3 py-2 font-mono text-footnote text-text-muted">
              {JSON.stringify(prompt.detail.value, null, 2)}
            </pre>
          )}
        </div>
      )}

      <footer className="flex flex-wrap items-center gap-2 px-4 py-3">
        {resolved ? (
          <span className="flex items-center gap-1.5 text-footnote text-text-subtle">
            {resolvedBy === "auto" && <Sparkles size={13} strokeWidth={1.75} className="text-accent" />}
            {resolvedBy === "auto" ? "Auto-validé" : resolvedBy === "policy" ? "Bloqué par la policy" : "Répondu"}
            {resolvedOptionId ? ` · ${prompt.options.find((o) => o.id === resolvedOptionId)?.label ?? resolvedOptionId}` : ""}
          </span>
        ) : (
          <>
            {prompt.allowFreeText && (
              <input
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && text.trim()) {
                    setBusy(true);
                    onAnswer({ text });
                  }
                }}
                placeholder="Votre réponse…"
                className="h-8 flex-1 rounded-md border border-border bg-bg px-2.5 text-body-sm outline-none placeholder:text-text-subtle focus:border-border-strong"
              />
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {prompt.options.map((option, index) => (
                <Button
                  key={option.id}
                  disabled={busy}
                  variant={
                    confirming === option.id
                      ? "danger"
                      : option.variant === "primary"
                        ? "primary"
                        : option.variant === "danger"
                          ? "danger"
                          : "secondary"
                  }
                  onClick={() => answer(option.id)}
                >
                  {confirming === option.id ? `Confirmer : ${option.label}` : option.label}
                  <Kbd>{index + 1}</Kbd>
                </Button>
              ))}
            </div>
          </>
        )}
      </footer>
    </motion.div>
  );
}
