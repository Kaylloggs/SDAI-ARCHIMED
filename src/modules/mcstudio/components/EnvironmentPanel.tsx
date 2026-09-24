import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ChevronRight, CircleAlert, Loader2 } from "lucide-react";
import { cn } from "@/core/lib/cn";
import type { EnvironmentReport } from "@/core/ipc/bindings/EnvironmentReport";
import { errorText, mcstudioApi } from "../api";
import { JdkInstallCard } from "./JdkInstallCard";
import { OpenRouterKeyCard } from "./OpenRouterKeyCard";
import { focusRing } from "./ui";

/**
 * Ce que l'ordinateur doit avoir pour compiler des mods : un JDK par famille de
 * versions de Minecraft. Ce qui manque s'installe d'ici, après confirmation.
 */
export function EnvironmentPanel() {
  const [report, setReport] = useState<EnvironmentReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    mcstudioApi
      .environment()
      .then((result) => {
        setReport(result);
        setError(null);
        // Ouvert d'office quand quelque chose manque.
        if (result.needs.some((need) => !need.installed)) setOpen(true);
      })
      .catch((e) => setError(errorText(e)));
  }, []);
  useEffect(load, [load]);

  const missing = report?.needs.filter((need) => !need.installed).length ?? 0;

  return (
    <section aria-labelledby="mc-env" className="mb-6 rounded-lg border border-border bg-surface-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn("flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left", focusRing)}
      >
        <ChevronRight size={14} className={cn("text-text-subtle transition-transform duration-[140ms]", open && "rotate-90")} />
        <h2 id="mc-env" className="flex-1 text-body-sm font-semibold">
          Environnement
        </h2>
        {!report && !error && <Loader2 size={14} className="animate-spin text-text-subtle" />}
        {report &&
          (missing === 0 ? (
            <span className="inline-flex items-center gap-1.5 text-footnote text-success">
              <CheckCircle2 size={14} /> Prêt pour toutes les versions prises en charge
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-footnote text-warning">
              <CircleAlert size={14} /> {missing} {missing > 1 ? "versions de Java manquantes" : "version de Java manquante"}
            </span>
          ))}
      </button>

      {open && (
        <div className="space-y-3 border-t border-border px-4 py-3">
          {error && <p className="text-footnote text-danger">{error}</p>}
          {report?.needs.map((need) => (
            <div key={`${need.major}-${need.exact}`} className="flex flex-wrap items-start gap-x-4 gap-y-2">
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-body-sm font-medium">
                  Java {need.major}
                  {need.exact && <span className="font-normal text-text-subtle"> · version exacte demandée par Forge</span>}
                </p>
                <p className="text-caption text-text-subtle">{need.usedBy.join(" · ")}</p>
              </div>
              <div className="w-full sm:w-auto sm:max-w-[420px]">
                {need.installed ? (
                  <p className="flex items-center gap-1.5 text-footnote text-success">
                    <CheckCircle2 size={14} /> Java {need.installed.major} ({need.installed.version})
                  </p>
                ) : (
                  <JdkInstallCard major={need.major} compact onInstalled={load} />
                )}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-start gap-x-4 gap-y-2 border-t border-border pt-3">
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-body-sm font-medium">
                Textures par IA <span className="font-normal text-text-subtle">· facultatif</span>
              </p>
              <p className="text-caption text-text-subtle">
                Clé OpenRouter : des modèles d'image, dont certains gratuits, dessinent les textures.
              </p>
            </div>
            <div className="w-full sm:w-auto sm:min-w-[320px] sm:max-w-[420px]">
              <OpenRouterKeyCard compact />
            </div>
          </div>
          <p className="text-caption text-text-subtle">
            Gradle, Minecraft et les loaders se téléchargent seuls à la première compilation de chaque projet (connexion
            Internet nécessaire), puis restent en cache.
          </p>
        </div>
      )}
    </section>
  );
}
