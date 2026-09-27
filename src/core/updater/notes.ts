/**
 * Textes du panneau de mise à jour. Fonctions pures (testées).
 */

/**
 * Notes de release sans l'en-tête d'installation ajouté par `scripts/release-notes.mjs`
 * (fichiers à télécharger, prérequis), séparé des nouveautés par une ligne `---`.
 */
export function releaseHighlights(notes: string): string {
  const text = notes.replace(/\r\n/g, "\n").trim();
  const separator = /\n-{3,}\n/.exec(text);
  if (!separator || !/^#{1,3}\s*Installation/i.test(text)) return text;
  return text.slice(separator.index + separator[0].length).trim();
}

export function formatMegabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}

export function percent(received: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((received / total) * 100)));
}
