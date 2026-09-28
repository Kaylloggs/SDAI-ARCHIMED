import { defineActions, findByName, type ActionResult } from "@/core/modules";
import { memoryApi, type Note, type NotePatch } from "./api";

const fold = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const project = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

const describe = (n: Note) => ({ id: n.id, text: n.text, project: n.project, enabled: n.enabled });

/** Information désignée par son identifiant ou par quelques mots de son texte. */
async function note(ref: unknown): Promise<Note | null> {
  const wanted = String(ref ?? "").trim();
  if (!wanted) return null;
  return findByName(await memoryApi.listNotes(), wanted, (n) => n.text, (n) => n.id);
}

const missing = (ref: unknown): ActionResult => ({
  ok: false,
  message: `Aucune information (ou plusieurs) ne correspond à « ${String(ref)} ». Cherche-la avec search_notes et donne son identifiant.`,
});

/** Commandes de la Mémoire : tout ce que la page permet (ajouter, modifier, activer, importer, supprimer). */
export default defineActions([
  {
    name: "search_notes",
    description: "Cherche dans les informations mémorisées (préférences, faits sur la personne ou un projet).",
    params: {
      query: { type: "string", description: "Mots à chercher ; vide : les plus récentes." },
      project: { type: "string", description: "Seulement celles de ce dossier de projet." },
    },
    risk: "read",
    run: async (args) => {
      const words = fold(String(args.query ?? "")).split(/\s+/).filter(Boolean);
      const folder = project(args.project);
      const notes = (await memoryApi.listNotes())
        .filter((n) => words.every((word) => fold(n.text).includes(word)))
        .filter((n) => !folder || n.project?.toLowerCase() === folder.toLowerCase())
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 20);
      return {
        ok: true,
        message: notes.length === 0 ? "Rien de mémorisé sur ce sujet." : `${notes.length} information${notes.length > 1 ? "s" : ""} trouvée${notes.length > 1 ? "s" : ""}.`,
        data: { notes: notes.map(describe) },
      };
    },
  },
  {
    name: "remember",
    description: "Mémorise une information durable (transmise ensuite aux IA). Pour un projet précis, indiquer son dossier.",
    params: {
      text: { type: "string", description: "Information, en une phrase.", required: true },
      project: { type: "string", description: "Dossier du projet concerné ; absent : valable partout." },
    },
    risk: "write",
    run: async (args) => {
      const created = await memoryApi.addNote(String(args.text).trim(), project(args.project));
      return { ok: true, message: "C'est mémorisé.", data: { id: created.id } };
    },
  },
  {
    name: "remember_many",
    description: "Mémorise plusieurs informations d'un coup (les doublons sont ignorés).",
    params: {
      texts: { type: "array", description: "Informations (texte), une par élément.", required: true },
      project: { type: "string", description: "Dossier du projet concerné ; absent : valable partout." },
    },
    risk: "write",
    run: async (args) => {
      const texts = (args.texts as unknown[]).map((t) => String(t).trim()).filter(Boolean);
      if (texts.length === 0) return { ok: false, message: "Aucune information à mémoriser." };
      const added = await memoryApi.addNotes(texts, project(args.project));
      return { ok: true, message: `${added} information${added > 1 ? "s" : ""} mémorisée${added > 1 ? "s" : ""}.`, data: { added } };
    },
  },
  {
    name: "update_note",
    description: "Modifie une information : texte, projet (« global » pour la rendre valable partout), transmise aux IA ou mise en pause.",
    params: {
      note: { type: "string", description: "Identifiant, ou quelques mots de l'information.", required: true },
      text: { type: "string", description: "Nouveau texte." },
      project: { type: "string", description: "Dossier du projet, ou « global »." },
      enabled: { type: "boolean", description: "false : gardée mais plus transmise aux IA." },
    },
    risk: "write",
    run: async (args) => {
      const found = await note(args.note);
      if (!found) return missing(args.note);
      const patch: NotePatch = {};
      if (typeof args.text === "string" && args.text.trim()) patch.text = args.text.trim();
      if (typeof args.project === "string") patch.project = ["global", "partout", ""].includes(args.project.trim().toLowerCase()) ? null : args.project.trim();
      if (typeof args.enabled === "boolean") patch.enabled = args.enabled;
      if (Object.keys(patch).length === 0) return { ok: false, message: "Rien à modifier : donne text, project ou enabled." };
      const updated = await memoryApi.updateNote(found.id, patch);
      return { ok: true, message: `Information mise à jour${patch.enabled === false ? ", en pause" : patch.enabled ? ", de nouveau transmise" : ""}.`, data: describe(updated) };
    },
  },
  {
    name: "forget",
    description: "Supprime une information mémorisée.",
    params: { id: { type: "string", description: "Identifiant (search_notes) ou quelques mots de l'information.", required: true } },
    risk: "destructive",
    confirm: () => "Supprimer cette information de la mémoire ?",
    run: async (args) => {
      const found = await note(args.id);
      if (!found) return missing(args.id);
      await memoryApi.deleteNote(found.id);
      return { ok: true, message: `Oublié : « ${found.text.slice(0, 80)} ».` };
    },
  },
  {
    name: "import_notes",
    description: "Importe les informations d'un fichier .txt, .md ou .json (une par ligne ou par élément).",
    params: {
      path: { type: "string", description: "Chemin du fichier.", required: true },
      project: { type: "string", description: "Dossier du projet concerné ; absent : valables partout." },
    },
    risk: "write",
    run: async (args) => {
      const texts = await memoryApi.readImport(String(args.path));
      if (texts.length === 0) return { ok: false, message: "Aucune information trouvée dans ce fichier." };
      const added = await memoryApi.addNotes(texts, project(args.project));
      return { ok: true, message: `${added} information${added > 1 ? "s" : ""} importée${added > 1 ? "s" : ""} sur ${texts.length}.`, data: { added, read: texts.length } };
    },
  },
  {
    name: "set_injection",
    description: "Active ou coupe la transmission de la mémoire aux IA (réglage « Transmettre aux IA »).",
    params: { enabled: { type: "boolean", description: "true : transmise ; false : plus transmise.", required: true } },
    risk: "write",
    run: async (args) => {
      await memoryApi.setSettings({ inject: args.enabled === true });
      return { ok: true, message: args.enabled ? "La mémoire est de nouveau transmise aux IA." : "La mémoire n'est plus transmise aux IA." };
    },
  },
  {
    name: "preview_context",
    description: "Montre ce que les IA reçoivent de la mémoire, partout ou pour un dossier de projet.",
    params: { project: { type: "string", description: "Dossier du projet (sinon : informations globales)." } },
    risk: "read",
    run: async (args) => {
      const [settings, text] = await Promise.all([memoryApi.getSettings(), memoryApi.previewContext(project(args.project))]);
      return {
        ok: true,
        message: !settings.inject ? "La transmission aux IA est coupée." : text ? "Voici ce que les IA reçoivent." : "Rien n'est transmis pour l'instant.",
        data: { inject: settings.inject, context: text },
      };
    },
  },
]);
