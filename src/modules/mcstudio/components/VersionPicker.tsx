import { useEffect, useState } from "react";
import { CloudOff, Loader2 } from "lucide-react";
import { Select, type SelectOption } from "@/design-system/primitives";
import type { LoaderId } from "@/core/ipc/bindings/LoaderId";
import type { VersionChoice } from "@/core/ipc/bindings/VersionChoice";
import type { VersionOptions } from "@/core/ipc/bindings/VersionOptions";
import type { VersionSelection } from "@/core/ipc/bindings/VersionSelection";
import { errorText, mcstudioApi } from "../api";
import { LOADER_LABEL } from "../lib/format";

function toOptions(list: VersionChoice[]): SelectOption[] {
  return list.map((choice) => ({
    value: choice.value,
    label: choice.value,
    hint: choice.recommended ? "recommandée" : choice.stable ? undefined : "bêta",
  }));
}

/** Valeur affichée : le choix de la personne, sinon la version recommandée. */
function current(list: VersionChoice[], chosen: string | null): string {
  return chosen ?? list.find((c) => c.recommended)?.value ?? list.find((c) => c.stable)?.value ?? list[0]?.value ?? "";
}

/**
 * Choix des versions publiées pour un couple Minecraft × loader : loader, et pour
 * Fabric, Fabric API et Yarn. Par défaut, la version recommandée.
 */
export function VersionPicker({
  profileId,
  minecraft,
  loader,
  selection,
  onChange,
  disabled = false,
}: {
  profileId: string;
  minecraft: string;
  loader: LoaderId;
  selection: VersionSelection;
  onChange: (selection: VersionSelection) => void;
  disabled?: boolean;
}) {
  const [options, setOptions] = useState<VersionOptions | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOptions(null);
    setError(null);
    mcstudioApi
      .versionOptions(profileId, minecraft)
      .then((result) => {
        if (!cancelled) setOptions(result);
      })
      .catch((e) => {
        if (!cancelled) setError(errorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [profileId, minecraft]);

  if (error) return <p className="text-footnote text-danger">{error}</p>;
  if (!options) {
    return (
      <p className="flex items-center gap-2 text-footnote text-text-muted">
        <Loader2 size={14} className="animate-spin" /> Versions publiées…
      </p>
    );
  }

  const rows: { key: keyof VersionSelection; label: string; list: VersionChoice[] }[] = [
    { key: "loaderVersion", label: `${LOADER_LABEL[loader]}${loader === "fabric" ? " Loader" : ""}`, list: options.loader },
  ];
  if (loader === "fabric") {
    rows.push({ key: "apiVersion", label: "Fabric API", list: options.api });
    rows.push({ key: "mappingsVersion", label: "Mappings Yarn", list: options.mappings });
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {rows.map(({ key, label, list }) => (
          <div key={key} className="min-w-0 space-y-1.5">
            <p className="text-footnote font-medium text-text-muted">{label}</p>
            {list.length === 0 ? (
              <p className="text-footnote text-danger">Aucune version publiée.</p>
            ) : (
              <Select
                label={label}
                className="w-full"
                disabled={disabled}
                value={current(list, selection[key] ?? null)}
                options={toOptions(list)}
                onChange={(value) => onChange({ ...selection, [key]: value })}
              />
            )}
          </div>
        ))}
      </div>
      {options.offline && (
        <p className="flex items-center gap-1.5 text-caption text-warning">
          <CloudOff size={12} /> Hors ligne : listes tirées du cache.
        </p>
      )}
    </div>
  );
}
