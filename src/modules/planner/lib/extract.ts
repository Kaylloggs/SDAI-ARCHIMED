/**
 * Détecte, dans un message d'assistant, ce qui mérite une proposition :
 * - des tâches (cases à cocher Markdown, lignes « TODO : ») → Planner ;
 * - des dates (ISO, JJ/MM/AAAA, « 12 octobre 2026 ») → agenda.
 */

export type ExtractedTask = { title: string; due: string | null; done: boolean };
export type ExtractedEvent = { title: string; date: string };

const MONTHS: Record<string, number> = {
  janvier: 1, février: 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7,
  août: 8, aout: 8, septembre: 9, octobre: 10, novembre: 11, décembre: 12, decembre: 12,
};

const CHECKBOX = /^\s*[-*+]\s+\[( |x|X)\]\s+(.+?)\s*$/;
const TODO = /^\s*(?:[-*+]\s+)?(?:TODO|À faire|A faire)\s*:\s*(.+?)\s*$/i;
const ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const SLASH = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/;
const FRENCH = new RegExp(
  `\\b(\\d{1,2})(?:er)?\\s+(${Object.keys(MONTHS).join("|")})(?:\\s+(\\d{4}))?\\b`,
  "i",
);

const pad = (value: number) => String(value).padStart(2, "0");

function validDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Première date trouvée dans une ligne, au format AAAA-MM-JJ. */
export function findDate(line: string, now: Date = new Date()): string | null {
  const iso = ISO.exec(line);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const slash = SLASH.exec(line);
  if (slash) return validDate(Number(slash[3]), Number(slash[2]), Number(slash[1]));

  const french = FRENCH.exec(line);
  if (french) {
    const month = MONTHS[french[2]!.toLowerCase()];
    if (!month) return null;
    const day = Number(french[1]);
    let year = french[3] ? Number(french[3]) : now.getFullYear();
    // Sans année : la prochaine occurrence de cette date.
    if (!french[3]) {
      const candidate = new Date(year, month - 1, day);
      if (candidate < new Date(now.getFullYear(), now.getMonth(), now.getDate())) year += 1;
    }
    return validDate(year, month, day);
  }
  return null;
}

/** Retire la mise en forme Markdown légère d'un titre. */
function clean(text: string): string {
  return text
    .replace(/\*\*|__|`/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#+\s*/, "")
    .replace(/\s*@\d{4}-\d{2}-\d{2}\b/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractTasks(text: string, now: Date = new Date()): ExtractedTask[] {
  const tasks: ExtractedTask[] = [];
  let inCode = false;

  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;

    const checkbox = CHECKBOX.exec(line);
    const todo = checkbox ? null : TODO.exec(line);
    const raw = checkbox?.[2] ?? todo?.[1];
    if (!raw) continue;

    const title = clean(raw);
    if (title.length < 3) continue;
    tasks.push({
      title,
      due: findDate(raw, now),
      done: checkbox ? checkbox[1]!.toLowerCase() === "x" : false,
    });
  }
  return tasks;
}

export function extractEvents(text: string, now: Date = new Date()): ExtractedEvent[] {
  const events: ExtractedEvent[] = [];
  const seen = new Set<string>();
  let inCode = false;

  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;

    const date = findDate(line, now);
    if (!date) continue;
    const title = clean(line.replace(CHECKBOX, "$2").replace(/^\s*[-*+]\s+/, ""));
    const key = `${date}:${title}`;
    if (title.length < 3 || seen.has(key)) continue;
    seen.add(key);
    events.push({ title: title.length > 120 ? `${title.slice(0, 117)}…` : title, date });
  }
  return events;
}
