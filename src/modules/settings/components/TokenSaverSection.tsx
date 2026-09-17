import { Leaf } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { CAVEMAN_LEVELS, useTokenSaverStore } from "@/core/engine/tokenSaver";

/** Réglage « Économie de tokens » : skill caveman intégré, appliqué à tous les prompts. */
export function TokenSaverSection() {
  const { enabled, level, setEnabled, setLevel } = useTokenSaverStore();

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface-1 p-4">
      <div className="flex items-start gap-3">
        <Leaf size={16} strokeWidth={1.75} className={cn("mt-0.5 shrink-0", enabled ? "text-success" : "text-text-subtle")} />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-body font-medium">Mode caveman</p>
          <p className="text-footnote text-text-subtle">
            Les IA répondent de façon très concise, sans formules ni remplissage, en gardant le code, les commandes et
            les termes techniques exacts. S'applique à chaque message, dans Chat et Code, quelle que soit la CLI. Réduit
            les tokens <em>générés</em> ; le contexte relu à chaque message (instructions, outils, skills) reste le même.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={enabled}
          aria-label="Mode caveman"
          onClick={() => setEnabled(!enabled)}
          className={cn(
            "flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors",
            enabled ? "bg-accent" : "bg-surface-3",
          )}
        >
          <span
            className={cn(
              "size-4 rounded-full bg-text shadow-sm transition-transform duration-150",
              enabled ? "translate-x-4" : "translate-x-0",
            )}
          />
        </button>
      </div>

      <div role="radiogroup" aria-label="Niveau de compression" className={cn("grid gap-2 sm:grid-cols-3", !enabled && "opacity-50")}>
        {CAVEMAN_LEVELS.map((option) => (
          <button
            key={option.id}
            role="radio"
            aria-checked={level === option.id}
            disabled={!enabled}
            onClick={() => setLevel(option.id)}
            className={cn(
              "rounded-md border p-2.5 text-left transition-colors disabled:cursor-not-allowed",
              level === option.id ? "border-accent bg-accent-soft" : "border-border hover:border-border-strong",
            )}
          >
            <span className="block text-body-sm font-medium">{option.label}</span>
            <span className="block text-caption text-text-subtle">{option.description}</span>
          </button>
        ))}
      </div>

      <p className="text-caption text-text-subtle">
        Les règles complètes du skill sont envoyées au premier message d'une conversation, puis un rappel d'une ligne.
      </p>
    </div>
  );
}
