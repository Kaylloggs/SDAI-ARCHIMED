import { Code2, X } from "lucide-react";
import { motion } from "motion/react";
import { Badge, Button } from "@/design-system/primitives";
import { enterUp } from "@/design-system/motion";

type Props = {
  name: string;
  kinds: string[];
  onOpen: () => void;
  onDismiss: () => void;
};

/** Proposé quand le dossier de travail ressemble à un projet de code. */
export function ProjectBanner({ name, kinds, onOpen, onDismiss }: Props) {
  return (
    <motion.div
      variants={enterUp}
      initial="hidden"
      animate="visible"
      className="mx-auto mb-2 flex w-full max-w-[var(--spacing-column)] items-center gap-3 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2"
    >
      <Code2 size={16} strokeWidth={1.75} className="shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body-sm">
          <span className="font-medium">{name}</span> ressemble à un projet de code.
        </p>
        <div className="flex flex-wrap items-center gap-1 pt-0.5">
          {kinds.map((kind) => (
            <Badge key={kind} tone="neutral">
              {kind}
            </Badge>
          ))}
        </div>
      </div>
      <Button size="sm" variant="primary" onClick={onOpen}>
        Ouvrir dans Code
      </Button>
      <button
        aria-label="Masquer la proposition"
        onClick={onDismiss}
        className="shrink-0 text-text-subtle hover:text-text"
      >
        <X size={14} strokeWidth={1.75} />
      </button>
    </motion.div>
  );
}
