import { useEffect, useRef } from "react";
import { CloudOff, Loader2, Paperclip, RefreshCw, SlidersHorizontal, Sparkles, SquareDashed } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Button, Select } from "@/design-system/primitives";
import type { ImageModel } from "@/core/ipc/bindings/ImageModel";
import type { ImageModelList } from "@/core/ipc/bindings/ImageModelList";
import type { ImageProvider } from "@/core/ipc/bindings/ImageProvider";
import type { TextureInfo } from "@/core/ipc/bindings/TextureInfo";
import type { TextureTarget } from "@/core/ipc/bindings/TextureTarget";
import { MAX_DESCRIPTION, modelOptions, PROVIDER_LABEL } from "../../../lib/textures";
import { GeminiKeyCard, OpenRouterKeyCard } from "../../ApiKeyCard";
import { focusRing, Segmented, Switch } from "../../ui";
import { Popover } from "./Popover";
import { PromptPanel, promptSummary, type PromptChoice } from "./PromptPanel";

/** Ce que la personne doit savoir avant d'ajouter la clé d'un service. */
function KeyIntro({ provider }: { provider: ImageProvider }) {
  return provider === "gemini" ? (
    <div className="space-y-1.5 text-footnote text-text-muted">
      <p>Les modèles d'image de Google (Nano Banana) dessinent avec une clé Google AI Studio.</p>
      <p className="text-text-subtle">
        L'abonnement Gemini (Google AI Pro) ne donne pas accès à l'API : la clé se crée sur aistudio.google.com avec le
        même compte, et chaque image est facturée sur son projet Google. Les crédits Google Cloud de Google AI Pro s'y
        appliquent.
      </p>
    </div>
  ) : (
    <p className="text-footnote text-text-muted">
      Les modèles d'image d'OpenRouter dessinent avec votre clé. Les modèles gratuits, quand il y en a, ont des quotas.
    </p>
  );
}

export type ModelState = {
  provider: ImageProvider;
  onProvider: (provider: ImageProvider) => void;
  /** Clé présente (`null` : pas encore lu). */
  key: boolean | null;
  onKey: (provider: ImageProvider, configured: boolean) => void;
  models: ImageModelList | null;
  modelsError: string | null;
  onReload: () => void;
  model: string | null;
  onModel: (model: string) => void;
  chosen: ImageModel | null;
  allowPaid: boolean;
  onAllowPaid: (allowed: boolean) => void;
};

/** Service, modèle, accord de facturation et clé : tout ce qui décide qui dessine. */
function ModelPanel({ state, disabled }: { state: ModelState; disabled: boolean }) {
  const { provider, key, models, model, chosen, allowPaid } = state;
  const noFreeModel = models !== null && models.models.length > 0 && !models.models.some((m) => m.free);
  return (
    <>
      <Segmented
        label="Service d'image"
        value={provider}
        onChange={state.onProvider}
        disabled={disabled}
        options={[
          { value: "openRouter", label: PROVIDER_LABEL.openRouter },
          { value: "gemini", label: "Gemini (Nano Banana)" },
        ]}
      />
      {key === false ? (
        <div className="space-y-3">
          <KeyIntro provider={provider} />
          {provider === "gemini" ? (
            <GeminiKeyCard key="gemini" onChange={(s) => state.onKey("gemini", s.configured)} />
          ) : (
            <OpenRouterKeyCard key="openRouter" onChange={(s) => state.onKey("openRouter", s.configured)} />
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1">
            <Select
              label="Modèle d'image"
              value={model ?? ""}
              options={modelOptions(models?.models ?? [], allowPaid, provider)}
              onChange={state.onModel}
              disabled={disabled || !models}
              className="min-w-0 flex-1"
              placeholder={
                !models
                  ? "Chargement des modèles…"
                  : models.models.length > 0
                    ? provider === "gemini"
                      ? "Acceptez la facturation Google"
                      : "Modèles payants : autorisez-les"
                    : "Aucun modèle disponible"
              }
            />
            <button
              type="button"
              aria-label="Recharger la liste des modèles"
              title="Recharger la liste des modèles"
              disabled={disabled}
              onClick={state.onReload}
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-sm text-text-subtle transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-40",
                focusRing,
              )}
            >
              <RefreshCw size={14} />
            </button>
          </div>
          <div className="-ml-2">
            <Switch checked={allowPaid} disabled={disabled} onChange={state.onAllowPaid}>
              {provider === "gemini" ? "Accepter la facturation Google" : "Autoriser les modèles payants"}
            </Switch>
          </div>
          {chosen?.description && <p className="text-caption text-text-subtle">{chosen.description}</p>}
          {allowPaid && (
            <p className="text-caption text-warning">
              {provider === "gemini"
                ? "Chaque image est facturée par Google sur le projet de votre clé (quelques centimes l'image)."
                : "Un modèle payant est facturé sur votre crédit OpenRouter à chaque image."}
            </p>
          )}
          {models?.offline && (
            <p className="flex items-center gap-1.5 text-caption text-text-subtle">
              <CloudOff size={12} /> {PROVIDER_LABEL[provider]} injoignable : dernière liste connue.
            </p>
          )}
          {models !== null && models.models.length === 0 && (
            <p className="text-caption text-warning">
              {provider === "gemini"
                ? "Aucun modèle d'image Gemini n'est ouvert à cette clé (pays non couvert ou projet sans l'API Gemini)."
                : "OpenRouter ne propose aucun modèle d'image en ce moment."}
            </p>
          )}
          {noFreeModel && !allowPaid && (
            <p className="text-caption text-warning">
              {provider === "gemini"
                ? "Les modèles d'image de Gemini sont payants : acceptez la facturation pour générer."
                : "Aucun modèle gratuit en ce moment : autorisez les payants, passez à Gemini, ou importez une image."}
            </p>
          )}
          {state.modelsError && <p className="text-caption text-danger">{state.modelsError}</p>}
        </>
      )}
    </>
  );
}

/**
 * Barre de création, en bas de l'atelier (comme le composeur du chat) : la description, le
 * modèle, le style et le texte envoyé, le retrait du fond, l'import d'une image, et Générer.
 * Entrée génère, Maj+Entrée va à la ligne.
 */
export function Composer({
  target,
  description,
  onDescription,
  placeholder,
  shared,
  prompt,
  onPrompt,
  references,
  guiSize,
  transparent,
  onTransparent,
  modelState,
  canGenerate,
  generating,
  busy,
  onGenerate,
  onImport,
}: {
  target: TextureTarget;
  description: string;
  onDescription: (text: string) => void;
  placeholder: string;
  /** Description commune aux faces d'un bloc. */
  shared: boolean;
  prompt: PromptChoice;
  onPrompt: (choice: PromptChoice) => void;
  references: TextureInfo[];
  guiSize: { width: number; height: number } | null;
  transparent: boolean;
  onTransparent: (transparent: boolean) => void;
  modelState: ModelState;
  canGenerate: boolean;
  generating: boolean;
  busy: boolean;
  onGenerate: () => void;
  onImport: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const handwritten = prompt.custom !== null;
  const tooLong = description.length > MAX_DESCRIPTION;
  const { key, chosen, provider } = modelState;
  const referenceAllowed = chosen ? chosen.imageInput : true;

  // Hauteur au contenu, jusqu'à six lignes.
  useEffect(() => {
    const field = textareaRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 144)}px`;
  }, [description]);

  const modelValue = key === false ? "Ajouter une clé" : chosen ? chosen.name : PROVIDER_LABEL[provider];

  return (
    <div className="shrink-0 px-3 pb-3 pt-1">
      <div className={cn("glass rounded-xl px-3 pb-2 pt-2.5", tooLong && "ring-1 ring-danger")}>
        <textarea
          ref={textareaRef}
          aria-label={shared ? "Description du bloc" : "Description de la texture"}
          value={handwritten ? "" : description}
          rows={1}
          disabled={busy || handwritten}
          placeholder={handwritten ? "Texte écrit à la main : modifiez-le dans « Style et texte »." : placeholder}
          onChange={(event) => onDescription(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (canGenerate) onGenerate();
            }
          }}
          className="selectable max-h-36 w-full resize-none bg-transparent px-1 text-message text-text outline-none placeholder:text-text-subtle"
        />
        <div className="flex flex-wrap items-center gap-1.5 pt-1.5">
          <Popover
            label="Service et modèle d'image"
            title="Qui dessine : service, modèle, facturation"
            value={modelValue}
            icon={<Sparkles size={13} className={cn("shrink-0", key === false ? "text-warning" : "text-accent")} aria-hidden />}
            disabled={busy}
          >
            <ModelPanel state={modelState} disabled={busy} />
          </Popover>
          <Popover
            label="Style et texte envoyé"
            title="Style, consignes, texture de référence et texte exact envoyé au modèle"
            value={promptSummary(prompt)}
            icon={<SlidersHorizontal size={13} className="shrink-0" aria-hidden />}
            width={400}
            disabled={busy}
          >
            <PromptPanel
              target={target}
              description={description}
              choice={prompt}
              onChange={onPrompt}
              references={references}
              referenceAllowed={referenceAllowed}
              guiSize={guiSize}
              transparent={transparent}
              disabled={busy}
            />
          </Popover>
          <button
            type="button"
            role="switch"
            aria-checked={transparent}
            title="Retirer le fond de l'image reçue : l'objet est détouré, le reste devient transparent"
            disabled={busy}
            onClick={() => onTransparent(!transparent)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-footnote transition-colors disabled:opacity-40",
              transparent ? "border-accent/60 bg-accent-soft text-text" : "border-border text-text-muted hover:border-border-strong hover:text-text",
              focusRing,
            )}
          >
            <SquareDashed size={13} aria-hidden className={transparent ? "text-accent" : undefined} />
            Retirer le fond
          </button>
          <button
            type="button"
            aria-label="Importer une image"
            title="Importer une image (PNG, JPEG, WebP)"
            disabled={busy}
            onClick={onImport}
            className={cn(
              "flex size-7 items-center justify-center rounded-full text-text-subtle transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-40",
              focusRing,
            )}
          >
            <Paperclip size={14} />
          </button>
          <span className="ml-auto flex items-center gap-2">
            {!handwritten && description.length > MAX_DESCRIPTION * 0.8 && (
              <span className={cn("text-caption tabular-nums", tooLong ? "text-danger" : "text-text-subtle")}>
                {description.length} / {MAX_DESCRIPTION}
              </span>
            )}
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={!canGenerate}
              onClick={onGenerate}
              title="Générer (Entrée)"
              icon={generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            >
              Générer
            </Button>
          </span>
        </div>
      </div>
    </div>
  );
}
