const UNITS: Record<"fr" | "en", Array<[RegExp, string]>> = {
  fr: [
    [/\s?°\s?C\b/g, " degrés"],
    [/\s?°/g, " degrés"],
    [/\s?%/g, " pour cent"],
    [/\s?km\/h\b/g, " kilomètres heure"],
    [/\s&\s/g, " et "],
  ],
  en: [
    [/\s?°\s?C\b/g, " degrees Celsius"],
    [/\s?°\s?F\b/g, " degrees Fahrenheit"],
    [/\s?°/g, " degrees"],
    [/\s?%/g, " percent"],
    [/\s?km\/h\b/g, " kilometers per hour"],
    [/\s?mph\b/g, " miles per hour"],
    [/\s&\s/g, " and "],
  ],
};

/**
 * Texte d'agent → texte à prononcer : pas de Markdown, de code, d'adresses, d'emoji ni de
 * symboles (unités dites en toutes lettres, parenthèses changées en pauses). Le code n'est jamais
 * lu : on dit où il est. `language` : balise BCP-47 de la conversation.
 */
export function speakable(markdown: string, language = "fr"): string {
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
  // Symboles lus de travers par les voix : unités en toutes lettres, flèches et parenthèses en pauses.
  for (const [pattern, spoken] of UNITS[language.toLowerCase().startsWith("en") ? "en" : "fr"]) text = text.replace(pattern, spoken);
  text = text.replace(/\s*(→|->|=>)\s*/g, ", ");
  text = text.replace(/\s*\(\s*/g, ", ").replace(/\s*\)\s*([.,;:!?…]|$)/g, "$1").replace(/\s*\)\s*/g, ", ");
  text = text.replace(/,\s*([.,;:!?…])/g, "$1").replace(/,\s*,/g, ",");
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/^[,\s]+/gm, "")
    .trim();
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
