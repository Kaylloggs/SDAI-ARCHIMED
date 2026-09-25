/** Consigne structurée : champs éditables, assemblage en texte, lecture d'une proposition. */

export const STRUCTURE = [
  { key: "subject", label: "Sujet", placeholder: "Un dragon aux écailles cuivrées" },
  { key: "environment", label: "Décor", placeholder: "Une rue pavée sous la pluie" },
  { key: "composition", label: "Composition", placeholder: "Plan large, sujet au tiers gauche" },
  { key: "lighting", label: "Lumière", placeholder: "Contre-jour doré, fin de journée" },
  { key: "camera", label: "Appareil et objectif", placeholder: "35 mm, faible profondeur de champ" },
  { key: "materials", label: "Matières", placeholder: "Métal patiné, pierre humide" },
  { key: "colors", label: "Couleurs", placeholder: "Ocres et bleus profonds" },
  { key: "atmosphere", label: "Ambiance", placeholder: "Calme, un peu mystérieuse" },
  { key: "style", label: "Style", placeholder: "Photographie réaliste" },
  { key: "quality", label: "Niveau de détail", placeholder: "Très détaillé, net" },
] as const;

export type StructureKey = (typeof STRUCTURE)[number]["key"];
export type Structure = Partial<Record<StructureKey, string>>;

const KEYS = new Set<string>(STRUCTURE.map((s) => s.key));
const BY_LABEL = new Map<string, StructureKey>(STRUCTURE.map((s) => [s.label.toLowerCase(), s.key]));

/** Champs remplis → une consigne en phrases, dans l'ordre des champs. */
export function composePrompt(structure: Structure): string {
  return STRUCTURE.map((s) => structure[s.key]?.trim().replace(/[.\s]+$/, ""))
    .filter((value): value is string => Boolean(value))
    .join(". ");
}

/**
 * Lit une proposition « clé: valeur » (clés anglaises demandées au modèle, libellés français
 * acceptés). Sans ligne reconnue, tout le texte devient le sujet.
 */
export function parseStructure(text: string): Structure {
  const out: Structure = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*[-*]?\s*([\p{L} ]+?)\s*:\s*(.*)$/u.exec(line);
    if (!match) continue;
    const name = match[1]!.trim().toLowerCase();
    const key = (KEYS.has(name) ? name : BY_LABEL.get(name)) as StructureKey | undefined;
    const value = match[2]!.trim();
    if (key && value) out[key] = value;
  }
  if (Object.keys(out).length === 0 && text.trim()) out.subject = text.trim();
  return out;
}

/** Éléments à garder d'une variante : liste libre séparée par des virgules. */
export function splitList(text: string): string[] {
  return text
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}
