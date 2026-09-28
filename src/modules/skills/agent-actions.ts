import { defineActions, findByName, type ActionResult } from "@/core/modules";
import { skillsApi, type DraftInfo, type DraftReport } from "./api";

async function skill(ref: unknown) {
  return findByName(await skillsApi.list(), String(ref ?? ""), (s) => s.name, (s) => s.id);
}

async function draft(ref: unknown): Promise<DraftInfo | null> {
  return findByName(await skillsApi.draftList(), String(ref ?? ""), (d) => d.name || d.id, (d) => d.id);
}

const noDraft = (ref: unknown): ActionResult => ({ ok: false, message: `Brouillon introuvable : « ${String(ref)} ». Appelle list_drafts.` });

const problems = (report: DraftReport) =>
  report.issues.filter((i) => i.level === "error").map((i) => `${i.message}${i.file ? ` (${i.file}${i.line ? `:${i.line}` : ""})` : ""}`);

/** Nom de skill valide : minuscules, chiffres et tirets. */
const slug = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

/** Commandes de Skills : bibliothèque (activer, importer) et atelier (brouillons, écriture, enregistrement). */
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
      const found = await skill(args.skill);
      if (!found) return { ok: false, message: `Skill introuvable ou ambigu : « ${String(args.skill)} ».` };
      await skillsApi.setEnabled(found.id, args.enabled === true);
      return { ok: true, message: `${found.name} ${args.enabled === true ? "activé" : "désactivé"}.` };
    },
  },
  {
    name: "import_skill",
    description: "Importe dans la bibliothèque un skill depuis son dossier (qui contient SKILL.md).",
    params: { path: { type: "string", description: "Dossier du skill.", required: true } },
    risk: "write",
    run: async (args) => {
      const imported = await skillsApi.importFromPath(String(args.path));
      return { ok: true, message: `Skill ${imported.name} importé.`, data: { id: imported.id } };
    },
  },
  {
    name: "open_skills_folder",
    description: "Ouvre le dossier de la bibliothèque de skills dans l'explorateur.",
    risk: "read",
    run: async () => {
      await skillsApi.openFolder();
      return { ok: true, message: "Dossier des skills ouvert.", data: { path: await skillsApi.libraryPath().catch(() => null) } };
    },
  },
  {
    name: "write_skill",
    description:
      "Crée (ou remplace) un skill directement : nom, description qui dit quand s'en servir, et instructions (corps Markdown du SKILL.md). Vérifié puis enregistré dans la bibliothèque.",
    params: {
      name: { type: "string", description: "Nom (minuscules, chiffres, tirets).", required: true },
      description: { type: "string", description: "Ce que fait le skill et quand l'utiliser (1024 caractères au plus).", required: true },
      instructions: { type: "string", description: "Corps du SKILL.md (Markdown, consignes à l'impératif).", required: true },
      replace: { type: "boolean", description: "Remplacer un skill du même nom (sauvegardé avant)." },
      enable: { type: "boolean", description: "Activer pour les agents (true par défaut)." },
    },
    risk: "write",
    run: async (args) => {
      const name = slug(String(args.name));
      if (!name) return { ok: false, message: "Nom de skill invalide." };
      const description = String(args.description).replace(/[<>]/g, "").trim();
      const created = await skillsApi.draftCreate(null);
      const body = `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${String(args.instructions).trim()}\n`;
      await skillsApi.draftWrite(created.id, "skill/SKILL.md", body);
      const report = await skillsApi.draftCheck(created.id);
      if (!report.ready) {
        return { ok: false, message: `Skill non enregistré, à corriger : ${problems(report).join(" ; ")}. Brouillon gardé (${created.id}).`, data: { draftId: created.id } };
      }
      if (report.targetExists && args.replace !== true) {
        return { ok: false, message: `Un skill ${name} existe déjà : relance avec replace à true pour le remplacer. Brouillon gardé (${created.id}).`, data: { draftId: created.id } };
      }
      const saved = await skillsApi.draftSave(created.id, report.targetExists, args.enable !== false);
      return { ok: true, message: `Skill ${saved.name} enregistré${args.enable !== false ? " et activé" : ""}.`, data: { id: saved.id, path: saved.path } };
    },
  },
  {
    name: "list_drafts",
    description: "Liste les brouillons de l'atelier de skills (en cours, pas encore enregistrés ou modifiés depuis).",
    risk: "read",
    run: async () => {
      const drafts = await skillsApi.draftList();
      return {
        ok: true,
        message: drafts.length === 0 ? "Aucun brouillon." : `${drafts.length} brouillon${drafts.length > 1 ? "s" : ""}.`,
        data: { drafts: drafts.map((d) => ({ id: d.id, name: d.name, description: d.description, kind: d.kind, source: d.sourceId, saved: d.savedAs, path: d.path })) },
      };
    },
  },
  {
    name: "open_maker",
    description: "Ouvre l'atelier de skills : nouveau skill, reprise d'un brouillon, ou amélioration d'un skill existant (l'IA de l'atelier y travaille avec la personne).",
    params: {
      draft: { type: "string", description: "Brouillon à reprendre (nom ou identifiant)." },
      improve: { type: "string", description: "Skill de la bibliothèque à améliorer." },
    },
    risk: "read",
    run: async (args) => {
      if (args.draft) {
        const found = await draft(args.draft);
        if (!found) return noDraft(args.draft);
        return { ok: true, message: "Brouillon ouvert dans l'atelier.", open: { module: "skills", params: { draftId: found.id } } };
      }
      if (args.improve) {
        const found = await skill(args.improve);
        if (!found) return { ok: false, message: `Skill introuvable : « ${String(args.improve)} ».` };
        return { ok: true, message: `Atelier ouvert pour améliorer ${found.name}.`, open: { module: "skills", params: { improveId: found.id, improveName: found.name } } };
      }
      return { ok: true, message: "Atelier ouvert sur un nouveau skill.", open: { module: "skills", params: { create: true } } };
    },
  },
  {
    name: "check_draft",
    description: "Vérifie un brouillon : erreurs et avertissements, prêt ou non à entrer dans la bibliothèque.",
    params: { draft: { type: "string", description: "Brouillon (nom ou identifiant).", required: true } },
    risk: "read",
    run: async (args) => {
      const found = await draft(args.draft);
      if (!found) return noDraft(args.draft);
      const report = await skillsApi.draftCheck(found.id);
      return {
        ok: true,
        message: report.ready ? `Brouillon prêt${report.targetExists ? " (remplacera le skill du même nom)" : ""}.` : `À corriger : ${problems(report).join(" ; ")}.`,
        data: { ready: report.ready, targetExists: report.targetExists, issues: report.issues },
      };
    },
  },
  {
    name: "save_draft",
    description: "Enregistre un brouillon prêt dans la bibliothèque (remplace le skill du même nom si replace).",
    params: {
      draft: { type: "string", description: "Brouillon (nom ou identifiant).", required: true },
      replace: { type: "boolean", description: "Remplacer le skill du même nom (sauvegardé avant)." },
      enable: { type: "boolean", description: "Activer pour les agents (true par défaut)." },
    },
    risk: "write",
    run: async (args) => {
      const found = await draft(args.draft);
      if (!found) return noDraft(args.draft);
      const report = await skillsApi.draftCheck(found.id);
      if (!report.ready) return { ok: false, message: `À corriger avant d'enregistrer : ${problems(report).join(" ; ")}.` };
      if (report.targetExists && args.replace !== true) return { ok: false, message: "Un skill du même nom existe : relance avec replace à true pour le remplacer." };
      const saved = await skillsApi.draftSave(found.id, report.targetExists, args.enable !== false);
      return { ok: true, message: `Skill ${saved.name} enregistré.`, data: { id: saved.id } };
    },
  },
  {
    name: "delete_draft",
    description: "Met un brouillon de l'atelier à la Corbeille.",
    params: { draft: { type: "string", description: "Brouillon (nom ou identifiant).", required: true } },
    risk: "destructive",
    confirm: (args) => `Mettre le brouillon « ${String(args.draft)} » à la Corbeille ?`,
    run: async (args) => {
      const found = await draft(args.draft);
      if (!found) return noDraft(args.draft);
      await skillsApi.draftDelete(found.id);
      return { ok: true, message: `Brouillon ${found.name || found.id} mis à la Corbeille.` };
    },
  },
]);
