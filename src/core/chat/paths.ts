/**
 * Repérage des chemins de fichiers cités dans une réponse d'IA.
 * Volontairement large : seuls les chemins qui existent sur le disque deviennent des liens
 * (résolution côté Rust, `engine_resolve_paths`).
 */

const ABSOLUTE = /^(?:[a-zA-Z]:[\\/]|\\\\[^\\]|~[\\/]|\/)/;
const RELATIVE_WITH_SEPARATOR = /^\.{0,2}[\\/]?[\w@.-]+(?:[\\/][\w@.-]+)+[\\/]?$/;
const FILE_NAME = /^[\w@.-]*\w\.[a-zA-Z][a-zA-Z0-9]{0,9}$/;
const LINE_SUFFIX = /(?::\d+){1,2}$/;

/** Retire les décorations courantes : guillemets, `:12:3`, ponctuation finale. */
export function cleanPathText(text: string): string {
  return text
    .trim()
    .replace(/[,;.)]+$/, "")
    .replace(/^["'`]|["'`]$/g, "")
    .replace(LINE_SUFFIX, "");
}

export function looksLikePath(raw: string): boolean {
  const text = cleanPathText(raw);
  if (text.length < 3 || text.length > 400 || text.includes("\n")) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return false; // URL
  if (ABSOLUTE.test(text)) return !/[<>|?*]/.test(text.slice(2));
  if (/\s/.test(text)) return false;
  if (/^\d+(?:\.\d+)+$/.test(text)) return false; // numéro de version
  return RELATIVE_WITH_SEPARATOR.test(text) || FILE_NAME.test(text);
}

/** Candidats d'un message markdown : code en ligne et cibles de liens non web. */
export function pathCandidates(markdown: string): string[] {
  const found = new Set<string>();
  for (const match of markdown.matchAll(/(?<!`)`([^`\n]+)`(?!`)/g)) {
    if (match[1] && looksLikePath(match[1])) found.add(cleanPathText(match[1]));
  }
  for (const match of markdown.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1] ? decodeLinkTarget(match[1]) : "";
    if (target && looksLikePath(target)) found.add(cleanPathText(target));
  }
  return [...found];
}

/** `file:///C:/x%20y` → `C:/x y`. */
export function decodeLinkTarget(href: string): string {
  let target = href.replace(/^file:\/\/\/?/i, "");
  try {
    target = decodeURIComponent(target);
  } catch {
    // encodage invalide : on garde la forme brute
  }
  return target;
}

export function isAbsolutePath(text: string): boolean {
  return ABSOLUTE.test(text);
}
