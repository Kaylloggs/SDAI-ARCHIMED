import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { enterUp } from "@/design-system/motion";
import { allModules, moduleFootprint, removeModule, restoreModule, type LoadedModule } from "@/core/modules";
import { isModuleEnabled, useModulesStore } from "@/core/stores/modules.store";
import { bus } from "@/core/bus/event-bus";
import { isAppError } from "@/core/ipc";
import type { ModuleFootprint } from "@/core/ipc/bindings/ModuleFootprint";
import { Badge, Button, Card } from "@/design-system/primitives";
import { Switch } from "./Switch";

/** Taille lisible : « 12 Ko », « 3,4 Mo », « 1,2 Go ». */
export function formatSize(bytes: number): string {
  const units = ["o", "Ko", "Mo", "Go"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${value.toLocaleString("fr-FR", { maximumFractionDigits: digits })} ${units[unit]}`;
}

function message(error: unknown): string {
  return isAppError(error) ? error.message : String(error);
}

/** Ce que la suppression va faire, avant de la confirmer (dans la carte, pas de modale). */
function RemovePanel({
  module,
  onCancel,
  onRemoved,
}: {
  module: LoadedModule;
  onCancel: () => void;
  onRemoved: (notice: string) => void;
}) {
  const [footprint, setFootprint] = useState<ModuleFootprint | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    moduleFootprint(module.id)
      .then(setFootprint)
      .catch((e) => setError(message(e)));
  }, [module.id]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const removal = await removeModule(module.id);
      const freed = removal.freed > 0 ? ` ${formatSize(removal.freed)} libérés (Corbeille).` : "";
      onRemoved(
        removal.credentialsLeft.length > 0
          ? `${module.name} supprimé.${freed} Clés restées dans le Gestionnaire d'identifiants : ${removal.credentialsLeft.join(", ")}.`
          : `${module.name} supprimé.${freed}`,
      );
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };

  return (
    <motion.div
      variants={enterUp}
      initial="hidden"
      animate="visible"
      exit="exit"
      role="group"
      aria-label={`Supprimer ${module.name}`}
      className="mt-3 space-y-3 border-t border-border pt-3"
    >
      <div className="space-y-1 text-footnote text-text-muted">
        <p className="text-body-sm font-medium text-text">Supprimer {module.name} ?</p>
        <p>Il disparaît de l'application : menu, accueil, recherche et réglages.</p>
        {footprint === null ? (
          !error && <p className="text-text-subtle">Mesure de ses données…</p>
        ) : footprint.bytes > 0 ? (
          <p>
            Ses données ({formatSize(footprint.bytes)}, {footprint.files.toLocaleString("fr-FR")} fichier
            {footprint.files > 1 ? "s" : ""}) partent à la Corbeille.
          </p>
        ) : (
          <p>Il n'a aucune donnée sur cette machine.</p>
        )}
        {footprint?.tools && <p>Les agents ne reçoivent plus ses outils.</p>}
        {footprint !== null && footprint.credentials > 0 && (
          <p>Ses clés d'API sont effacées du Gestionnaire d'identifiants.</p>
        )}
        <p className="text-text-subtle">
          Vos fichiers créés ailleurs (projets, exports) restent en place. Vous pourrez le remettre depuis « Modules
          supprimés ».
        </p>
      </div>
      {error && <p className="text-footnote text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Annuler
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={busy || footprint === null}
          onClick={() => void confirm()}
          icon={busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
        >
          Supprimer le module
        </Button>
      </div>
    </motion.div>
  );
}

/**
 * Modules installés : activer, désactiver (tout est gardé) ou supprimer (retiré de
 * l'application, données à la Corbeille). Les modules supprimés se remettent plus bas.
 * Les modules requis (accueil, réglages, tutoriel) n'apparaissent pas : on ne peut ni les
 * désactiver ni les supprimer.
 */
export function ModulesSection() {
  const { overrides, removed, setOverride } = useModulesStore();
  const [asking, setAsking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Supprimés pendant cette session : leur partie native repart de zéro au prochain lancement.
  const [removedNow, setRemovedNow] = useState<string[]>([]);

  const optional = allModules.filter((m) => !m.required);
  const installed = optional.filter((m) => !removed.includes(m.id));
  const gone = optional.filter((m) => removed.includes(m.id));

  return (
    <div className="space-y-6">
      <ul className="flex flex-col gap-2">
        {installed.map((module) => {
          const Icon = module.icon;
          const enabled = isModuleEnabled(overrides, module);
          return (
            <li key={module.id}>
              <Card className="py-3">
                <div className="flex items-center gap-3">
                  <Icon size={16} strokeWidth={1.75} className="shrink-0 text-text-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-body font-medium">{module.name}</p>
                      <Badge tone="neutral">v{module.version}</Badge>
                      {module.backend && <Badge tone="neutral">backend</Badge>}
                    </div>
                    <p className="line-clamp-1 text-footnote text-text-subtle">{module.description}</p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Supprimer ${module.name}`}
                    title={`Supprimer ${module.name}`}
                    aria-expanded={asking === module.id}
                    onClick={() => setAsking((a) => (a === module.id ? null : module.id))}
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-sm transition-colors",
                      asking === module.id
                        ? "bg-danger-soft text-danger"
                        : "text-text-subtle hover:bg-danger-soft hover:text-danger",
                    )}
                  >
                    <Trash2 size={15} strokeWidth={1.75} />
                  </button>
                  <Switch
                    checked={enabled}
                    label={`${enabled ? "Désactiver" : "Activer"} ${module.name}`}
                    onChange={(value) => {
                      setOverride(module.id, value);
                      bus.emit("modules.changed", { id: module.id, enabled: value });
                    }}
                  />
                </div>
                <AnimatePresence initial={false}>
                  {asking === module.id && (
                    <RemovePanel
                      module={module}
                      onCancel={() => setAsking(null)}
                      onRemoved={(text) => {
                        setAsking(null);
                        setNotice(text);
                        setRemovedNow((list) => [...list, module.id]);
                      }}
                    />
                  )}
                </AnimatePresence>
              </Card>
            </li>
          );
        })}
      </ul>

      {notice && (
        <p role="status" className="text-footnote text-text-muted">
          {notice}
        </p>
      )}

      {gone.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-body-sm font-semibold text-text-muted">Modules supprimés</h3>
          <ul className="flex flex-col gap-2">
            {gone.map((module) => {
              const Icon = module.icon;
              return (
                <li key={module.id}>
                  <Card className="flex items-center gap-3 py-3">
                    <Icon size={16} strokeWidth={1.75} className="shrink-0 text-text-subtle" />
                    <div className="min-w-0 flex-1">
                      <p className="text-body font-medium text-text-muted">{module.name}</p>
                      <p className="line-clamp-1 text-footnote text-text-subtle">{module.description}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<RotateCcw size={14} />}
                      onClick={() => {
                        restoreModule(module.id);
                        setNotice(
                          removedNow.includes(module.id)
                            ? `${module.name} est de retour. Relancez ARCHIMED pour qu'il reparte de zéro.`
                            : `${module.name} est de retour.`,
                        );
                      }}
                    >
                      Remettre
                    </Button>
                  </Card>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
