/** Mentions « @fichier » de la zone de saisie : détection, recherche approximative, insertion. */

export type MentionToken = { query: string; start: number; end: number };

/** `@src/ap` juste avant le curseur (début de texte ou après un espace). */
export function mentionAt(text: string, caret: number): MentionToken | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([^\s@]*)$/.exec(before);
  if (!match) return null;
  const start = caret - match[2]!.length - 1;
  return { query: match[2]!, start, end: caret };
}

/**
 * Score approximatif : toutes les lettres de la requête dans l'ordre, bonus pour le nom de
 * fichier, les débuts de segment et les lettres consécutives. `-1` : absent.
 */
export function fuzzyScore(path: string, query: string): number {
  if (!query) return 1;
  const p = path.toLowerCase();
  const q = query.toLowerCase();
  const name = p.slice(p.lastIndexOf("/") + 1);
  if (name.startsWith(q)) return 1000 - p.length;
  if (name.includes(q)) return 800 - p.length;
  if (p.includes(q)) return 600 - p.length;
  let score = 0;
  let from = 0;
  let previous = -2;
  for (const char of q) {
    const index = p.indexOf(char, from);
    if (index === -1) return -1;
    score += index === previous + 1 ? 5 : 1;
    if (index === 0 || p[index - 1] === "/" || p[index - 1] === "-" || p[index - 1] === "_") score += 3;
    previous = index;
    from = index + 1;
  }
  return score - p.length / 100;
}

export function searchFiles(files: string[], query: string, limit = 8): string[] {
  return files
    .map((path) => ({ path, score: fuzzyScore(path, query) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit)
    .map((entry) => entry.path);
}

/** Remplace la mention par `@chemin ` et renvoie le texte et la nouvelle position du curseur. */
export function insertMention(text: string, token: MentionToken, path: string): { text: string; caret: number } {
  const inserted = `@${path} `;
  return { text: text.slice(0, token.start) + inserted + text.slice(token.end), caret: token.start + inserted.length };
}
