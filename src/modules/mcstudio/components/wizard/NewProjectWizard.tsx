import { useCallback, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Button } from "@/design-system/primitives";
import { pageFade } from "@/design-system/motion";
import { errorText, mcstudioApi } from "../../api";
import { useMcStudioStore } from "../../store";
import { focusRing } from "../ui";
import { emptyDraft, STEPS, stepProblem, toRequest, withDerived, type Draft } from "./draft";
import { ContentStep, JavaStep } from "./FinalSteps";
import { IdentityStep, NameStep } from "./IdentitySteps";
import { LoaderStep, useCatalog, VersionStep } from "./VersionSteps";

const TITLES = [
  "Comment s'appelle votre mod ?",
  "Ses identifiants techniques",
  "Pour quelle version de Minecraft ?",
  "Avec quel loader ?",
  "Le JDK qui compilera le mod",
  "Contenu de départ et emplacement",
];

export function NewProjectWizard({ onClose }: { onClose: () => void }) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [step, setStep] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const catalog = useCatalog();

  const update = useCallback((patch: Partial<Draft>) => setDraft((current) => withDerived({ ...current, ...patch })), []);
  const problem = stepProblem(step, draft);
  const last = step === STEPS.length - 1;

  const create = async () => {
    const request = toRequest(draft);
    if (!request) return;
    setCreating(true);
    setError(null);
    try {
      const project = await mcstudioApi.createProject(request);
      const store = useMcStudioStore.getState();
      store.upsert(project);
      store.open(project.id);
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setCreating(false);
    }
  };

  const next = () => {
    if (problem) return;
    if (last) void create();
    else setStep((s) => s + 1);
  };

  return (
    <div className="mx-auto flex max-w-[720px] flex-col px-8 py-8">
      <button
        type="button"
        onClick={onClose}
        className={cn("mb-6 inline-flex w-fit items-center gap-1.5 rounded-sm text-footnote text-text-muted hover:text-text", focusRing)}
      >
        <ArrowLeft size={14} /> Projets
      </button>

      <ol aria-label="Étapes" className="mb-8 flex flex-wrap items-center gap-x-2 gap-y-2">
        {STEPS.map((label, index) => {
          const done = index < step;
          const current = index === step;
          return (
            <li key={label} className="flex items-center gap-2">
              <button
                type="button"
                disabled={index > step}
                aria-current={current ? "step" : undefined}
                onClick={() => setStep(index)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-sm text-footnote transition-colors",
                  current ? "text-text" : done ? "text-text-muted hover:text-text" : "text-text-subtle",
                  focusRing,
                )}
              >
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full border text-caption tabular-nums",
                    current && "border-accent bg-accent text-accent-fg",
                    done && "border-border-strong bg-surface-2",
                    !current && !done && "border-border",
                  )}
                >
                  {done ? <Check size={11} strokeWidth={2.5} /> : index + 1}
                </span>
                {label}
              </button>
              {index < STEPS.length - 1 && <span aria-hidden className="h-px w-4 bg-border" />}
            </li>
          );
        })}
      </ol>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          next();
        }}
      >
        <h1 className="mb-6 text-title-1 font-semibold tracking-[-0.015em] [text-wrap:balance]">{TITLES[step]}</h1>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={step} variants={pageFade} initial="hidden" animate="visible" exit="exit" className="min-h-[280px]">
            {step === 0 && <NameStep draft={draft} update={update} />}
            {step === 1 && <IdentityStep draft={draft} update={update} />}
            {step === 2 && <VersionStep draft={draft} update={update} state={catalog} />}
            {step === 3 && <LoaderStep draft={draft} update={update} catalog={catalog.catalog} />}
            {step === 4 && <JavaStep draft={draft} update={update} />}
            {step === 5 && <ContentStep draft={draft} update={update} />}
          </motion.div>
        </AnimatePresence>

        {error && (
          <p role="alert" className="mt-4 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-footnote">
            {error}
          </p>
        )}

        <footer className="mt-8 flex items-center justify-between gap-3 border-t border-border pt-5">
          <Button type="button" variant="ghost" disabled={step === 0 || creating} onClick={() => setStep((s) => s - 1)}>
            Retour
          </Button>
          <div className="flex items-center gap-3">
            {problem && step > 1 && <span className="text-footnote text-text-subtle">{problem}</span>}
            <Button type="submit" variant="primary" disabled={problem !== null || creating}>
              {creating && <Loader2 size={14} className="animate-spin" />}
              {last ? (creating ? "Création du projet…" : "Créer le projet") : "Continuer"}
            </Button>
          </div>
        </footer>
      </form>
    </div>
  );
}
