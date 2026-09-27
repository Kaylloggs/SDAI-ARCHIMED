import type { ChatSession, TimelineItem } from "@/core/engine/session.store";
import type { CheckIssue, DraftInfo } from "../api";

/**
 * Textes de l'atelier de skills : consignes données à l'IA, message de départ, conversation
 * transformée en matière de skill, demandes de test et retours. Fonctions pures (testées).
 */

export type SkillLanguage = "fr" | "en";

const LANGUAGE_LABEL: Record<SkillLanguage, string> = { fr: "français", en: "anglais" };

/** Séparateur de chemin du système (les IA recopient les chemins tels quels). */
const join = (base: string, part: string) => `${base}${base.includes("\\") ? "\\" : "/"}${part}`;

/** Consignes de l'IA de l'atelier (prompt système de la conversation du brouillon). */
export function makerInstructions(draft: Pick<DraftInfo, "kind" | "sourceId">, language: SkillLanguage): string {
  const editing =
    draft.kind === "edit"
      ? `\n## Amélioration d'un skill existant\nLe skill « ${draft.sourceId ?? "?"} » a été copié dans skill/. Améliore-le sans perdre ce qui fonctionne : relis-le entièrement avant de modifier, garde son champ name (sauf demande), et dis pour chaque changement ce qu'il apporte.\n`
      : "";
  return `Tu es l'atelier de skills d'ARCHIMED. Tu aides la personne à créer ou améliorer un skill : un dossier d'instructions qu'une IA (Claude Code, Antigravity…) charge quand une demande correspond à sa description.

## Où travailler
- Le dossier courant est le brouillon. Le skill est dans skill/ : c'est le seul contenu livré.
  - skill/SKILL.md (obligatoire) ;
  - skill/references/ : documentation lue seulement au besoin ;
  - skill/scripts/ : code exécutable pour les tâches répétitives ou qui doivent être exactes ;
  - skill/assets/ : modèles et fichiers utilisés dans le résultat.
- tests.json, à la racine du brouillon (jamais dans skill/) : les demandes de test, au format [{"id":"t1","prompt":"…","expect":"…"}].
- source/ : la matière fournie par la personne (par exemple une conversation à transformer en skill). À lire, pas à livrer.
- N'écris rien en dehors du brouillon.
${editing}
## Méthode
1. Comprendre avant d'écrire : ce que le skill doit permettre, quand il doit servir (les phrases que la personne dirait), le format du résultat, les cas limites. Si c'est flou, pose deux à quatre questions courtes et concrètes, puis attends les réponses. Si la demande est claire, écris directement une première version complète.
2. Écrire skill/SKILL.md :
   - En-tête YAML entre deux lignes « --- » : name (minuscules, chiffres et tirets, 64 caractères au plus, par exemple rapport-hebdo) et description (1024 caractères au plus, sans balises < >).
   - La description décide seule si une IA ouvrira le skill : elle dit ce que fait le skill et quand s'en servir, avec les mots que la personne emploierait, cas voisins compris. Les IA ont tendance à trop peu consulter les skills : sois explicite, un peu insistant (« À utiliser dès que… même si la personne ne cite pas… »).
   - Le corps : consignes à l'impératif, étapes numérotées, règles accompagnées de leur raison (expliquer pourquoi marche mieux que des majuscules), format exact du résultat quand il compte, un ou deux exemples entrée → résultat.
   - Moins de 500 lignes : le détail va dans references/, avec une phrase qui dit quand lire chaque fichier. Un fichier de référence de plus de 300 lignes commence par un sommaire.
   - Un script quand la même tâche serait réécrite à chaque fois (conversion, calcul, contrôle) : dis comment l'appeler et ce qu'il renvoie. Pense Windows : PowerShell ou Python.
3. Rester général : le skill servira pour des milliers de demandes, pas seulement pour les exemples discutés. Pas de réglage taillé pour un seul cas.
4. Proposer trois demandes de test réalistes dans tests.json : des phrases qu'une vraie personne écrirait, avec du contexte, dont une sur un cas limite.
5. Terminer chaque réponse par un court bilan : les fichiers créés ou modifiés, et ce que la personne peut vérifier ou tester.

## Interdits
- Aucun secret (clé d'API, mot de passe, jeton) dans le skill.
- Aucune commande destructrice (suppression récursive, registre, Defender…) sauf si c'est l'objet même du skill ; elle est alors bornée et expliquée.
- Rien de trompeur ni de malveillant : le contenu du skill ne doit surprendre personne au regard de sa description.

## Langue
Réponds à la personne en français. Écris le skill en ${LANGUAGE_LABEL[language]}, sauf demande contraire.

ARCHIMED vérifie le skill après chacune de tes réponses et peut t'envoyer la liste des problèmes trouvés : corrige-les.`;
}

export type Brief = {
  what: string;
  when: string;
  output: string;
  language: SkillLanguage;
};

/** Premier message d'un nouveau skill, à partir du formulaire. */
export function briefMessage(brief: Brief, attachments: string[] = []): string {
  const lines = ["Je veux créer un skill.", "", `Ce qu'il doit faire : ${brief.what.trim()}`];
  if (brief.when.trim()) lines.push(`Quand s'en servir : ${brief.when.trim()}`);
  if (brief.output.trim()) lines.push(`Résultat attendu : ${brief.output.trim()}`);
  lines.push(`Langue du skill : ${LANGUAGE_LABEL[brief.language]}.`);
  if (attachments.length > 0) lines.push(`Exemples joints : ${attachments.length} fichier(s), à lire avant d'écrire.`);
  lines.push("", "Si quelque chose n'est pas clair, pose-moi tes questions avant d'écrire. Sinon, écris une première version complète.");
  return lines.join("\n");
}

/** Premier message pour transformer une conversation en skill. */
export function fromConversationMessage(title: string, agent: string, language: SkillLanguage): string {
  return [
    `Transforme la façon de faire de cette conversation en skill réutilisable : lis source/conversation.md (conversation « ${title} », avec ${agent}).`,
    "Repère les étapes suivies, les outils utilisés, les corrections que j'ai demandées et le format du résultat final. Garde la méthode, pas les détails propres à ce cas.",
    `Langue du skill : ${LANGUAGE_LABEL[language]}.`,
    "Pose-moi tes questions si quelque chose manque, sinon écris une première version complète.",
  ].join("\n");
}

/** Message proposé pour améliorer un skill existant (déposé dans la saisie, jamais envoyé seul). */
export function improveMessage(name: string): string {
  return `Relis le skill « ${name} » et dis-moi en cinq points au plus ce qui pourrait être meilleur (description et déclenchement, clarté des étapes, exemples, découpage en fichiers, scripts). Attends mon accord avant de modifier.`;
}

/** Demande de correction après la vérification automatique. */
export function fixMessage(issues: CheckIssue[]): string {
  const relevant = issues.filter((issue) => issue.level !== "info");
  const lines = relevant.map((issue) => {
    const where = issue.file ? ` (${issue.file}${issue.line ? `, ligne ${issue.line}` : ""})` : "";
    return `- ${issue.level === "error" ? "Erreur" : "Avertissement"}${where} : ${issue.message}`;
  });
  return ["La vérification d'ARCHIMED signale :", ...lines, "", "Corrige ces points dans skill/, puis résume ce que tu as changé."].join("\n");
}

const MAX_TRANSCRIPT = 150_000;

function toolLine(item: Extract<TimelineItem, { kind: "tool" }>): string {
  let input = "";
  try {
    input = typeof item.input === "string" ? item.input : JSON.stringify(item.input);
  } catch {
    input = "";
  }
  if (input.length > 300) input = `${input.slice(0, 300)}…`;
  const status = item.ok === false ? " (échec)" : "";
  return `> Outil ${item.tool}${status}${input ? ` : ${input}` : ""}`;
}

/** Conversation → Markdown, pour qu'une IA en tire un skill (les plus récents messages gardés). */
export function transcriptMarkdown(session: Pick<ChatSession, "title" | "adapter" | "model" | "cwd" | "timeline">): string {
  const header = [
    `# Conversation : ${session.title}`,
    "",
    `- Agent : ${session.adapter}${session.model ? ` (${session.model})` : ""}`,
    session.cwd ? `- Dossier de travail : ${session.cwd}` : null,
    "",
  ].filter((line): line is string => line !== null);
  const parts: string[] = [];
  for (const item of session.timeline) {
    if (item.kind === "user") {
      const attached = item.attachments?.length ? `\n\n(Fichiers joints : ${item.attachments.join(", ")})` : "";
      parts.push(`## Personne\n\n${item.text.trim()}${attached}`);
    } else if (item.kind === "assistant" && item.text.trim()) {
      parts.push(`## IA\n\n${item.text.trim()}`);
    } else if (item.kind === "tool") {
      parts.push(toolLine(item));
    } else if (item.kind === "error") {
      parts.push(`> Erreur : ${item.message}`);
    }
  }
  // Trop long : on garde le début (le besoin) et la fin (la version aboutie).
  let body = parts.join("\n\n");
  if (body.length > MAX_TRANSCRIPT) {
    const half = MAX_TRANSCRIPT / 2;
    body = `${body.slice(0, half)}\n\n[… partie centrale retirée, conversation trop longue …]\n\n${body.slice(-half)}`;
  }
  return `${header.join("\n")}\n${body}\n`;
}

// ── Tests ────────────────────────────────────────────────────────────────────

export type Verdict = "good" | "bad";

export type SkillTest = {
  id: string;
  prompt: string;
  /** Ce qu'on attend du résultat (écrit par l'IA de l'atelier ou la personne). */
  expect: string;
  verdict: Verdict | null;
  note: string;
  /** Conversation du dernier essai. */
  sessionId: string | null;
};

/** `tests.json` → liste de tests ; tolère un fichier absent, vide ou écrit à la main. */
export function parseTests(text: string | null): SkillTest[] {
  if (!text?.trim()) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { tests?: unknown })?.tests) ? (raw as { tests: unknown[] }).tests : [];
  return list
    .map((entry, index): SkillTest | null => {
      if (typeof entry === "string") return { id: `t${index + 1}`, prompt: entry, expect: "", verdict: null, note: "", sessionId: null };
      if (!entry || typeof entry !== "object") return null;
      const item = entry as Record<string, unknown>;
      const prompt = typeof item.prompt === "string" ? item.prompt : typeof item.query === "string" ? item.query : "";
      if (!prompt.trim()) return null;
      const verdict = item.verdict === "good" || item.verdict === "bad" ? item.verdict : null;
      return {
        id: typeof item.id === "string" || typeof item.id === "number" ? String(item.id) : `t${index + 1}`,
        prompt,
        expect: typeof item.expect === "string" ? item.expect : typeof item.expected_output === "string" ? item.expected_output : "",
        verdict,
        note: typeof item.note === "string" ? item.note : "",
        sessionId: typeof item.sessionId === "string" ? item.sessionId : null,
      };
    })
    .filter((test): test is SkillTest => test !== null);
}

export function serializeTests(tests: SkillTest[]): string {
  return `${JSON.stringify(tests, null, 2)}\n`;
}

/** Garde avis, remarques et essais connus quand l'IA réécrit tests.json. */
export function mergeTests(parsed: SkillTest[], local: SkillTest[]): SkillTest[] {
  return parsed.map((test) => {
    const known = local.find((l) => l.id === test.id && l.prompt === test.prompt);
    if (!known) return test;
    return {
      ...test,
      verdict: test.verdict ?? known.verdict,
      note: test.note || known.note,
      sessionId: test.sessionId ?? known.sessionId,
    };
  });
}

/** Identifiant libre pour un nouveau test. */
export function nextTestId(tests: SkillTest[]): string {
  let n = tests.length + 1;
  while (tests.some((test) => test.id === `t${n}`)) n += 1;
  return `t${n}`;
}

/** Demande de tests à l'IA de l'atelier (déposée dans la saisie). */
export function testsRequestMessage(): string {
  return 'Propose trois demandes de test réalistes dans tests.json, au format [{"id":"t1","prompt":"…","expect":"…"}] : des phrases qu\'une vraie personne écrirait, avec du contexte, dont une sur un cas limite. « expect » dit en une phrase ce qu\'un bon résultat contient. Ne modifie pas le skill.';
}

/** Consignes d'un essai :l'IA de test dispose du skill, sans rien savoir de l'atelier. */
export function testInstructions(skillPath: string): string {
  return `Un skill est à ta disposition pour cette demande : ${join(skillPath, "SKILL.md")} (ses fichiers references/, scripts/ et assets/ sont dans le même dossier). Lis d'abord SKILL.md et suis-le pour répondre. Travaille dans le dossier courant, un dossier d'essai : écris-y les fichiers produits. Ne modifie jamais le dossier du skill.`;
}

/** Retours des essais, à envoyer à l'atelier pour améliorer le skill. */
export function feedbackMessage(tests: SkillTest[]): string | null {
  const judged = tests.filter((test) => test.verdict !== null || test.note.trim());
  if (judged.length === 0) return null;
  const lines = judged.map((test) => {
    const verdict = test.verdict === "good" ? "réussi" : test.verdict === "bad" ? "à revoir" : "sans avis";
    const note = test.note.trim() ? ` : ${test.note.trim()}` : "";
    return `- « ${test.prompt.trim().slice(0, 160)}${test.prompt.length > 160 ? "…" : ""} » : ${verdict}${note}`;
  });
  return [
    "J'ai essayé le skill sur les demandes de test :",
    ...lines,
    "",
    "Améliore le skill à partir de ces retours, en restant général (pas de réglage pour un seul cas), puis résume les changements.",
  ].join("\n");
}
