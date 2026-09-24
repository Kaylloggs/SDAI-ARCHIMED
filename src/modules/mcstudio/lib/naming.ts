/**
 * Identifiants dérivés du nom du mod, et leur validation immédiate dans l'assistant.
 * Le backend refait les mêmes contrôles : ceci n'est qu'un retour instantané.
 */

const RESERVED = new Set([
  "minecraft", "java", "forge", "neoforge", "fabric", "fabricloader", "fabric_api", "mcp", "realms", "c", "common",
  "quilt",
]);

const JAVA_KEYWORDS = new Set([
  "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char", "class", "const", "continue",
  "default", "do", "double", "else", "enum", "extends", "final", "finally", "float", "for", "goto", "if",
  "implements", "import", "instanceof", "int", "interface", "long", "native", "new", "package", "private",
  "protected", "public", "return", "short", "static", "strictfp", "super", "switch", "synchronized", "this",
  "throw", "throws", "transient", "try", "void", "volatile", "while", "true", "false", "null", "var", "record",
  "yield",
]);

/** Retire les accents et tout ce qui n'est pas une lettre ou un chiffre. */
function words(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

/** « Dragon Realms » → `dragonrealms`. */
export function suggestModId(name: string): string {
  const id = words(name).join("").toLowerCase();
  const trimmed = /^[a-z]/.test(id) ? id : id ? `mod${id}` : "";
  return trimmed.slice(0, 64);
}

/** « Dragon Realms » → `DragonRealms`. */
export function suggestMainClass(name: string): string {
  const pascal = words(name)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join("");
  const safe = /^[A-Z]/.test(pascal) ? pascal : pascal ? `Mod${pascal}` : "";
  return safe.slice(0, 64);
}

/** Auteur « Alix Seara », mod `dragonrealms` → `com.alixseara.dragonrealms`. */
export function suggestPackage(author: string, modId: string): string {
  const owner = words(author).join("").toLowerCase().replace(/^[^a-z]+/, "");
  const segment = owner && !JAVA_KEYWORDS.has(owner) ? owner : "example";
  return `com.${segment}.${modId || "monmod"}`;
}

/** `null` si valide, sinon la raison, en clair. */
export function modIdProblem(modId: string): string | null {
  if (!modId) return "Le Mod ID est obligatoire.";
  if (modId.length < 2 || modId.length > 64) return "2 à 64 caractères.";
  if (/\s/.test(modId)) return "Pas d'espace dans un Mod ID.";
  if (/[A-Z]/.test(modId)) return "Minuscules uniquement.";
  if (modId.includes("-")) return "Pas de tiret : Forge et NeoForge le refusent. Utilisez _.";
  if (!/^[a-z]/.test(modId)) return "Commence par une lettre.";
  if (!/^[a-z][a-z0-9_]*$/.test(modId)) return "Lettres minuscules, chiffres et _ uniquement.";
  if (RESERVED.has(modId)) return `« ${modId} » est réservé par Minecraft ou un loader.`;
  return null;
}

export function packageProblem(pkg: string): string | null {
  if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)+$/.test(pkg)) {
    return "Au moins deux segments en minuscules, séparés par des points (com.pseudo.monmod).";
  }
  const keyword = pkg.split(".").find((segment) => JAVA_KEYWORDS.has(segment));
  return keyword ? `« ${keyword} » est un mot réservé de Java.` : null;
}

export function mainClassProblem(name: string): string | null {
  if (!/^[A-Z][A-Za-z0-9_]{0,63}$/.test(name)) return "Commence par une majuscule, lettres et chiffres (DragonRealms).";
  if (name === "ModItems" || name === "ModBlocks") return "Ce nom est déjà pris par les registres du mod.";
  return null;
}

export function nameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Donnez un nom à votre mod.";
  if ([...trimmed].length > 64) return "64 caractères au plus.";
  return null;
}

/** « Épée de rubis » → `epee_de_rubis` (nom de registre d'un objet ou d'un bloc). */
export function suggestRegistryId(name: string): string {
  const id = words(name).join("_").toLowerCase();
  const safe = /^[a-z]/.test(id) ? id : id ? `x_${id}` : "";
  return safe.slice(0, 64);
}

/** `null` si valide (mêmes règles que le backend). */
export function registryIdProblem(id: string): string | null {
  if (!id) return "Le nom de registre est obligatoire.";
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(id)) {
    return "Minuscules, chiffres et _ uniquement, en commençant par une lettre.";
  }
  return null;
}
