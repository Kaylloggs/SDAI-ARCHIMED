import { defineActions, findByName } from "@/core/modules";
import { skillsApi } from "./api";

/** Actions de Skills pour les agents (voix, MCP). */
export default defineActions([
  {
    name: "list_skills",
    description: "Liste les skills installés et s'ils sont activés pour les agents.",
    risk: "read",
    run: async () => {
      const skills = await skillsApi.list();
      const enabled = skills.filter((s) => s.enabled).length;
      return {
        ok: true,
        message: `${skills.length} skill${skills.length > 1 ? "s" : ""}, dont ${enabled} activé${enabled > 1 ? "s" : ""}.`,
        data: { skills: skills.map((s) => ({ id: s.id, name: s.name, description: s.description, enabled: s.enabled })) },
      };
    },
  },
  {
    name: "set_skill_enabled",
    description: "Active ou désactive un skill pour les agents.",
    params: {
      skill: { type: "string", description: "Nom ou identifiant du skill.", required: true },
      enabled: { type: "boolean", description: "true pour activer, false pour désactiver.", required: true },
    },
    risk: "write",
    run: async (args) => {
      const skill = findByName(await skillsApi.list(), String(args.skill), (s) => s.name, (s) => s.id);
      if (!skill) return { ok: false, message: `Skill introuvable ou ambigu : « ${String(args.skill)} ».` };
      await skillsApi.setEnabled(skill.id, args.enabled === true);
      return { ok: true, message: `${skill.name} ${args.enabled === true ? "activé" : "désactivé"}.` };
    },
  },
]);
