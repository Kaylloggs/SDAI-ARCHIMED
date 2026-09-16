const WINDOW_LABELS: Record<string, string> = {
  five_hour: "Fenêtre de 5 heures",
  seven_day: "Semaine glissante (7 jours)",
  seven_day_opus: "Semaine glissante — Opus",
  seven_day_sonnet: "Semaine glissante — Sonnet",
};

export function windowLabel(id: string): string {
  return WINDOW_LABELS[id] ?? id.replaceAll("_", " ");
}

/** Niveau d'alerte d'une fenêtre selon la part consommée. */
export function windowTone(utilization: number): "success" | "warning" | "danger" {
  if (utilization >= 0.9) return "danger";
  if (utilization >= 0.7) return "warning";
  return "success";
}

/** « dans 2 h 10 », « dans 4 j », « maintenant ». `resetsAt` et `now` en secondes Unix. */
export function resetIn(resetsAt: number | null, now: number = Date.now() / 1000): string | null {
  if (!resetsAt) return null;
  const seconds = Math.max(0, Math.round(resetsAt - now));
  if (seconds < 60) return "maintenant";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `dans ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `dans ${hours} h ${String(minutes % 60).padStart(2, "0")}`;
  const days = Math.floor(hours / 24);
  return `dans ${days} j ${hours % 24} h`;
}

/** « il y a 3 min », « il y a 2 h », « il y a 3 j ». */
export function observedAgo(observedAt: number, now: number = Date.now() / 1000): string {
  const minutes = Math.floor(Math.max(0, now - observedAt) / 60);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.floor(hours / 24)} j`;
}

export function formatCost(usd: number): string {
  return usd.toLocaleString("fr-FR", { style: "currency", currency: "USD", maximumFractionDigits: usd < 1 ? 3 : 2 });
}
