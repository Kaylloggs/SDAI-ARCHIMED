import { useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  Dice5,
  Eraser,
  Image as ImageIcon,
  Layers,
  Loader2,
  Ratio,
  RefreshCw,
  Search,
  Sparkles,
  Type,
  WifiOff,
} from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Badge, Tooltip } from "@/design-system/primitives";
import type { ModelCapabilities } from "@/core/ipc/bindings/ModelCapabilities";
import type { ProviderId } from "@/core/ipc/bindings/ProviderId";
import type { ProviderModel } from "@/core/ipc/bindings/ProviderModel";
import { usable } from "../lib/capabilities";
import { PROVIDER_NAMES, PROVIDERS, STATE_LABELS, formatUsd } from "../lib/format";
import { findModel, useImageMaker } from "../store";
import { Popover } from "./Popover";
import { Switch, focusRing, inputClass } from "./ui";

const DOT: Record<string, string> = {
  success: "bg-success",
  info: "bg-info",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-text-subtle",
};

export function StateDot({ provider }: { provider: ProviderId }) {
  const state = useImageMaker((s) => s.statuses[provider]?.state);
  const look = state ? STATE_LABELS[state] : { label: "Lecture…", tone: "neutral" as const };
  return <span aria-label={look.label} className={cn("inline-block size-2 shrink-0 rounded-full", DOT[look.tone])} />;
}

/** Ce que sait faire un modèle, en petites icônes lisibles (libellé pour les lecteurs d'écran). */
export function CapabilityIcons({ caps }: { caps: ModelCapabilities }) {
  const items = [
    caps.textToImage && { Icon: Type, label: "Crée à partir d'un texte" },
    caps.imageInput && {
      Icon: ImageIcon,
      label: caps.maxInputImages ? `Reçoit jusqu'à ${caps.maxInputImages} images` : "Reçoit des images (édition, références)",
    },
    caps.aspectRatios.length > 0 && { Icon: Ratio, label: `Formats : ${caps.aspectRatios.join(", ")}` },
    caps.resolutions.length > 0 && { Icon: Layers, label: `Résolutions : ${caps.resolutions.join(", ")}` },
    caps.seed && { Icon: Dice5, label: "Graine réglable" },
    caps.negativePrompt && { Icon: Eraser, label: "Consigne négative" },
    caps.transparentBackground && { Icon: Sparkles, label: "Fond transparent" },
  ].filter(Boolean) as { Icon: typeof Type; label: string }[];
  return (
    <span className="flex items-center gap-1.5 text-text-subtle">
      {items.map(({ Icon, label }) => (
        <Tooltip key={label} label={label} side="top">
          <span aria-label={label} role="img" className="inline-flex">
            <Icon size={12} strokeWidth={1.75} />
          </span>
        </Tooltip>
      ))}
    </span>
  );
}

const SOURCE: Record<ModelCapabilities["source"], string> = {
  api: "Capacités lues dans la liste du fournisseur",
  docs: "Capacités tirées de la documentation officielle",
  user: "Modèle ajouté par vous",
};

function ModelRow({
  model,
  selected,
  onPick,
}: {
  model: ProviderModel;
  selected: boolean;
  onPick: () => void;
}) {
  const price = model.pricing.find((p) => p.unit === "image") ?? model.pricing[0];
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onPick}
      className={cn(
        "flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors",
        selected ? "bg-accent-soft" : "hover:bg-surface-2",
        focusRing,
      )}
    >
      <span className="mt-0.5 w-3.5 shrink-0 text-accent">{selected && <Check size={14} />}</span>
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-body-sm font-medium text-text">{model.name}</span>
          {model.free && <Badge tone="success">Gratuit</Badge>}
        </span>
        <span className="block truncate font-mono text-caption text-text-subtle">{model.id}</span>
        <span className="flex items-center justify-between gap-2">
          <CapabilityIcons caps={model.capabilities} />
          <span className="truncate text-caption text-text-subtle">
            {price ? `${formatUsd(price.costUsd)} / ${price.unit === "image" ? "image" : price.unit}` : SOURCE[model.capabilities.source]}
          </span>
        </span>
      </span>
    </button>
  );
}

/**
 * Choix du fournisseur et du modèle, ou mode Auto. Les modèles sont listés dans l'ordre du
 * fournisseur : aucun n'est présenté comme « meilleur ».
 */
export function ModelPicker() {
  const provider = useImageMaker((s) => s.provider);
  const modelId = useImageMaker((s) => s.model);
  const auto = useImageMaker((s) => s.auto);
  const model = useImageMaker((s) => findModel(s, s.provider, s.model));
  const [tab, setTab] = useState<ProviderId>(provider);
  const [query, setQuery] = useState("");
  const list = useImageMaker((s) => s.models[tab]);
  const error = useImageMaker((s) => s.modelErrors[tab]);
  const status = useImageMaker((s) => s.statuses[tab]);
  const [loading, setLoading] = useState(false);

  const models = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (list?.models ?? []).filter((m) => !q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
  }, [list, query]);

  const reload = async (refresh: boolean) => {
    setLoading(true);
    await useImageMaker.getState().loadModels(tab, refresh);
    setLoading(false);
  };

  return (
    <Popover
      label="Choisir le fournisseur et le modèle"
      width={420}
      trigger={({ ref, toggle, open, ...aria }) => (
        <button
          ref={ref}
          type="button"
          onClick={() => {
            setTab(provider);
            toggle();
            if (!useImageMaker.getState().models[provider]) void useImageMaker.getState().loadModels(provider);
          }}
          {...aria}
          className={cn(
            "flex h-8 min-w-0 max-w-72 items-center gap-2 rounded-md border px-2.5 text-body-sm transition-colors",
            open ? "border-border-strong bg-surface-2" : "border-border hover:border-border-strong",
            focusRing,
          )}
        >
          {auto ? <Sparkles size={14} className="shrink-0 text-accent" /> : <StateDot provider={provider} />}
          <span className="truncate">
            {auto ? "Auto" : model?.name ?? (modelId ? modelId : "Choisir un modèle")}
          </span>
          {!auto && <span className="hidden truncate text-footnote text-text-subtle xl:inline">{PROVIDER_NAMES[provider]}</span>}
          <ChevronDown size={12} className={cn("shrink-0 text-text-subtle transition-transform", open && "rotate-180")} />
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="space-y-2 border-b border-border p-3">
            <Switch checked={auto} onChange={(value) => useImageMaker.getState().set({ auto: value, autoNote: null })}>
              <span className="text-left">
                <span className="block text-body-sm text-text">Auto</span>
              </span>
            </Switch>
            <p className="text-footnote text-text-muted">
              Choisit, à chaque demande, un modèle de vos connexions qui sait faire l'opération (image en entrée, format,
              transparence), en gardant votre modèle s'il convient. Le choix est expliqué, sans classement de qualité.
            </p>
          </div>
          <div role="tablist" aria-label="Fournisseurs" className="flex gap-1 border-b border-border px-2 pt-2">
            {PROVIDERS.map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={tab === p}
                onClick={() => {
                  setTab(p);
                  if (!useImageMaker.getState().models[p]) void useImageMaker.getState().loadModels(p);
                }}
                className={cn(
                  "-mb-px flex items-center gap-1.5 rounded-t-md border-b-2 px-2.5 py-1.5 text-footnote transition-colors",
                  tab === p ? "border-accent text-text" : "border-transparent text-text-muted hover:text-text",
                  focusRing,
                )}
              >
                <StateDot provider={p} />
                {PROVIDER_NAMES[p]}
              </button>
            ))}
          </div>
          {!usable(status?.state) ? (
            <div className="space-y-2 p-4 text-body-sm text-text-muted">
              <p>{status ? STATE_LABELS[status.state].label : "Lecture de la connexion…"} pour {PROVIDER_NAMES[tab]}.</p>
              <button
                type="button"
                onClick={() => {
                  close();
                  useImageMaker.getState().set({ dialog: "connections" });
                }}
                className={cn("text-accent hover:underline", focusRing)}
              >
                Ouvrir les connexions
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 p-2">
                <div className="relative flex-1">
                  <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-subtle" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Rechercher un modèle"
                    aria-label="Rechercher un modèle"
                    className={cn(inputClass, "pl-8")}
                  />
                </div>
                <button
                  type="button"
                  aria-label="Recharger la liste des modèles"
                  onClick={() => void reload(true)}
                  className={cn("rounded-md p-2 text-text-muted hover:bg-surface-2 hover:text-text", focusRing)}
                >
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                </button>
              </div>
              {(list?.offline || list?.note || error) && (
                <p className="flex items-start gap-1.5 px-3 pb-2 text-footnote text-text-muted">
                  {list?.offline && <WifiOff size={12} className="mt-0.5 shrink-0" />}
                  {error ?? list?.note ?? "Liste reprise de la dernière connexion."}
                </p>
              )}
              <div role="listbox" aria-label={`Modèles ${PROVIDER_NAMES[tab]}`} className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
                {!list && !error && (
                  <p className="flex items-center gap-2 px-2 py-3 text-footnote text-text-muted">
                    <Loader2 size={14} className="animate-spin" /> Lecture des modèles…
                  </p>
                )}
                {list && models.length === 0 && <p className="px-2 py-3 text-footnote text-text-muted">Aucun modèle ne correspond.</p>}
                {models.map((m) => (
                  <ModelRow
                    key={m.id}
                    model={m}
                    selected={!auto && provider === tab && modelId === m.id}
                    onPick={() => {
                      useImageMaker.getState().chooseModel(tab, m.id);
                      close();
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Popover>
  );
}
