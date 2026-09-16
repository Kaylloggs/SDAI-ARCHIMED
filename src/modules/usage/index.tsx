import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Gauge, Loader2, OctagonAlert, RefreshCw } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { useAdapters } from "@/core/engine/useAdapters";
import { formatDuration, formatTokens } from "@/core/chat/activity";
import { Badge, Button, Card, EmptyState, SectionHeader, Select } from "@/design-system/primitives";
import { usageApi, type AdapterLimits, type ClaudeAccount, type Totals, type UsageSummary } from "./api";
import { formatCost, observedAgo, resetIn, windowLabel, windowTone } from "./lib/format";

const PERIODS = [
  { value: "1", label: "Dernières 24 h" },
  { value: "7", label: "7 derniers jours" },
  { value: "30", label: "30 derniers jours" },
];

const TONE_STYLE = {
  success: { bar: "bg-success", text: "text-success", Icon: CheckCircle2, label: "Confortable" },
  warning: { bar: "bg-warning", text: "text-warning", Icon: AlertTriangle, label: "Élevé" },
  danger: { bar: "bg-danger", text: "text-danger", Icon: OctagonAlert, label: "Presque épuisé" },
} as const;

function LimitMeter({ id, utilization, resetsAt }: { id: string; utilization: number; resetsAt: number | null }) {
  const percent = Math.round(utilization * 100);
  const tone = TONE_STYLE[windowTone(utilization)];
  const reset = resetIn(resetsAt);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-body-sm">{windowLabel(id)}</span>
        <span className="text-body-sm tabular-nums">
          <span className="font-semibold">{100 - percent} %</span>
          <span className="text-text-subtle"> restant</span>
        </span>
      </div>
      <div
        role="meter"
        aria-label={`${windowLabel(id)} : ${percent} % utilisé`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 overflow-hidden rounded-full bg-surface-3"
      >
        <div className={cn("h-full rounded-full transition-[width] duration-500", tone.bar)} style={{ width: `${percent}%` }} />
      </div>
      <div className="flex items-center justify-between gap-3 text-caption text-text-subtle">
        <span className="inline-flex items-center gap-1">
          <tone.Icon size={11} strokeWidth={2} className={tone.text} />
          {tone.label} · {percent} % utilisé
        </span>
        {reset && <span>Réinitialisation {reset}</span>}
      </div>
    </div>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[12px] border border-border bg-surface-1 px-3 py-2.5" title={hint}>
      <p className="text-caption text-text-subtle">{label}</p>
      <p className="pt-0.5 text-title-3 font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function TotalsTiles({ totals }: { totals: Totals | undefined }) {
  const t = totals ?? { turns: 0, inputTokens: 0, outputTokens: 0, thinkingTokens: 0, cacheTokens: 0, costUsd: 0, durationMs: 0 };
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <StatTile label="Réponses" value={String(t.turns)} />
      <StatTile
        label="Tokens"
        value={formatTokens(t.inputTokens + t.cacheTokens + t.outputTokens)}
        hint={`Entrée ${t.inputTokens.toLocaleString("fr-FR")} · cache ${t.cacheTokens.toLocaleString("fr-FR")} · sortie ${t.outputTokens.toLocaleString("fr-FR")} · réflexion ${t.thinkingTokens.toLocaleString("fr-FR")}`}
      />
      <StatTile label="Coût estimé" value={t.costUsd > 0 ? formatCost(t.costUsd) : "—"} hint="Équivalent tarif API calculé par la CLI ; inclus dans l'abonnement le cas échéant." />
      <StatTile label="Temps de travail" value={t.durationMs > 0 ? formatDuration(t.durationMs) : "—"} />
    </div>
  );
}

export default function UsageModule() {
  const { adapters, loading: adaptersLoading } = useAdapters();
  const [days, setDays] = useState("7");
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [account, setAccount] = useState<ClaudeAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setSummary(await usageApi.summary(Number(days)));
      setError(null);
    } catch (e) {
      setError((e as { message?: string }).message ?? "Lecture impossible");
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  const claudeInstalled = adapters.some((a) => a.id === "claude" && a.installed);
  useEffect(() => {
    if (claudeInstalled) usageApi.claudeAccount().then(setAccount).catch(() => setAccount(null));
  }, [claudeInstalled]);

  const refreshClaude = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await usageApi.refreshClaudeLimits();
      await load();
    } catch (e) {
      setError((e as { message?: string }).message ?? "Actualisation impossible");
    } finally {
      setRefreshing(false);
    }
  };

  if (!summary && !error) {
    return (
      <div className="flex h-full items-center justify-center text-text-subtle">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  const installed = adapters.filter((a) => a.installed);

  return (
    <div className="mx-auto max-w-[960px] px-8 py-8">
      <SectionHeader
        title="Crédits"
        description="Limites d'abonnement communiquées par les CLI et consommation mesurée par ARCHIMED."
        actions={<Select label="Période" value={days} onChange={setDays} options={PERIODS} />}
      />

      {error && <p className="pb-4 text-footnote text-danger">{error}</p>}

      {!adaptersLoading && installed.length === 0 && (
        <EmptyState icon={<Gauge size={28} strokeWidth={1.5} />} title="Aucune CLI détectée" description="Installez ou configurez une CLI dans Réglages › Moteur." />
      )}

      <div className="space-y-4">
        {installed.map((adapter) => {
          const limits: AdapterLimits | undefined = summary?.limits[adapter.id];
          const totals = summary?.byAdapter[adapter.id];
          const isClaude = adapter.id === "claude";

          return (
            <Card key={adapter.id} className="space-y-4">
              <header className="flex flex-wrap items-center gap-2">
                <h2 className="text-title-3 font-semibold">{adapter.name}</h2>
                {isClaude && account?.subscriptionType && (
                  <Badge tone="accent">Abonnement {account.subscriptionType}</Badge>
                )}
                {limits && <span className="text-caption text-text-subtle">Limites relevées {observedAgo(limits.observedAt)}</span>}
                {isClaude && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="ml-auto"
                    disabled={refreshing}
                    onClick={() => void refreshClaude()}
                    title="Envoie un message très court à Claude (modèle Haiku) pour lire les limites à jour."
                  >
                    {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} strokeWidth={1.75} />}
                    Actualiser
                  </Button>
                )}
              </header>

              {limits && limits.windows.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {limits.windows.map((window) => (
                    <LimitMeter key={window.id} {...window} />
                  ))}
                </div>
              ) : (
                <p className="text-footnote text-text-subtle">
                  {isClaude
                    ? "Limites pas encore connues : elles arrivent avec la prochaine réponse de Claude, ou via « Actualiser » (quelques tokens)."
                    : `${adapter.name} ne communique pas son quota restant. La consommation ci-dessous est mesurée par ARCHIMED.`}
                </p>
              )}

              <TotalsTiles totals={totals} />
            </Card>
          );
        })}
      </div>

      {summary && summary.byDay.length > 0 && (
        <section className="pt-8">
          <h2 className="pb-3 text-title-3 font-semibold">Par jour</h2>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-body-sm">
              <thead className="bg-surface-2 text-left text-caption text-text-subtle">
                <tr>
                  <th className="px-3 py-2 font-medium">Jour</th>
                  <th className="px-3 py-2 text-right font-medium">Réponses</th>
                  <th className="px-3 py-2 text-right font-medium">Tokens</th>
                  <th className="px-3 py-2 text-right font-medium">Coût estimé</th>
                  <th className="px-3 py-2 text-right font-medium">Temps</th>
                </tr>
              </thead>
              <tbody>
                {summary.byDay.map(({ day, totals }) => (
                  <tr key={day} className="border-t border-border tabular-nums">
                    <td className="px-3 py-2">
                      {new Date(`${day}T00:00:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}
                    </td>
                    <td className="px-3 py-2 text-right">{totals.turns}</td>
                    <td className="px-3 py-2 text-right">{formatTokens(totals.inputTokens + totals.cacheTokens + totals.outputTokens)}</td>
                    <td className="px-3 py-2 text-right">{totals.costUsd > 0 ? formatCost(totals.costUsd) : "—"}</td>
                    <td className="px-3 py-2 text-right">{totals.durationMs > 0 ? formatDuration(totals.durationMs) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {summary && summary.recent.length === 0 && installed.length > 0 && (
        <p className="pt-6 text-center text-footnote text-text-subtle">
          Aucune réponse enregistrée sur la période : la consommation est mesurée à partir de maintenant.
        </p>
      )}
    </div>
  );
}
