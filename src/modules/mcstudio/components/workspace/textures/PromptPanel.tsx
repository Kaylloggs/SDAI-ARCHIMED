import { useEffect, useState } from "react";
import { ChevronRight, PenLine, RotateCcw } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Select } from "@/design-system/primitives";
import type { PromptSettings } from "@/core/ipc/bindings/PromptSettings";
import type { TextureInfo } from "@/core/ipc/bindings/TextureInfo";
import type { TextureStyle } from "@/core/ipc/bindings/TextureStyle";
import type { TextureTarget } from "@/core/ipc/bindings/TextureTarget";
import { mcstudioApi } from "../../../api";
import { MAX_EXTRA, MAX_PROMPT, STYLE_CHOICES } from "../../../lib/textures";
import { Field, focusRing, inputClass, Segmented } from "../../ui";

export type PromptChoice = {
  style: TextureStyle;
  extra: string;
  /** Chemin relatif d'une texture du projet envoyée au modèle. */
  reference: string | null;
  /** Texte écrit à la main, envoyé tel quel ; `null` : texte construit automatiquement. */
  custom: string | null;
};

export const DEFAULT_PROMPT: PromptChoice = { style: "vanilla", extra: "", reference: null, custom: null };

export function promptSettings(choice: PromptChoice, size: { width: number; height: number } | null): PromptSettings {
  return {
    style: choice.style,
    extra: choice.extra,
    withReference: choice.reference !== null,
    width: size?.width ?? null,
    height: size?.height ?? null,
  };
}

/**
 * Ce qui part au modèle : style, consignes, texture de référence, et le texte final — lisible
 * avant l'envoi et modifiable mot pour mot.
 */
export function PromptPanel({
  target,
  description,
  choice,
  onChange,
  references,
  referenceAllowed,
  guiSize,
  disabled,
}: {
  target: TextureTarget;
  description: string;
  choice: PromptChoice;
  onChange: (choice: PromptChoice) => void;
  /** Textures du projet qui peuvent servir de référence. */
  references: TextureInfo[];
  /** Le modèle choisi lit les images en entrée. */
  referenceAllowed: boolean;
  guiSize: { width: number; height: number } | null;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(choice.custom !== null);
  const [automatic, setAutomatic] = useState("");
  const set = (patch: Partial<PromptChoice>) => onChange({ ...choice, ...patch });

  // Texte construit par l'application, recalculé quand un réglage change.
  const settings = promptSettings(choice, guiSize);
  const signature = JSON.stringify([target, description, settings]);
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      mcstudioApi
        .texturePrompt(target, description.trim() || "…", settings)
        .then(setAutomatic)
        .catch(() => undefined);
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, signature]);

  const extraProblem = choice.extra.length > MAX_EXTRA ? `${MAX_EXTRA} caractères au plus.` : null;
  const customProblem =
    choice.custom !== null && choice.custom.length > MAX_PROMPT ? `${MAX_PROMPT} caractères au plus.` : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="space-y-1.5">
          <p className="text-footnote font-medium text-text-muted">Style</p>
          <Segmented
            label="Style de la texture"
            value={choice.style}
            options={STYLE_CHOICES}
            disabled={disabled || choice.custom !== null}
            onChange={(style) => set({ style })}
          />
        </div>
        <div className="min-w-[220px] flex-1 space-y-1.5">
          <p className="text-footnote font-medium text-text-muted">Texture de référence</p>
          <Select
            label="Texture de référence"
            value={choice.reference ?? ""}
            disabled={disabled || !referenceAllowed}
            onChange={(value) => set({ reference: value || null })}
            options={[
              { value: "", label: "Aucune" },
              ...references.map((texture) => ({ value: texture.relative, label: texture.label, hint: `${texture.width}×${texture.height}` })),
            ]}
          />
        </div>
      </div>
      {!referenceAllowed ? (
        <p className="text-caption text-text-subtle">Ce modèle ne lit pas d'image : pas de texture de référence.</p>
      ) : choice.reference ? (
        <p className="text-caption text-text-subtle">
          La texture choisie part avec la demande : le modèle reprend sa palette et son style (autres faces du bloc, variante
          d'une texture existante).
        </p>
      ) : null}

      <Field
        id="mc-texture-extra"
        label="Consignes en plus"
        problem={extraProblem}
        hint="Facultatif : « lumière froide », « bord doré », « plus sombre en bas »…"
      >
        <input
          id="mc-texture-extra"
          value={choice.extra}
          disabled={disabled || choice.custom !== null}
          onChange={(event) => set({ extra: event.target.value })}
          className={inputClass}
        />
      </Field>

      <div className="space-y-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={cn("flex items-center gap-1.5 rounded-sm text-footnote text-text-muted hover:text-text", focusRing)}
        >
          <ChevronRight size={14} className={cn("transition-transform duration-[140ms]", open && "rotate-90")} />
          Texte envoyé au modèle
          {choice.custom !== null && <span className="text-accent">· écrit à la main</span>}
        </button>
        {open &&
          (choice.custom === null ? (
            <div className="space-y-2">
              <p className="selectable whitespace-pre-wrap rounded-md border border-border bg-surface-1 px-3 py-2 font-mono text-caption leading-relaxed text-text-muted">
                {automatic || "…"}
              </p>
              <button
                type="button"
                disabled={disabled || !automatic}
                onClick={() => set({ custom: automatic })}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-footnote text-text-muted hover:bg-surface-2 hover:text-text disabled:opacity-40",
                  focusRing,
                )}
              >
                <PenLine size={14} /> Modifier le texte
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                aria-label="Texte envoyé au modèle"
                value={choice.custom}
                rows={8}
                disabled={disabled}
                onChange={(event) => set({ custom: event.target.value })}
                className={cn(inputClass, "h-auto resize-y py-2 font-mono text-caption leading-relaxed")}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className={cn("text-caption tabular-nums", customProblem ? "text-danger" : "text-text-subtle")}>
                  {customProblem ?? `${choice.custom.length} / ${MAX_PROMPT} · envoyé tel quel, la description et le style ne s'y ajoutent plus`}
                </p>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => set({ custom: null })}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-footnote text-text-muted hover:bg-surface-2 hover:text-text",
                    focusRing,
                  )}
                >
                  <RotateCcw size={14} /> Revenir au texte automatique
                </button>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
