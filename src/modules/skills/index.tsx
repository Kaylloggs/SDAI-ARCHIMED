import { useCallback, useEffect, useState } from "react";
import { Boxes, FolderOpen, RefreshCw, Loader2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { Badge, Button, Card, EmptyState, SectionHeader } from "@/design-system/primitives";
import { bus } from "@/core/bus/event-bus";
import { skillsApi, type Skill } from "./api";

export default function SkillsModule() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await skillsApi.list();
      setSkills(list);
      setError(null);
      bus.emit("skills.changed", { count: list.length });
    } catch (e) {
      setError((e as { message?: string }).message ?? "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = async (skill: Skill) => {
    setSkills((current) =>
      current.map((s) => (s.id === skill.id ? { ...s, enabled: !s.enabled } : s)),
    );
    try {
      await skillsApi.setEnabled(skill.id, !skill.enabled);
    } catch {
      void refresh();
    }
  };

  const importFolder = async () => {
    const selected = await open({ directory: true, title: "Choisir un dossier de skill" });
    if (typeof selected === "string") {
      await skillsApi.importFromPath(selected);
      void refresh();
    }
  };

  const visible = skills.filter((s) =>
    `${s.name} ${s.description}`.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div className="mx-auto max-w-[900px] px-8 py-8">
      <SectionHeader
        title="Skills"
        description="Bibliothèque locale synchronisée vers les CLI installées."
        actions={
          <>
            <Button icon={<FolderOpen size={14} strokeWidth={1.75} />} onClick={() => void skillsApi.openFolder()}>
              Ouvrir le dossier
            </Button>
            <Button variant="primary" onClick={() => void importFolder()}>
              Importer
            </Button>
            <Button variant="ghost" aria-label="Rafraîchir" onClick={() => void refresh()}>
              <RefreshCw size={14} strokeWidth={1.75} />
            </Button>
          </>
        }
      />

      <input
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="Filtrer les skills…"
        className="mb-4 h-8 w-full rounded-md border border-border bg-surface-1 px-3 text-body-sm outline-none placeholder:text-text-subtle focus:border-border-strong"
      />

      {loading ? (
        <div className="flex justify-center py-16 text-text-subtle">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : error ? (
        <EmptyState icon={<Boxes size={28} strokeWidth={1.5} />} title="Impossible de lire la bibliothèque" description={error} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<Boxes size={28} strokeWidth={1.5} />}
          title="Aucun skill"
          description="Importez un dossier contenant un fichier SKILL.md, ou déposez-en plusieurs dans le dossier de la bibliothèque."
          action={
            <Button variant="primary" onClick={() => void importFolder()}>
              Importer un skill
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((skill) => (
            <Card key={skill.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-body font-medium">{skill.name}</p>
                  {skill.source === "external" && <Badge tone="neutral">externe</Badge>}
                  {skill.targets.map((target) => (
                    <Badge key={target} tone="accent">
                      {target}
                    </Badge>
                  ))}
                </div>
                <p className="line-clamp-1 text-footnote text-text-subtle">{skill.description}</p>
              </div>
              <Button
                variant={skill.enabled ? "primary" : "secondary"}
                size="sm"
                onClick={() => void toggle(skill)}
              >
                {skill.enabled ? "Actif" : "Inactif"}
              </Button>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
