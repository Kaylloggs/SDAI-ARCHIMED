/** Mise en forme : fournisseurs, états de connexion, coûts, dates, versions. */
import type { ConnectionState } from "@/core/ipc/bindings/ConnectionState";
import type { ImageJobStatus } from "@/core/ipc/bindings/ImageJobStatus";
import type { ImageNodeKind } from "@/core/ipc/bindings/ImageNodeKind";
import type { ImageUsage } from "@/core/ipc/bindings/ImageUsage";
import type { PriceLine } from "@/core/ipc/bindings/PriceLine";
import type { ProviderId } from "@/core/ipc/bindings/ProviderId";

export const PROVIDERS: ProviderId[] = ["openrouter", "gemini", "higgsfield"];

export const PROVIDER_NAMES: Record<ProviderId, string> = {
  openrouter: "OpenRouter",
  gemini: "Google AI Studio",
  higgsfield: "Higgsfield",
};

/**
 * Sites officiels, pour le mode compte : on y crée avec son abonnement, puis on importe le
 * résultat (Téléchargements, glisser-déposer, presse-papiers). Aucun mot de passe ne passe ici.
 */
export const PROVIDER_SITES: Record<ProviderId, { url: string; label: string }> = {
  openrouter: { url: "https://openrouter.ai/chat", label: "openrouter.ai" },
  gemini: { url: "https://aistudio.google.com/", label: "aistudio.google.com" },
  higgsfield: { url: "https://higgsfield.ai/", label: "higgsfield.ai" },
};

export type Tone = "success" | "info" | "warning" | "danger" | "neutral";

export const STATE_LABELS: Record<ConnectionState, { label: string; tone: Tone }> = {
  connected: { label: "Connecté", tone: "success" },
  disconnected: { label: "Clé non vérifiée", tone: "info" },
  error: { label: "Erreur", tone: "danger" },
  authRequired: { label: "Clé refusée", tone: "warning" },
  apiKeyMissing: { label: "Clé manquante", tone: "neutral" },
  modelUnavailable: { label: "Aucun modèle d'image", tone: "warning" },
};

export const JOB_LABELS: Record<ImageJobStatus, { label: string; tone: Tone }> = {
  waiting: { label: "En attente", tone: "neutral" },
  running: { label: "En cours", tone: "info" },
  completed: { label: "Terminée", tone: "success" },
  failed: { label: "Échec", tone: "danger" },
  cancelled: { label: "Annulée", tone: "neutral" },
};

export const KIND_LABELS: Record<ImageNodeKind, string> = {
  import: "Import",
  generate: "Génération",
  edit: "Modification",
  inpaint: "Zone",
  outpaint: "Extension",
  variation: "Variante",
  restyle: "Style",
  upscale: "Agrandissement",
  background: "Fond",
  restore: "Restauration",
  combine: "Composition",
  crop: "Recadrage",
  resize: "Taille",
  rotate: "Rotation",
  flip: "Miroir",
  adjust: "Réglages",
  move: "Déplacement",
  paint: "Pinceau",
  chromaKey: "Détourage",
  blur: "Flou",
};

const money = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "USD", maximumFractionDigits: 4 });

export function formatUsd(value: number): string {
  return money.format(value);
}

const UNITS: Record<string, string> = {
  image: "image",
  request: "demande",
  megapixel: "mégapixel",
  token: "token",
};

/** « 0,04 $US par image » : tel que publié par le fournisseur. */
export function priceText(line: PriceLine): string {
  const unit = UNITS[line.unit] ?? line.unit;
  return `${line.label} : ${formatUsd(line.costUsd)} par ${unit}`;
}

/** Coût rapporté par le fournisseur, ou ce qu'il en dit. Jamais d'estimation. */
export function usageText(usage: ImageUsage | null | undefined): string | null {
  if (!usage) return null;
  const parts: string[] = [];
  if (usage.costUsd !== null) parts.push(`Coût : ${formatUsd(usage.costUsd)}`);
  if (usage.note) parts.push(usage.note);
  if (usage.costUsd === null && !usage.note) parts.push("Coût non communiqué par le fournisseur.");
  return parts.join(" · ");
}

const relative = new Intl.RelativeTimeFormat("fr-FR", { numeric: "auto" });

export function ago(timestamp: number, now = Date.now()): string {
  const seconds = Math.round((timestamp - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "à l'instant";
  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return relative.format(Math.round(seconds / 3600), "hour");
  return relative.format(Math.round(seconds / 86400), "day");
}

export function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
}

/** Durée d'une tâche : « 12 s », « 1 min 05 ». */
export function elapsed(from: number, to: number): string {
  const total = Math.max(0, Math.round((to - from) / 1000));
  if (total < 60) return `${total} s`;
  return `${Math.floor(total / 60)} min ${String(total % 60).padStart(2, "0")}`;
}
