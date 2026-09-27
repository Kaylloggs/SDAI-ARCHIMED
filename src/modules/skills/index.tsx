import { useCallback, useEffect, useState } from "react";
import { Boxes, FolderOpen, Loader2, PenLine, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { Badge, Button, Card, EmptyState, SectionHeader } from "@/design-system/primitives";
import { bus } from "@/core/bus/event-bus";
import { useSessionStore } from "@/core/engine/session.store";
import { useUiStore } from "@/core/stores/ui.store";
import { errorText, skillsApi, type DraftInfo, type Skill } from "./api";
import { SkillMaker, type MakerOpen } from "./components/maker/SkillMaker";
import { draftOfSession } from "./components/maker/origin";

const SELF = "skills";

const relative = (ms: number) => {
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return new Date(ms).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
};

export default function SkillsModule() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [drafts, setDrafts] = useState<DraftInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  /** Atelier ouvert (sinon : bibliothèque). */
  const [maker, setMaker] = useState<MakerOpen | null>(null);
  const handoff = useUiStore((s) => s.moduleParams[SELF]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [list, pending] = await Promise.all([skillsApi.list(), skillsApi.draftList().catch(() => [])]);
      setSkills(list);
      setDrafts(pending);
      setError(null);
      bus.emit("skills.changed", { count: list.length });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Palette (« Créer un skill ») ou conversation rouverte depuis l'accueil : son dossier
  // désigne le brouillon.
  useEffect(() => {
    if (handoff?.["create"] === true) {
      useUiStore.getState().clearModuleParams(SELF);
      setMaker({ fresh: true });
      return;
    }
    const conversationId = handoff?.["conversationId"];
    if (typeof conversationId !== "string") return;
    useUiStore.getState().clearModuleParams(SELF);
    const cwd = useSessionStore.getState().sessions.find((s) => s.id === conversationId)?.cwd ?? null;
    void skillsApi
      .draftList()
      .then((list) => setMaker({ draftId: draftOfSession(list, cwd)?.id }))
      .catch(() => setMaker({}));
  }, [handoff]);

  const toggle = async (skill: Skill) => {
    setSkills((current) => current.map((s) => (s.id === skill.id ? { ...s, enabled: !s.enabled } : s)));
    try {
      await skillsApi.setEnabled(skill.id, !skill.enabled);
    } catch {
      void refresh();
    }
  };

  const importFolder = async () => {
    const selected = await open({ directory: true, title: "Choisir un dossier de skill" });
    if (typeof selected === "string") {
      try {
        await skillsApi.importFromPath(selected);
      } catch (e) {
        setError(errorText(e));
      }
      void refresh();
    }
  };

  if (maker) {
    return (
      <SkillMaker
        open={maker}
        onBack={() => {
          setMaker(null);
          void refresh();
        }}
        onSaved={() => void refresh()}
      />
    );
  }

  const visible = skills.filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(filter.toLowerCase()));
  // Brouillons jamais enregistrés ou modifiés depuis : du travail en attente.
  const pending = drafts.filter((d) => d.savedAt === null || d.savedAt < d.updatedAt).slice(0, 3);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[900px] px-8 py-8">
        <SectionHeader
          title="Skills"
          description="Bibliothèque locale synchronisée vers les CLI installées."
          actions={
            <>
              <Button icon={<FolderOpen size={14} strokeWidth={1.75} />} onClick={() => void skillsApi.openFolder()}>
                Ouvrir le dossier
              </Button>
              <Button onClick={() => void importFolder()}>Importer</Button>
              <Button variant="primary" icon={<Sparkles size={14} strokeWidth={1.75} />} onClick={() => setMaker({ fresh: true })}>
                Créer un skill
              </Button>
              <Button variant="ghost" aria-label="Rafraîchir" onClick={() => void refresh()}>
                <RefreshCw size={14} strokeWidth={1.75} />
              </Button>
            </>
          }
        />

        {pending.length > 0 && (
          <section aria-label="Brouillons de l'atelier" className="mb-6 space-y-2">
            <p className="text-footnote font-medium text-text-muted">En cours dans l'atelier</p>
            <ul className="flex flex-col gap-1.5">
              {pending.map((draft) => (
                <li key={draft.id}>
                  <button
                    type="button"
                    onClick={() => setMaker({ draftId: draft.id })}
                    className="flex w-full items-center gap-3 rounded-md border border-dashed border-border px-3 py-2 text-left transition-colors hover:border-border-strong hover:bg-surface-1"
                  >
                    <PenLine size={14} strokeWidth={1.75} className="shrink-0 text-accent" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-body-sm">
                      {draft.name || "Skill sans nom"}
                      {draft.kind === "edit" && <span className="text-text-subtle"> · amélioration de {draft.sourceId}</span>}
                    </span>
                    <span className="shrink-0 text-footnote text-text-subtle">{relative(draft.updatedAt)}</span>
                    <span className="shrink-0 text-footnote font-medium text-accent">Reprendre</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filtrer les skills…"
          aria-label="Filtrer les skills"
          className="mb-4 h-8 w-full rounded-md border border-border bg-surface-1 px-3 text-body-sm outline-none placeholder:text-text-subtle focus:border-border-strong"
        />

        {loading && skills.length === 0 ? (
          <div className="flex justify-center py-16 text-text-subtle">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : error && skills.length === 0 ? (
          <EmptyState icon={<Boxes size={28} strokeWidth={1.5} />} title="Impossible de lire la bibliothèque" description={error} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<Boxes size={28} strokeWidth={1.5} />}
            title={filter ? "Aucun skill ne correspond" : "Aucun skill"}
            description={
              filter
                ? "Essayez un autre mot, ou créez ce skill avec l'atelier."
                : "Créez un skill avec l'atelier : décrivez ce qu'il doit faire, une IA l'écrit, vous le testez. Vous pouvez aussi importer un dossier contenant un fichier SKILL.md."
            }
            action={
              <Button variant="primary" icon={<Sparkles size={14} strokeWidth={1.75} />} onClick={() => setMaker({ fresh: true })}>
                Créer un skill
              </Button>
            }
          />
        ) : (
          <>
            {error && (
              <p role="alert" className="mb-3 rounded-md bg-danger-soft px-3 py-2 text-footnote">
                {error}
              </p>
            )}
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
                  {skill.source === "library" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Ouvrir une copie dans l'atelier : l'IA propose des améliorations, la bibliothèque n'est touchée qu'à l'enregistrement"
                      onClick={() => setMaker({ improve: { id: skill.id, name: skill.name } })}
                      icon={<Wand2 size={13} strokeWidth={1.75} />}
                    >
                      Améliorer
                    </Button>
                  )}
                  <Button variant={skill.enabled ? "primary" : "secondary"} size="sm" onClick={() => void toggle(skill)}>
                    {skill.enabled ? "Actif" : "Inactif"}
                  </Button>
                </Card>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
