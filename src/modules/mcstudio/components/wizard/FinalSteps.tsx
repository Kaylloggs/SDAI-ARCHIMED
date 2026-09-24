import { useCallback, useEffect, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AlertTriangle, Check, ExternalLink, FolderOpen, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Badge, Button, Select } from "@/design-system/primitives";
import type { JavaInstall } from "@/core/ipc/bindings/JavaInstall";
import type { License } from "@/core/ipc/bindings/License";
import { errorText, mcstudioApi } from "../../api";
import { joinPath } from "../../lib/format";
import { Field, focusRing, inputClass } from "../ui";
import type { Draft } from "./draft";

type StepProps = { draft: Draft; update: (patch: Partial<Draft>) => void };

function compatible(install: JavaInstall, min: number, max: number | null) {
  return install.major >= min && (max === null || install.major <= max);
}

export function JavaStep({ draft, update }: StepProps) {
  const [installs, setInstalls] = useState<JavaInstall[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const min = draft.versions?.java ?? 17;
  const max = draft.versions?.javaMax ?? null;

  const detect = useCallback(() => {
    setInstalls(null);
    mcstudioApi
      .detectJava()
      .then(setInstalls)
      .catch((e) => setError(errorText(e)));
  }, []);
  useEffect(detect, [detect]);

  const chooseManually = async () => {
    const folder = await openDialog({ directory: true, title: "Dossier du JDK" });
    if (typeof folder !== "string") return;
    const install = await mcstudioApi.inspectJava(folder).catch(() => null);
    if (!install) {
      setError("Ce dossier n'est pas un JDK : il doit contenir bin/javac et un fichier release.");
      return;
    }
    setError(null);
    setInstalls((list) => [install, ...(list ?? []).filter((i) => i.path !== install.path)]);
    if (compatible(install, min, max)) update({ javaHome: install.path });
    else setError(`Ce JDK est en Java ${install.major} : le projet demande ${max === min ? `Java ${min}` : `Java ${min} ou plus`}.`);
  };

  // Choix automatique : le plus ancien JDK compatible, comme le fera la compilation.
  const automatic = installs?.filter((i) => compatible(i, min, max)).sort((a, b) => a.major - b.major)[0] ?? null;
  const selected = draft.javaHome ?? automatic?.path ?? null;
  const wanted = max === min ? `Java ${min} exactement` : `Java ${min} ou plus récent`;

  return (
    <div className="space-y-4">
      <p className="text-body-sm text-text-muted">
        Ce projet demande <span className="font-medium text-text">{wanted}</span> (un JDK, pas un simple JRE). Il sert à
        compiler et à lancer le jeu de test.
      </p>

      {installs === null ? (
        <p className="flex items-center gap-2 text-footnote text-text-muted">
          <Loader2 size={14} className="animate-spin" /> Recherche des JDK installés…
        </p>
      ) : (
        <div role="radiogroup" aria-label="JDK" className="rounded-md border border-border">
          {installs.length === 0 && <p className="px-3 py-4 text-body-sm text-text-muted">Aucun JDK trouvé sur cette machine.</p>}
          {installs.map((install) => {
            const ok = compatible(install, min, max);
            const isSelected = selected === install.path;
            return (
              <button
                key={install.path}
                type="button"
                role="radio"
                aria-checked={isSelected}
                disabled={!ok}
                onClick={() => update({ javaHome: install.path === automatic?.path ? null : install.path })}
                className={cn(
                  "flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left last:border-b-0",
                  isSelected ? "bg-accent-soft" : ok && "hover:bg-surface-2",
                  !ok && "cursor-not-allowed opacity-60",
                  focusRing,
                )}
              >
                <span className="w-16 shrink-0 font-mono text-body-sm">Java {install.major}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-footnote text-text-muted">{install.path}</span>
                  <span className="block text-caption text-text-subtle">
                    {install.vendor ?? "Éditeur inconnu"} · {install.version}
                  </span>
                </span>
                {ok ? (
                  isSelected && (
                    <Badge tone="success">
                      <Check size={11} /> Utilisé
                    </Badge>
                  )
                ) : (
                  <Badge>Incompatible</Badge>
                )}
              </button>
            );
          })}
        </div>
      )}

      {installs !== null && !automatic && !draft.javaHome && (
        <div role="alert" className="space-y-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2">
          <p className="flex items-center gap-2 text-footnote font-medium">
            <AlertTriangle size={14} className="text-warning" /> Aucun JDK compatible
          </p>
          <p className="text-footnote text-text-muted">
            Installez Eclipse Temurin {min} (JDK), puis relancez la recherche. Vous pouvez créer le projet maintenant : la
            compilation attendra le bon JDK.
          </p>
          <Button type="button"
            size="sm"
            icon={<ExternalLink size={12} />}
            onClick={() => void openUrl(`https://adoptium.net/temurin/releases/?version=${min}`)}
          >
            Télécharger Temurin {min}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-footnote text-danger">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="button" size="sm" variant="ghost" icon={<RefreshCw size={12} />} onClick={detect}>
          Relancer la recherche
        </Button>
        <Button type="button" size="sm" variant="ghost" icon={<FolderOpen size={12} />} onClick={() => void chooseManually()}>
          Choisir un JDK…
        </Button>
      </div>
    </div>
  );
}

const LICENSES: { value: License; label: string; hint: string }[] = [
  { value: "none", label: "Aucune (tous droits réservés)", hint: "Personne ne peut réutiliser le code sans votre accord." },
  { value: "mit", label: "MIT", hint: "Réutilisation libre, notice de copyright conservée." },
];

export function ContentStep({ draft, update }: StepProps) {
  // Dossier proposé une seule fois : vider le champ ensuite reste possible.
  const proposed = useRef(draft.parentDir !== "");
  useEffect(() => {
    if (proposed.current) return;
    proposed.current = true;
    mcstudioApi
      .defaultParentDir()
      .then((dir) => update({ parentDir: dir }))
      .catch(() => undefined);
  }, [update]);

  const browse = async () => {
    const folder = await openDialog({ directory: true, title: "Dossier des projets", defaultPath: draft.parentDir || undefined });
    if (typeof folder === "string") update({ parentDir: folder });
  };

  const kinds = [
    { example: false, label: "Mod vide", hint: "Squelette complet et compilable : registres, métadonnées, icône." },
    {
      example: true,
      label: "Mod vide + exemple",
      hint: "Ajoute une gemme, un bloc de gemmes et deux recettes, avec textures, modèles, loot table et traductions.",
    },
  ];

  return (
    <div className="space-y-5">
      <div role="radiogroup" aria-label="Contenu de départ" className="grid gap-2 sm:grid-cols-2">
        {kinds.map((kind) => {
          const selected = draft.withExample === kind.example;
          return (
            <button
              key={kind.label}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => update({ withExample: kind.example })}
              className={cn(
                "flex flex-col items-start justify-start gap-1 rounded-md border px-3 py-2.5 text-left transition-colors",
                selected ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2",
                focusRing,
              )}
            >
              <span className="block text-body-sm font-medium">{kind.label}</span>
              <span className="block text-footnote text-text-muted">{kind.hint}</span>
            </button>
          );
        })}
      </div>
      <p className="text-footnote text-text-subtle">La génération par l'IA arrive dans une prochaine étape du module.</p>

      <Field
        id="mc-parent"
        label="Emplacement"
        hint={draft.parentDir && draft.modId ? <span className="font-mono">{joinPath(draft.parentDir, draft.modId)}</span> : undefined}
      >
        <div className="flex gap-2">
          <input
            id="mc-parent"
            spellCheck={false}
            className={cn(inputClass, "font-mono")}
            value={draft.parentDir}
            onChange={(e) => update({ parentDir: e.target.value })}
          />
          <Button type="button" onClick={() => void browse()} icon={<FolderOpen size={14} />}>
            Parcourir
          </Button>
        </div>
      </Field>

      <div className="space-y-1.5">
        <p className="text-footnote font-medium text-text-muted">Licence</p>
        <Select
          label="Licence"
          value={draft.license}
          onChange={(value) => update({ license: value as License })}
          options={LICENSES.map(({ value, label, hint }) => ({ value, label, hint }))}
        />
      </div>
    </div>
  );
}
