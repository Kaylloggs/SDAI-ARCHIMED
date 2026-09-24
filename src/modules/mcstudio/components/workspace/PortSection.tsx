import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRightLeft, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { Button, Select } from "@/design-system/primitives";
import type { PortOutcome } from "@/core/ipc/bindings/PortOutcome";
import type { PortPlan } from "@/core/ipc/bindings/PortPlan";
import type { ProjectSummary } from "@/core/ipc/bindings/ProjectSummary";
import { errorText, mcstudioApi } from "../../api";
import { LOADER_LABEL } from "../../lib/format";
import { useMcStudioStore } from "../../store";
import { useCatalog } from "../wizard/VersionSteps";

/**
 * Portage vers une autre version de Minecraft : versions, fichiers de build et données migrés
 * par Mod Studio après un point de restauration ; le code Java est confié à l'assistant IA.
 */
export function PortSection({
  project,
  busy,
  onAskAssistant,
}: {
  project: ProjectSummary;
  busy: boolean;
  onAskAssistant: (text: string) => void;
}) {
  const meta = project.meta;
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [plan, setPlan] = useState<PortPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [porting, setPorting] = useState(false);
  const [outcome, setOutcome] = useState<PortOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loader = meta?.versions.loader;
  const current = meta?.versions.minecraft;
  const { catalog, error: catalogError, loading } = useCatalog(open);
  const targets = useMemo(
    () =>
      (catalog?.versions ?? [])
        .filter((option) => option.minecraft !== current && option.loaders.some((l) => l.loader === loader && l.profileId))
        .map((option) => ({ value: option.minecraft, label: `Minecraft ${option.minecraft}` })),
    [catalog, current, loader],
  );

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setPlan(null);
    setPlanning(true);
    setError(null);
    mcstudioApi
      .portPlan(project.id, target)
      .then((result) => !cancelled && setPlan(result))
      .catch((e) => !cancelled && setError(errorText(e)))
      .finally(() => !cancelled && setPlanning(false));
    return () => {
      cancelled = true;
    };
  }, [project.id, target]);

  if (!meta || !loader) return null;

  const close = () => {
    setOpen(false);
    setTarget("");
    setPlan(null);
    setError(null);
  };

  const port = async () => {
    setPorting(true);
    setError(null);
    try {
      const result = await mcstudioApi.portProject(project.id, target);
      setOutcome(result);
      close();
      useMcStudioStore.getState().upsert(result.summary);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPorting(false);
    }
  };

  return (
    <section aria-labelledby="mc-port" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="mc-port" className="text-title-3 font-semibold">
          Version de Minecraft
        </h2>
        {!open && (
          <Button size="sm" disabled={busy} icon={<ArrowRightLeft size={14} />} onClick={() => setOpen(true)}>
            Porter vers une autre version
          </Button>
        )}
      </div>

      {outcome && !open && (
        <div role="status" className="space-y-3 rounded-md border border-border bg-surface-1 px-4 py-3">
          <p className="flex items-center gap-2 text-body-sm font-medium">
            <CheckCircle2 size={16} className="text-success" /> Projet porté vers Minecraft {current}
          </p>
          <ul className="space-y-1 text-footnote text-text-muted">
            {outcome.done.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {outcome.warnings.length > 0 && (
            <ul className="space-y-1">
              {outcome.warnings.map((line) => (
                <li key={line} className="flex gap-2 text-footnote">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
                  {line}
                </li>
              ))}
            </ul>
          )}
          <p className="text-footnote text-text-subtle">
            Point de restauration « {outcome.snapshot} » dans l'historique pour revenir en arrière. Le code Java utilise
            encore l'API de l'ancienne version : l'assistant peut l'adapter, puis compilez pour vérifier.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOutcome(null)}>
              Fermer
            </Button>
            <Button size="sm" variant="primary" icon={<Sparkles size={14} />} onClick={() => onAskAssistant(outcome.prompt)}>
              Adapter le code avec l'assistant
            </Button>
          </div>
        </div>
      )}

      {open ? (
        <div className="space-y-3 rounded-md border border-border bg-surface-1 px-4 py-3">
          <p className="text-footnote text-text-muted">
            Mod Studio met à jour les versions ({LOADER_LABEL[loader]}, mappings, Gradle), les fichiers de build et les
            dossiers de données, après un point de restauration. Vos retouches dans ces fichiers sont gardées.
          </p>
          {loading ? (
            <p className="flex items-center gap-2 text-footnote text-text-subtle">
              <Loader2 size={14} className="animate-spin" /> Versions disponibles…
            </p>
          ) : catalogError && targets.length === 0 ? (
            <p role="alert" className="text-footnote text-danger">
              {catalogError}
            </p>
          ) : (
            <Select
              label="Version cible"
              value={target}
              options={targets}
              placeholder={`Depuis Minecraft ${current}, vers…`}
              disabled={porting}
              onChange={setTarget}
              className="w-full sm:w-72"
            />
          )}

          {planning && (
            <p className="flex items-center gap-2 text-footnote text-text-subtle">
              <Loader2 size={14} className="animate-spin" /> Préparation du portage…
            </p>
          )}
          {plan && (
            <div className="space-y-3">
              <ol className="divide-y divide-border rounded-md border border-border">
                {plan.steps.map((step) => (
                  <li key={step.title} className="flex gap-3 px-3 py-2">
                    {step.automatic ? (
                      <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-success" aria-label="Automatique" />
                    ) : (
                      <Sparkles size={15} className="mt-0.5 shrink-0 text-accent" aria-label="Avec l'assistant IA" />
                    )}
                    <span className="min-w-0">
                      <span className="block text-body-sm">{step.title}</span>
                      <span className="block text-footnote text-text-subtle">{step.detail}</span>
                    </span>
                  </li>
                ))}
              </ol>
              {plan.notes.length > 0 && (
                <div className="space-y-1.5">
                  <h3 className="text-caption font-semibold uppercase tracking-[0.04em] text-text-subtle">
                    Changements d'API à prévoir
                  </h3>
                  <ul className="list-disc space-y-1 pl-5 text-footnote text-text-muted">
                    {plan.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="text-footnote text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={porting} onClick={close}>
              Annuler
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!plan || porting || busy}
              icon={porting ? <Loader2 size={14} className="animate-spin" /> : undefined}
              onClick={() => void port()}
            >
              {target ? `Porter vers ${target}` : "Porter"}
            </Button>
          </div>
        </div>
      ) : (
        !outcome && (
          <p className="text-footnote text-text-subtle">
            Passez le mod à une autre version de Minecraft ({LOADER_LABEL[loader]}) : build et données migrés
            automatiquement, code Java adapté avec l'assistant IA.
          </p>
        )
      )}
    </section>
  );
}
