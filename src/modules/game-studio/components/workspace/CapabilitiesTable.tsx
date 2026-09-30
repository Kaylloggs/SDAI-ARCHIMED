import { CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { ENGINE_LABEL, VIA } from "../../lib/labels";
import { useGameStudioStore } from "../../store";

/** Ce que le moteur du projet permet vraiment sur cette machine, et par quel moyen. */
export function CapabilitiesTable() {
  const current = useGameStudioStore((s) => s.current);
  if (!current) return null;
  const { project, capabilities, install } = current;
  if (!project.engine) {
    return (
      <p className="rounded-lg border border-border bg-surface-1 px-4 py-3 text-body-sm text-text-muted">
        Aucun moteur choisi pour ce projet : choisissez-le dans les Réglages pour voir ce que Game Studio peut faire.
      </p>
    );
  }
  return (
    <section aria-label="Capacités du moteur" className="space-y-2">
      <div className="space-y-0.5">
        <h2 className="text-title-3 font-semibold">Ce que {ENGINE_LABEL[project.engine]} permet ici</h2>
        <p className="text-footnote text-text-muted">
          {install ? `Installation utilisée : ${install.editor}${install.version ? ` (${install.version})` : ""}.` : "Moteur non installé : seules les opérations sur les fichiers sont possibles."} Rien n'est supposé : chaque capacité dit comment elle est faite.
        </p>
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface-1">
        {capabilities.map((capability) => (
          <li key={capability.id} className="flex items-start gap-3 px-4 py-2.5">
            {capability.available === true ? (
              <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-success" aria-label="Disponible" />
            ) : capability.available === false ? (
              <XCircle size={15} className="mt-0.5 shrink-0 text-text-subtle" aria-label="Indisponible" />
            ) : (
              <CircleDashed size={15} className="mt-0.5 shrink-0 text-text-subtle" aria-label="À vérifier" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-body-sm">
                {capability.label} <span className="text-caption text-text-subtle">· {VIA[capability.via]}</span>
              </p>
              {capability.requires && capability.available !== true && <p className="text-footnote text-text-muted">Il faut : {capability.requires}</p>}
              {capability.detail && <p className="break-words text-footnote text-text-subtle">{capability.detail}</p>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
