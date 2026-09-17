import type { ReactNode } from "react";
import { Leaf } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { CAVEMAN_LEVELS, EFFORT_LEVELS, useTokenSaverStore } from "@/core/engine/tokenSaver";

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors",
        checked ? "bg-accent" : "bg-surface-3",
      )}
    >
      <span
        className={cn(
          "size-4 rounded-full bg-text shadow-sm transition-transform duration-150",
          checked ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
}

function Option({
  title,
  description,
  checked,
  onChange,
  children,
  icon,
}: {
  title: string;
  description: ReactNode;
  checked: boolean;
  onChange: (value: boolean) => void;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface-1 p-4">
      <div className="flex items-start gap-3">
        {icon}
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-body font-medium">{title}</p>
          <p className="text-footnote text-text-subtle">{description}</p>
        </div>
        <Switch checked={checked} onChange={onChange} label={title} />
      </div>
      {children}
    </div>
  );
}

/** Choix en boutons radio (niveau caveman, effort de réflexion). */
function Choice<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ id: T; label: string; description: string }>;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("grid gap-2 sm:grid-cols-2", disabled && "opacity-50")}>
      {options.map((option) => (
        <button
          key={option.id}
          role="radio"
          aria-checked={value === option.id}
          disabled={disabled}
          onClick={() => onChange(option.id)}
          className={cn(
            "rounded-md border p-2.5 text-left transition-colors disabled:cursor-not-allowed",
            value === option.id ? "border-accent bg-accent-soft" : "border-border hover:border-border-strong",
          )}
        >
          <span className="block text-body-sm font-medium">{option.label}</span>
          <span className="block text-caption text-text-subtle">{option.description}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Catégorie « Économie de tokens » : tout ce qui réduit la consommation, côté réponses
 * (mode caveman, effort) comme côté contexte envoyé à chaque message (skills, cache, compactage).
 */
export function TokenSaverSection() {
  const state = useTokenSaverStore();
  const { setEnabled, setLevel, setOption } = state;

  return (
    <div className="space-y-3">
      <Option
        title="Mode caveman"
        icon={<Leaf size={16} strokeWidth={1.75} className={cn("mt-0.5 shrink-0", state.enabled ? "text-success" : "text-text-subtle")} />}
        description={
          <>
            Réponses très concises, sans formules ni remplissage, code et termes techniques exacts. S'applique à chaque
            message, dans Chat et Code, quelle que soit la CLI. Réduit les tokens <em>générés</em>.
          </>
        }
        checked={state.enabled}
        onChange={setEnabled}
      >
        <Choice
          label="Niveau de compression"
          value={state.level}
          options={CAVEMAN_LEVELS}
          disabled={!state.enabled}
          onChange={setLevel}
        />
        <p className="text-caption text-text-subtle">
          Règles complètes au premier message d'une conversation, puis un rappel d'une ligne. Propulsé par le skill
          Caveman de Julius Brussee (licence MIT).
        </p>
      </Option>

      <div className="space-y-3 rounded-lg border border-border bg-surface-1 p-4">
        <div className="space-y-0.5">
          <p className="text-body font-medium">Effort de réflexion</p>
          <p className="text-footnote text-text-subtle">
            Appliqué quand le modèle choisi dans la barre de saisie n'impose pas son propre niveau. Moins d'effort =
            moins de tokens de réflexion (Claude Code et Antigravity).
          </p>
        </div>
        <Choice
          label="Effort de réflexion"
          value={state.effort}
          options={EFFORT_LEVELS}
          onChange={(effort) => setOption({ effort })}
        />
      </div>

      <Option
        title="Ne pas charger les skills des CLI"
        description="La description de chaque skill installé est envoyée à chaque message. Les désactiver allège nettement le contexte, mais le sélecteur de skills de la barre de saisie n'a plus d'effet."
        checked={state.disableSkills}
        onChange={(disableSkills) => setOption({ disableSkills })}
      />

      <Option
        title="Contexte optimisé pour le cache"
        description="Claude Code : sort du prompt système les informations qui changent (dossier, git, heure). Le cache est réutilisé plus souvent, et un token en cache coûte environ dix fois moins."
        checked={state.cacheFriendly}
        onChange={(cacheFriendly) => setOption({ cacheFriendly })}
      />

      <Option
        title="Compactage anticipé"
        description="Claude Code : résume la conversation dès 100 k tokens au lieu d'attendre la limite du modèle. Les longues sessions restent légères."
        checked={state.compactAt !== null}
        onChange={(on) => setOption({ compactAt: on ? "100k" : null })}
      />

      <Option
        title="Relancer les réponses coupées"
        description="Quand un agent s'arrête après une action sans conclure, ARCHIMED lui renvoie « continue ». Pratique, mais chaque relance renvoie tout le contexte. À couper pour économiser."
        checked={state.autoContinue}
        onChange={(autoContinue) => setOption({ autoContinue })}
      />
    </div>
  );
}
