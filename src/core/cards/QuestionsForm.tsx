import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/core/lib/cn";
import type { Question } from "@/core/engine/types";
import { Button } from "@/design-system/primitives";

/** Réponses au format attendu par Claude Code : question → libellé(s) choisi(s). */
export function buildAnswers(questions: Question[], picked: Record<number, string[]>, other: Record<number, string>): Record<string, string> {
  const answers: Record<string, string> = {};
  questions.forEach((question, index) => {
    const values = [...(picked[index] ?? [])];
    const custom = other[index]?.trim();
    if (custom) values.push(custom);
    if (values.length > 0) answers[question.question] = values.join(", ");
  });
  return answers;
}

/**
 * Questions à choix posées par l'agent (AskUserQuestion) : une option (ou plusieurs) par
 * question, ou une réponse libre. Tant qu'une question reste sans réponse, on ne peut pas envoyer.
 */
export function QuestionsForm({
  questions,
  disabled,
  onSubmit,
  onSkip,
}: {
  questions: Question[];
  disabled: boolean;
  onSubmit: (answers: Record<string, string>) => void;
  onSkip: () => void;
}) {
  const [picked, setPicked] = useState<Record<number, string[]>>({});
  const [other, setOther] = useState<Record<number, string>>({});
  const answers = buildAnswers(questions, picked, other);
  const complete = questions.every((q) => answers[q.question]);

  const toggle = (index: number, label: string, multi: boolean) =>
    setPicked((current) => {
      const values = current[index] ?? [];
      const next = values.includes(label) ? values.filter((v) => v !== label) : multi ? [...values, label] : [label];
      return { ...current, [index]: next };
    });

  return (
    <div className="space-y-4 px-4 py-3">
      {questions.map((question, index) => (
        <fieldset key={index} className="space-y-2">
          <legend className="flex items-center gap-2">
            {question.header && (
              <span className="rounded-xs bg-surface-2 px-1.5 py-0.5 text-caption font-medium text-text-muted">{question.header}</span>
            )}
            <span className="text-body-sm font-medium text-text">{question.question}</span>
          </legend>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {question.options.map((option) => {
              const selected = (picked[index] ?? []).includes(option.label);
              return (
                <button
                  key={option.label}
                  type="button"
                  role={question.multiSelect ? "checkbox" : "radio"}
                  aria-checked={selected}
                  disabled={disabled}
                  onClick={() => toggle(index, option.label, question.multiSelect)}
                  className={cn(
                    "flex items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
                    selected ? "border-accent bg-accent-soft" : "border-border hover:border-border-strong hover:bg-surface-2",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center border",
                      question.multiSelect ? "rounded-xs" : "rounded-full",
                      selected ? "border-accent bg-accent text-accent-fg" : "border-border-strong",
                    )}
                    aria-hidden
                  >
                    {selected && <Check size={10} strokeWidth={2.5} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-body-sm text-text">{option.label}</span>
                    {option.description && <span className="block text-footnote text-text-muted">{option.description}</span>}
                  </span>
                </button>
              );
            })}
          </div>
          <input
            value={other[index] ?? ""}
            disabled={disabled}
            onChange={(event) => setOther((current) => ({ ...current, [index]: event.target.value }))}
            placeholder="Autre réponse…"
            aria-label={`Autre réponse à « ${question.question} »`}
            className="h-8 w-full rounded-md border border-border bg-bg px-2.5 text-body-sm outline-none placeholder:text-text-subtle focus:border-border-strong"
          />
        </fieldset>
      ))}
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="secondary" disabled={disabled} onClick={onSkip}>
          Ignorer
        </Button>
        <Button variant="primary" disabled={disabled || !complete} onClick={() => onSubmit(answers)}>
          Répondre
        </Button>
      </div>
    </div>
  );
}
