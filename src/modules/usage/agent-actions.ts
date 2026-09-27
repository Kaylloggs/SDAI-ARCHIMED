import { defineActions } from "@/core/modules";
import { usageApi } from "./api";

const round = (n: number) => Math.round(n * 100) / 100;

/** Actions du module Crédits pour les agents (voix, MCP). */
export default defineActions([
  {
    name: "usage_summary",
    description: "Consommation des agents sur la période : échanges, jetons, coût estimé, limites d'abonnement connues.",
    params: { days: { type: "number", description: "Nombre de jours (7 par défaut, 90 au plus)." } },
    risk: "read",
    run: async (args) => {
      const days = Math.min(90, Math.max(1, Math.round(Number(args.days) || 7)));
      const summary = await usageApi.summary(days);
      const adapters = Object.entries(summary.byAdapter).map(([adapter, t]) => ({
        adapter,
        turns: t.turns,
        tokens: t.inputTokens + t.outputTokens + t.thinkingTokens,
        costUsd: round(t.costUsd),
      }));
      const turns = adapters.reduce((sum, a) => sum + a.turns, 0);
      const cost = round(adapters.reduce((sum, a) => sum + a.costUsd, 0));
      const limits = Object.entries(summary.limits).map(([adapter, l]) => ({
        adapter,
        windows: l.windows.map((w) => ({ id: w.id, usedPercent: Math.round(w.utilization * 100), resetsAt: w.resetsAt })),
      }));
      return {
        ok: true,
        message:
          turns === 0
            ? `Aucun échange avec un agent ces ${days} derniers jours.`
            : `${turns} échange${turns > 1 ? "s" : ""} en ${days} jours${cost > 0 ? `, environ ${cost} dollars` : ""}.`,
        data: { days, adapters, limits },
      };
    },
  },
]);
