import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, Check, ChevronLeft, ChevronRight, Lightbulb, RotateCcw, Settings2 } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { duration, ease, spring } from "@/design-system/motion";
import { Button, Kbd, Tooltip } from "@/design-system/primitives";
import type { Topic } from "../lib/topics";
import { CREATE_MODULE_TOPIC, START_TOPIC } from "../store";
import { CodeSample } from "./CodeSample";
import { Miniature } from "./Miniature";

/**
 * Espaces insécables du français : « et » restent collés à leur texte, les deux-points et le
 * point-virgule ne partent pas seuls à la ligne. Vaut pour les tutoriels de tous les modules.
 */
export function french(text: string): string {
  return text.replace(/« /g, "«\u00a0").replace(/ ([»:;!?])/g, "\u00a0$1");
}

/** Touche de clavier dessinée en relief, pour les raccourcis d'une étape. */
function KeyCap({ label }: { label: string }) {
  return (
    <kbd className="inline-flex h-9 min-w-9 items-center justify-center rounded-md border border-border-strong bg-surface-2 px-2.5 font-mono text-body-sm text-text shadow-[inset_0_-2px_0_var(--color-border-strong)]">
      {label}
    </kbd>
  );
}

function outro(topic: Topic): string {
  if (topic.id === START_TOPIC) return "Vous connaissez l'essentiel. Chaque module a aussi son tutoriel, dans la liste.";
  if (topic.id === CREATE_MODULE_TOPIC) return "À vous de jouer : votre module aura sa place dans cette liste.";
  return `Vous savez vous servir de ${topic.title}.`;
}

type StageProps = {
  topic: Topic;
  step: number;
  /** Sens du dernier déplacement : l'étape entre du côté où l'on va. */
  direction: 1 | -1;
  finished: boolean;
  next?: Topic;
  onStep: (step: number) => void;
  onFinish: () => void;
  onRestart: () => void;
  onSelect: (topic: string) => void;
  onOpenModule: (id: string) => void;
  onOpenSettings: () => void;
};

/** Un tutoriel : en-tête, étape en cours (illustration + texte), navigation, écran de fin. */
export function Stage(props: StageProps) {
  const { topic, onOpenModule, onOpenSettings } = props;
  const Icon = topic.icon;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-start gap-4 px-8 pb-5 pt-7">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-[14px] border border-border bg-surface-2">
          <Icon size={22} strokeWidth={1.75} className="text-accent" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-balance text-title-1 font-semibold tracking-[-0.015em]">{topic.title}</h1>
          {topic.tutorial && (
            <p className="max-w-[62ch] text-pretty pt-0.5 text-body text-text-muted">{french(topic.tutorial.summary)}</p>
          )}
          {topic.moduleId && !topic.enabled && (
            <p className="pt-1 text-footnote text-text-subtle">Ce module est désactivé. Son tutoriel reste lisible.</p>
          )}
        </div>
        {topic.moduleId &&
          (topic.enabled ? (
            <Button onClick={() => onOpenModule(topic.moduleId ?? "")} className="shrink-0">
              Ouvrir {topic.title}
              <ArrowUpRight size={14} strokeWidth={1.75} />
            </Button>
          ) : (
            <Button onClick={onOpenSettings} icon={<Settings2 size={14} strokeWidth={1.75} />} className="shrink-0">
              Activer dans Réglages
            </Button>
          ))}
      </header>

      {!topic.tutorial ? (
        <NoTutorial {...props} />
      ) : props.finished ? (
        <Finished {...props} />
      ) : (
        <Steps {...props} />
      )}
    </div>
  );
}

function Steps({ topic, step, direction, onStep, onFinish }: StageProps) {
  const reduced = useReducedMotion();
  const steps = topic.tutorial?.steps ?? [];
  const current = steps[step];
  if (!current) return null;
  const last = step === steps.length - 1;
  const shift = reduced ? 0 : 16 * direction;

  return (
    <>
      <div className="@container flex min-h-0 flex-1 overflow-y-auto px-8">
        <div className="m-auto grid w-full max-w-[1120px] items-center gap-x-12 gap-y-6 pb-12 pt-4 @min-[720px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          {/* Écran étroit : le texte d'abord, l'illustration dessous, bornée en hauteur. */}
          <div className="order-2 mx-auto w-full min-w-0 max-w-[calc(34vh*1.6)] @min-[720px]:order-none @min-[720px]:max-w-none">
            {current.code ? (
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={`${topic.id}-${step}`}
                  initial={{ opacity: 0, x: shift }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -shift, transition: { duration: duration.instant, ease: ease.exit } }}
                  transition={{ duration: duration.base, ease: ease.emphasized }}
                >
                  <CodeSample code={current.code} />
                </motion.div>
              </AnimatePresence>
            ) : (
              <Miniature
                area={current.area ?? "center"}
                icon={current.icon}
                moduleIcon={topic.icon}
                stepKey={`${topic.id}-${step}`}
              />
            )}
          </div>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${topic.id}-${step}`}
              initial={{ opacity: 0, x: shift }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -shift, transition: { duration: duration.instant, ease: ease.exit } }}
              transition={{ duration: duration.base, ease: ease.emphasized }}
              aria-live="polite"
            >
              <p className="text-footnote tabular-nums text-text-subtle">
                Étape {step + 1} sur {steps.length}
              </p>
              <h2 className="text-balance pt-1 text-title-2 font-semibold tracking-[-0.01em]">{french(current.title)}</h2>
              <p className="max-w-[46ch] text-pretty pt-2 text-message text-text-muted">{french(current.text)}</p>
              {current.keys && (
                <div className="flex items-center gap-1.5 pt-5" aria-label={`Raccourci : ${current.keys.join(" + ")}`}>
                  {current.keys.map((key, i) => (
                    <span key={key} className="flex items-center gap-1.5">
                      {i > 0 && <span className="text-body-sm text-text-subtle">+</span>}
                      <KeyCap label={key} />
                    </span>
                  ))}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <footer className="flex items-center gap-4 border-t border-border px-8 py-3">
        <ol aria-label="Étapes" className="flex items-center">
          {steps.map((s, i) => (
            <li key={i}>
              <Tooltip label={s.title} side="top">
                <button
                  type="button"
                  aria-label={`Étape ${i + 1} : ${s.title}`}
                  aria-current={i === step ? "step" : undefined}
                  onClick={() => onStep(i)}
                  className="group flex h-8 items-center px-1"
                >
                  <span
                    className={cn(
                      "block h-1.5 rounded-full transition-[width,background-color] duration-[220ms] ease-emphasized",
                      i === step
                        ? "w-7 bg-accent"
                        : i < step
                          ? "w-3 bg-text-muted"
                          : "w-3 bg-border-strong group-hover:bg-text-subtle",
                    )}
                  />
                </button>
              </Tooltip>
            </li>
          ))}
        </ol>
        <p className="hidden items-center gap-1.5 text-footnote text-text-subtle min-[1100px]:flex">
          <Kbd>←</Kbd>
          <Kbd>→</Kbd>
          au clavier
        </p>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            disabled={step === 0}
            onClick={() => onStep(step - 1)}
            icon={<ChevronLeft size={16} strokeWidth={1.75} />}
          >
            Précédent
          </Button>
          {last ? (
            <Button variant="primary" onClick={onFinish} icon={<Check size={16} strokeWidth={2} />}>
              Terminer
            </Button>
          ) : (
            <Button variant="primary" onClick={() => onStep(step + 1)}>
              Suivant
              <ChevronRight size={16} strokeWidth={1.75} />
            </Button>
          )}
        </div>
      </footer>
    </>
  );
}

function Finished({ topic, next, onSelect, onRestart, onOpenModule }: StageProps) {
  const reduced = useReducedMotion();
  const tips = topic.tutorial?.tips ?? [];
  const canOpen = Boolean(topic.moduleId && topic.enabled);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-8">
      <motion.div
        initial={{ opacity: 0, y: reduced ? 0 : 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: duration.base, ease: ease.emphasized }}
        className="mx-auto flex max-w-[560px] flex-col items-center py-12 text-center"
      >
        <motion.span
          initial={{ scale: reduced ? 1 : 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={reduced ? { duration: duration.fast } : spring.gentle}
          className="flex size-14 items-center justify-center rounded-full bg-success-soft text-success"
        >
          <Check size={26} strokeWidth={2} />
        </motion.span>
        <h2 className="pt-5 text-title-2 font-semibold tracking-[-0.01em]">Tutoriel terminé</h2>
        <p className="text-pretty pt-1 text-body text-text-muted">{french(outro(topic))}</p>

        {tips.length > 0 && (
          <ul aria-label="Astuces" className="flex w-full flex-col gap-2 pt-8 text-left">
            {tips.map((tip) => (
              <li
                key={tip}
                className="flex gap-3 rounded-lg border border-border bg-surface-2/60 px-4 py-3 text-body-sm text-text-muted"
              >
                <Lightbulb size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-accent" />
                <span className="text-pretty">{french(tip)}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap justify-center gap-2 pt-8">
          {canOpen && (
            <Button variant="primary" onClick={() => onOpenModule(topic.moduleId ?? "")}>
              Ouvrir {topic.title}
              <ArrowUpRight size={14} strokeWidth={1.75} />
            </Button>
          )}
          {next && (
            <Button variant={canOpen ? "secondary" : "primary"} onClick={() => onSelect(next.id)}>
              Tutoriel suivant : {next.title}
              <ChevronRight size={16} strokeWidth={1.75} />
            </Button>
          )}
          <Button variant="ghost" onClick={onRestart} icon={<RotateCcw size={14} strokeWidth={1.75} />}>
            Revoir depuis le début
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

function NoTutorial({ topic, onSelect }: StageProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 pb-16 text-center">
      <p className="text-title-3 font-semibold">Pas encore de tutoriel</p>
      <p className="max-w-[48ch] text-pretty pt-1 text-body text-text-muted">
        {topic.title} n'a pas encore de tutoriel. Un module en reçoit un avec son fichier tutorial.ts.
      </p>
      <Button variant="ghost" className="mt-4" onClick={() => onSelect(CREATE_MODULE_TOPIC)}>
        Voir comment écrire un tutoriel
      </Button>
    </div>
  );
}
