/**
 * Texte d'agent → texte à prononcer : pas de Markdown, de code, d'adresses ni d'emoji.
 * Le code n'est jamais lu : on dit où il est.
 */
export function speakable(markdown: string): string {
  let text = markdown;
  // Blocs de code : remplacés par une mention courte.
  text = text.replace(/```[\s\S]*?(```|$)/g, " (code affiché à l'écran) ");
  text = text.replace(/`([^`]+)`/g, "$1");
  // Liens : on garde le texte.
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  text = text.replace(/https?:\/\/\S+/g, "le lien");
  // Titres, listes, emphase, citations, tableaux.
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  text = text.replace(/^\s*[-*+]\s+/gm, "");
  text = text.replace(/^\s*\d+[.)]\s+/gm, "");
  text = text.replace(/^\s*>\s?/gm, "");
  text = text.replace(/\|/g, ", ");
  text = text.replace(/(\*\*|__)(.*?)\1/g, "$2");
  text = text.replace(/(\*|_)(\S.*?\S|\S)\1/g, "$2");
  // Emoji et pictogrammes.
  text = text.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "");
  return text.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

/** Première phrase ou deux, pour un résumé parlé. */
export function firstSentences(text: string, count = 2, max = 280): string {
  const sentences = speakable(text)
    .replace(/\n+/g, " ")
    .match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g);
  const joined = (sentences ?? [])
    .slice(0, count)
    .map((s) => s.trim())
    .join(" ");
  return joined.length > max ? `${joined.slice(0, max - 1).trimEnd()}…` : joined;
}
