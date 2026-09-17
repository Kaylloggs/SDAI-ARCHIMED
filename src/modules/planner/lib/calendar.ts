/**
 * Lien « Ajouter à Google Agenda » pré-rempli (événement journée entière).
 * Aucune authentification : Google ouvre sa page de création, l'utilisateur valide.
 * La synchronisation automatique (API Google Calendar) exige un identifiant OAuth
 * Google Cloud propre à l'utilisateur — voir le README du module.
 */
export function googleCalendarUrl(event: { title: string; date: string; details?: string }): string {
  const start = event.date.replaceAll("-", "");
  const next = new Date(`${event.date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const end = next.toISOString().slice(0, 10).replaceAll("-", "");

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${start}/${end}`,
  });
  if (event.details) params.set("details", event.details);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

const formatter = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });

export function formatDue(date: string): string {
  return formatter.format(new Date(`${date}T00:00:00`));
}

/** « en retard », « aujourd'hui », « bientôt » (≤ 3 jours) ou `null`. */
export function dueState(date: string, now: Date = new Date()): "late" | "today" | "soon" | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const due = new Date(`${date}T00:00:00`).getTime();
  const days = Math.round((due - today) / 86_400_000);
  if (days < 0) return "late";
  if (days === 0) return "today";
  if (days <= 3) return "soon";
  return null;
}

/** `AAAA-MM-JJ` en heure locale. */
export function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Grille d'un mois affichée du lundi au dimanche : 5 ou 6 semaines complètes,
 * jours des mois voisins inclus (`inMonth: false`).
 */
export function monthGrid(year: number, month: number): Array<{ date: string; day: number; inMonth: boolean }> {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // lundi = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weeks = Math.ceil((offset + daysInMonth) / 7);
  return Array.from({ length: weeks * 7 }, (_, index) => {
    const date = new Date(year, month, index - offset + 1);
    return { date: isoDate(date), day: date.getDate(), inMonth: date.getMonth() === month };
  });
}

const monthFormatter = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });

export function formatMonth(year: number, month: number): string {
  const label = monthFormatter.format(new Date(year, month, 1));
  return label.charAt(0).toUpperCase() + label.slice(1);
}
