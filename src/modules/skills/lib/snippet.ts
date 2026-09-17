import type { Skill } from "../api";

/**
 * Texte inséré dans le message. Claude charge nativement un skill activé pour lui (`/nom`) ;
 * pour les autres CLI, ou un skill non synchronisé, on désigne son SKILL.md à lire.
 */
export function skillSnippet(skill: Pick<Skill, "id" | "name" | "path" | "targets">, adapter: string | undefined): string {
  if (adapter === "claude" && skill.targets.includes("claude")) {
    const command = /^[\w-]+$/.test(skill.name) ? skill.name : skill.id;
    return `/${command} `;
  }
  const separator = skill.path.includes("\\") ? "\\" : "/";
  return `Utilise le skill « ${skill.name} » : lis d'abord ${skill.path}${separator}SKILL.md et applique ses instructions.\n\n`;
}
