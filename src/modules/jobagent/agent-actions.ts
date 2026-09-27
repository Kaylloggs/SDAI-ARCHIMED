import { defineActions } from "@/core/modules";
import { jobagentApi } from "./api";

const STATUS: Record<string, string> = { draft: "brouillon", sent: "envoyée", answered: "réponse reçue", rejected: "refusée" };

/**
 * Actions de JobAgent pour les agents (voix, MCP). Lecture seule : rechercher, écrire et
 * envoyer une candidature restent des gestes faits dans le module, sous les yeux de la personne.
 */
export default defineActions([
  {
    name: "job_overview",
    description: "Résumé de la recherche d'emploi : offres à revoir, favoris, candidatures et leur état.",
    risk: "read",
    run: async () => {
      const state = await jobagentApi.loadState();
      const dismissed = new Set([...(state.dismissed ?? []), ...(state.hidden ?? [])]);
      const seen = new Set(state.seen ?? []);
      const open = state.offers.filter((o) => !dismissed.has(o.id));
      const unseen = open.filter((o) => !seen.has(o.id));
      const starred = open.filter((o) => state.starred.includes(o.id));
      const applications = state.applications.map((a) => ({ title: a.title, company: a.company, status: STATUS[a.status] ?? a.status, updatedAt: a.updatedAt }));
      const sent = state.applications.filter((a) => a.status === "sent").length;
      return {
        ok: true,
        message: `${unseen.length} offre${unseen.length > 1 ? "s" : ""} à revoir, ${starred.length} en favori, ${sent} candidature${sent > 1 ? "s" : ""} envoyée${sent > 1 ? "s" : ""}.`,
        data: {
          lastSearch: state.lastRunAt ?? null,
          starred: starred.slice(0, 15).map((o) => ({ title: o.title, company: o.company, location: o.location, url: o.url })),
          applications,
        },
      };
    },
  },
]);
