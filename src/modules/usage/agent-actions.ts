import { defineActions } from "@/core/modules";
import { usageApi } from "./api";

const round = (n: number) => Math.round(n * 100) / 100;

const PERIODS = ["1", "7", "30"];

/** Commandes du module Crédits : consommation, limites d'abonnement, compte Claude, période affichée. */
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
  {
    name: "refresh_claude_limits",
    description: "Actualise les limites d'abonnement de Claude (pourcentage utilisé, date de remise à zéro).",
    risk: "write",
    run: async () => {
      const limits = await usageApi.refreshClaudeLimits();
      const windows = limits.windows.map((w) => ({ id: w.id, usedPercent: Math.round(w.utilization * 100), resetsAt: w.resetsAt }));
      return {
        ok: true,
        message: windows.length === 0 ? "Limites actualisées, aucune fenêtre signalée." : `Limites de Claude : ${windows.map((w) => `${w.id} ${w.usedPercent} pour cent`).join(", ")}.`,
        data: { status: limits.status, windows },
      };
    },
  },
  {
    name: "claude_account",
    description: "Compte Claude connecté : abonnement et méthode de connexion (jamais d'identifiant secret).",
    risk: "read",
    run: async () => {
      const account = await usageApi.claudeAccount();
      return {
        ok: true,
        message: account.loggedIn ? `Claude est connecté${account.subscriptionType ? `, abonnement ${account.subscriptionType}` : ""}.` : "Claude n'est pas connecté.",
        data: { loggedIn: account.loggedIn ?? false, authMethod: account.authMethod ?? null, subscriptionType: account.subscriptionType ?? null },
      };
    },
  },
  {
    name: "show_period",
    description: "Affiche la consommation des dernières 24 heures (1), des 7 ou des 30 derniers jours.",
    params: { days: { type: "string", enum: PERIODS, description: "Période en jours.", required: true } },
    risk: "read",
    run: async (args) => ({ ok: true, message: `Consommation des ${String(args.days)} derniers jours affichée.`, open: { module: "usage", params: { days: String(args.days) } } }),
  },
]);
