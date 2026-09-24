import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { mainClassProblem, modIdProblem, nameProblem, packageProblem } from "../../lib/naming";
import { Field, focusRing, inputClass } from "../ui";
import type { Draft } from "./draft";

type StepProps = { draft: Draft; update: (patch: Partial<Draft>) => void };

export function NameStep({ draft, update }: StepProps) {
  const [touched, setTouched] = useState(false);
  return (
    <div className="space-y-5">
      <Field id="mc-name" label="Nom du mod" problem={touched ? nameProblem(draft.name) : null} hint="Affiché dans la liste des mods du jeu.">
        <input
          id="mc-name"
          autoFocus
          className={inputClass}
          placeholder="Dragon Realms"
          value={draft.name}
          maxLength={64}
          onBlur={() => setTouched(true)}
          onChange={(e) => update({ name: e.target.value })}
        />
      </Field>
      <Field id="mc-author" label="Auteur" hint="Votre pseudo : il sert aussi à proposer le package Java.">
        <input
          id="mc-author"
          className={inputClass}
          placeholder="Pseudo"
          value={draft.author}
          maxLength={64}
          onChange={(e) => update({ author: e.target.value })}
        />
      </Field>
      <Field id="mc-description" label="Description (facultative)">
        <textarea
          id="mc-description"
          className={cn(inputClass, "h-20 resize-none py-2")}
          placeholder="Des dragons, des œufs et une armure en écailles."
          value={draft.description}
          maxLength={500}
          onChange={(e) => update({ description: e.target.value })}
        />
      </Field>
    </div>
  );
}

export function IdentityStep({ draft, update }: StepProps) {
  const [advanced, setAdvanced] = useState(draft.edited.pkg || draft.edited.mainClass);
  const edited = draft.edited;
  return (
    <div className="space-y-5">
      <Field
        id="mc-modid"
        label="Mod ID"
        problem={modIdProblem(draft.modId)}
        hint="Identifiant technique, immuable une fois le mod publié : minuscules, chiffres et _."
      >
        <input
          id="mc-modid"
          autoFocus
          spellCheck={false}
          className={cn(inputClass, "font-mono")}
          value={draft.modId}
          maxLength={64}
          aria-invalid={modIdProblem(draft.modId) !== null}
          onChange={(e) => update({ modId: e.target.value, edited: { ...edited, modId: true } })}
        />
      </Field>

      <button
        type="button"
        aria-expanded={advanced}
        onClick={() => setAdvanced((v) => !v)}
        className={cn("inline-flex items-center gap-1 rounded-sm text-footnote text-text-muted hover:text-text", focusRing)}
      >
        <ChevronRight size={14} className={cn("transition-transform duration-[140ms]", advanced && "rotate-90")} />
        Package et classe Java
      </button>

      {advanced && (
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="mc-package" label="Package" problem={packageProblem(draft.pkg)}>
            <input
              id="mc-package"
              spellCheck={false}
              className={cn(inputClass, "font-mono")}
              value={draft.pkg}
              onChange={(e) => update({ pkg: e.target.value, edited: { ...edited, pkg: true } })}
            />
          </Field>
          <Field id="mc-class" label="Classe principale" problem={mainClassProblem(draft.mainClass)}>
            <input
              id="mc-class"
              spellCheck={false}
              className={cn(inputClass, "font-mono")}
              value={draft.mainClass}
              onChange={(e) => update({ mainClass: e.target.value, edited: { ...edited, mainClass: true } })}
            />
          </Field>
        </div>
      )}
      {!advanced && (
        <p className="font-mono text-footnote text-text-subtle">
          {draft.pkg}.{draft.mainClass}
        </p>
      )}
    </div>
  );
}
