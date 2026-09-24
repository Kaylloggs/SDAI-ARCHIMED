import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/design-system/primitives";
import type { ProjectSummary } from "@/core/ipc/bindings/ProjectSummary";
import type { VersionSelection } from "@/core/ipc/bindings/VersionSelection";
import { errorText, mcstudioApi } from "../../api";
import { LOADER_LABEL } from "../../lib/format";
import { useMcStudioStore } from "../../store";
import { Fact } from "../ui";
import { VersionPicker } from "../VersionPicker";

/** Versions du loader, de Fabric API et de Yarn, modifiables sans changer de Minecraft. */
export function VersionsSection({ project, busy }: { project: ProjectSummary; busy: boolean }) {
  const meta = project.meta;
  const [editing, setEditing] = useState<VersionSelection | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!meta) return null;
  const v = meta.versions;

  const start = () => {
    setError(null);
    setEditing({ loaderVersion: v.loaderVersion, mappingsVersion: v.mappingsVersion, apiVersion: v.apiVersion });
  };

  const apply = async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      useMcStudioStore.getState().upsert(await mcstudioApi.updateProjectVersions(project.id, editing));
      setEditing(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="mc-versions" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="mc-versions" className="text-title-3 font-semibold">
          Versions
        </h2>
        {!editing && (
          <Button size="sm" disabled={busy} onClick={start}>
            Changer les versions
          </Button>
        )}
      </div>

      {editing ? (
        <div className="space-y-3 rounded-md border border-border bg-surface-1 px-4 py-3">
          <VersionPicker
            profileId={v.profileId}
            minecraft={v.minecraft}
            loader={v.loader}
            selection={editing}
            onChange={setEditing}
            disabled={saving}
          />
          <p className="text-footnote text-text-subtle">
            Minecraft reste en {v.minecraft}. La prochaine compilation téléchargera les versions choisies.
          </p>
          {error && (
            <p role="alert" className="text-footnote text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(null)}>
              Annuler
            </Button>
            <Button size="sm" variant="primary" disabled={saving || busy} onClick={() => void apply()}>
              {saving && <Loader2 size={12} className="animate-spin" />}
              Appliquer
            </Button>
          </div>
        </div>
      ) : (
        <dl className="grid grid-cols-1 gap-x-6 rounded-md border border-border bg-surface-1 px-4 sm:grid-cols-3">
          <Fact label={LOADER_LABEL[v.loader]} mono>
            {v.loaderVersion}
          </Fact>
          {v.apiVersion && (
            <Fact label="Fabric API" mono>
              {v.apiVersion}
            </Fact>
          )}
          <Fact label="Mappings" mono>
            {v.mappingsVersion ?? "officiels"}
          </Fact>
        </dl>
      )}
    </section>
  );
}
