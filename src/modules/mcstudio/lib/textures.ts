import type { SelectOption } from "@/design-system/primitives";
import type { ImageModel } from "@/core/ipc/bindings/ImageModel";
import type { ImageProvider } from "@/core/ipc/bindings/ImageProvider";
import type { PixelOptions } from "@/core/ipc/bindings/PixelOptions";
import type { TextureTarget } from "@/core/ipc/bindings/TextureTarget";

/** Longueur maximale d'une description (même limite que le backend). */
export const MAX_DESCRIPTION = 600;

export const SIZE_CHOICES = [16, 32, 64].map((size) => ({ value: size, label: `${size} px` }));

export const COLOR_CHOICES: SelectOption[] = [
  { value: "8", label: "8 couleurs" },
  { value: "16", label: "16 couleurs", hint: "conseillé" },
  { value: "32", label: "32 couleurs" },
  { value: "0", label: "Sans limite" },
];

/** Réglages de départ : un objet est détouré, un bloc remplit sa case, l'icône est plus fine. */
export function defaultOptions(target: TextureTarget): PixelOptions {
  switch (target.kind) {
    case "item":
      return { size: 16, colors: 16, transparent: true };
    case "block":
      return { size: 16, colors: 16, transparent: false };
    case "icon":
      return { size: 32, colors: 32, transparent: false };
  }
}

export function targetKey(target: TextureTarget): string {
  return target.kind === "icon" ? "icon" : `${target.kind}:${target.id}`;
}

export const KIND_LABEL: Record<TextureTarget["kind"], string> = {
  icon: "Icône",
  item: "Objet",
  block: "Bloc",
};

export const DESCRIPTION_PLACEHOLDER: Record<TextureTarget["kind"], string> = {
  item: "Ex. : une épée en rubis rouge, garde dorée, lame brillante",
  block: "Ex. : minerai de rubis, pierre grise avec des éclats rouges",
  icon: "Ex. : un dragon rouge enroulé autour d'une épée",
};

export const PROVIDER_LABEL: Record<ImageProvider, string> = {
  openRouter: "OpenRouter",
  gemini: "Google Gemini",
};

const PROVIDER_KEY = "mcstudio.textureProvider";

/** Dernier service choisi (préférence de ce poste ; OpenRouter par défaut). */
export function loadProvider(): ImageProvider {
  try {
    return localStorage.getItem(PROVIDER_KEY) === "gemini" ? "gemini" : "openRouter";
  } catch {
    return "openRouter";
  }
}

export function saveProvider(provider: ImageProvider): void {
  try {
    localStorage.setItem(PROVIDER_KEY, provider);
  } catch {
    // Stockage indisponible : le choix vaut pour cette fenêtre seulement.
  }
}

/** Modèles pour le menu : gratuits signalés, payants grisés tant qu'ils ne sont pas autorisés. */
export function modelOptions(models: ImageModel[], allowPaid: boolean, provider: ImageProvider = "openRouter"): SelectOption[] {
  return models.map((model) => ({
    value: model.id,
    label: model.name,
    hint: model.free ? "gratuit" : provider === "gemini" ? "facturé par Google" : "payant",
    disabled: !model.free && !allowPaid,
  }));
}

/** Garde le modèle choisi s'il est encore proposé, sinon le premier gratuit. */
export function pickModel(models: ImageModel[], current: string | null, allowPaid: boolean): string | null {
  const usable = models.filter((model) => model.free || allowPaid);
  if (current && usable.some((model) => model.id === current)) return current;
  return usable[0]?.id ?? null;
}
