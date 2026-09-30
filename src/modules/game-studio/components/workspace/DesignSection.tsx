import { useEffect, useState } from "react";
import { Check, Plus, Save, Trash2 } from "lucide-react";
import { Badge, Button } from "@/design-system/primitives";
import type { GamePhaseStatus } from "@/core/ipc/bindings/GamePhaseStatus";
import type { GameStyleGuide } from "@/core/ipc/bindings/GameStyleGuide";
import { ago, ASSUMPTION_STATUS, topicLabel, TOPOLOGY, WORLD_KIND } from "../../lib/labels";
import { useGameStudioStore } from "../../store";
import { Bullets, ConfirmButton, ErrorLine, Group, Segmented, TextArea, TextInput } from "../ui";

const PHASE_STATUS: { value: GamePhaseStatus; label: string }[] = [
  { value: "planned", label: "Prévue" },
  { value: "active", label: "En cours" },
  { value: "done", label: "Terminée" },
];

const STYLE_FIELDS: { key: Exclude<keyof GameStyleGuide, "palette" | "references">; label: string; placeholder: string }[] = [
  { key: "visualStyle", label: "Style visuel", placeholder: "Low poly coloré, contours doux" },
  { key: "materials", label: "Matériaux", placeholder: "Mats, peu de reflets, couleurs unies" },
  { key: "typography", label: "Typographie", placeholder: "Arrondie, lisible à 12 px" },
  { key: "uiStyle", label: "Interface", placeholder: "Cartes claires, icônes pleines" },
  { key: "characterStyle", label: "Personnages", placeholder: "Proportions exagérées, têtes larges" },
  { key: "environmentStyle", label: "Décors", placeholder: "Bord de mer, lumière de fin de journée" },
  { key: "vfxStyle", label: "Effets", placeholder: "Particules stylisées, peu de flou" },
  { key: "audioStyle", label: "Son", placeholder: "Guitare acoustique, ambiances de port" },
];

function Assumptions() {
  const graph = useGameStudioStore((s) => s.current?.graph);
  const apply = useGameStudioStore((s) => s.apply);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  if (!graph) return null;
  const active = graph.assumptions.filter((a) => a.status !== "replaced");
  const replaced = graph.assumptions.filter((a) => a.status === "replaced");

  const save = async (id: string, value: string | null, status: "editable" | "confirmed") => {
    setError(await apply({ op: "setAssumption", id, value, status }));
    setValues((v) => {
      const next = { ...v };
      delete next[id];
      return next;
    });
  };

  return (
    <Group title="Hypothèses" description="Choisies faute d'information. Modifiez-les ou confirmez-les : les agents s'en servent.">
      <ErrorLine message={error} onClose={() => setError(null)} />
      <ul className="divide-y divide-border">
        {active.map((a) => {
          const edited = values[a.id] !== undefined && values[a.id] !== a.value;
          return (
            <li key={a.id} className="flex flex-wrap items-start gap-3 py-3">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-caption font-medium text-text-subtle">{topicLabel(a.topic)}</span>
                  <Badge tone={a.status === "confirmed" ? "success" : "neutral"}>{ASSUMPTION_STATUS[a.status]}</Badge>
                </div>
                <TextInput aria-label={`Valeur : ${topicLabel(a.topic)}`} value={values[a.id] ?? a.value} onChange={(e) => setValues((v) => ({ ...v, [a.id]: e.target.value }))} className="w-full max-w-md" />
                <p className="text-footnote text-text-muted">{a.reason}</p>
              </div>
              {edited ? (
                <Button size="sm" variant="secondary" icon={<Save size={13} />} onClick={() => void save(a.id, values[a.id]!, "confirmed")}>
                  Enregistrer
                </Button>
              ) : (
                a.status === "editable" && (
                  <Button size="sm" variant="ghost" icon={<Check size={13} />} onClick={() => void save(a.id, null, "confirmed")}>
                    Confirmer
                  </Button>
                )
              )}
            </li>
          );
        })}
        {active.length === 0 && <li className="py-3 text-footnote text-text-subtle">Aucune hypothèse.</li>}
      </ul>
      {replaced.length > 0 && (
        <details className="border-t border-border py-2">
          <summary className="cursor-pointer text-footnote text-text-muted">Anciennes valeurs ({replaced.length})</summary>
          <ul className="space-y-1 pt-2">
            {replaced.map((a) => (
              <li key={a.id} className="text-footnote text-text-subtle">
                {topicLabel(a.topic)} : {a.value} · {ago(a.at)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Group>
  );
}

function Decisions() {
  const graph = useGameStudioStore((s) => s.current?.graph);
  const apply = useGameStudioStore((s) => s.apply);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: "", decision: "", reason: "", alternatives: "" });
  const [error, setError] = useState<string | null>(null);
  if (!graph) return null;

  const add = async () => {
    const message = await apply({
      op: "addDecision",
      title: form.title,
      decision: form.decision,
      reason: form.reason,
      alternatives: form.alternatives.split(";").map((s) => s.trim()).filter(Boolean),
      tradeoffs: null,
    });
    setError(message);
    if (!message) {
      setForm({ title: "", decision: "", reason: "", alternatives: "" });
      setAdding(false);
    }
  };

  return (
    <Group
      title="Décisions"
      description="Chaque choix d'architecture, avec sa raison et ses alternatives : les agents savent pourquoi c'est ainsi."
      actions={
        <Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={() => setAdding((v) => !v)}>
          Ajouter
        </Button>
      }
    >
      <ErrorLine message={error} onClose={() => setError(null)} />
      {adding && (
        <div className="grid gap-2 border-b border-border py-3 md:grid-cols-2">
          <TextInput placeholder="Sujet (ex. Caméra)" aria-label="Sujet" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <TextInput placeholder="Décision" aria-label="Décision" value={form.decision} onChange={(e) => setForm({ ...form, decision: e.target.value })} />
          <TextInput placeholder="Raison" aria-label="Raison" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          <TextInput placeholder="Alternatives (séparées par ;)" aria-label="Alternatives" value={form.alternatives} onChange={(e) => setForm({ ...form, alternatives: e.target.value })} />
          <div className="flex justify-end gap-2 md:col-span-2">
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Annuler
            </Button>
            <Button size="sm" variant="primary" disabled={!form.title.trim() || !form.decision.trim()} onClick={() => void add()}>
              Enregistrer la décision
            </Button>
          </div>
        </div>
      )}
      <ul className="divide-y divide-border">
        {graph.decisions.map((d) => (
          <li key={d.id} className="flex gap-3 py-3">
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-body-sm">
                <span className="font-medium">{d.title} :</span> {d.decision}
              </p>
              <p className="text-footnote text-text-muted">{d.reason}</p>
              {d.alternatives.length > 0 && <p className="text-footnote text-text-subtle">Autres options : {d.alternatives.join(" ; ")}</p>}
              {d.tradeoffs && <p className="text-footnote text-text-subtle">Contrepartie : {d.tradeoffs}</p>}
              <p className="text-caption text-text-subtle">
                {d.by} · {ago(d.at)}
              </p>
            </div>
            <ConfirmButton label="" ariaLabel={`Retirer la décision ${d.title}`} confirmLabel="Retirer ?" icon={<Trash2 size={13} />} onConfirm={() => void apply({ op: "removeDecision", id: d.id }).then(setError)} />
          </li>
        ))}
        {graph.decisions.length === 0 && <li className="py-3 text-footnote text-text-subtle">Aucune décision notée.</li>}
      </ul>
    </Group>
  );
}

function StyleGuide() {
  const project = useGameStudioStore((s) => s.current?.project);
  const patch = useGameStudioStore((s) => s.patch);
  const [style, setStyle] = useState<GameStyleGuide | null>(project?.style ?? null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => setStyle(project?.style ?? null), [project?.style]);
  if (!project || !style) return null;
  const dirty = JSON.stringify(style) !== JSON.stringify(project.style);

  return (
    <Group
      title="Guide de style"
      description="Tout nouvel élément (modèle, texture, interface, son) le respecte : les agents le reçoivent avec chaque tâche de contenu."
      actions={
        <Button
          size="sm"
          variant={dirty ? "primary" : "secondary"}
          disabled={!dirty}
          icon={<Save size={13} />}
          onClick={() =>
            void patch({ style }).then((message) => {
              setError(message);
              setSaved(!message);
            })
          }
        >
          {saved && !dirty ? "Enregistré" : "Enregistrer"}
        </Button>
      }
    >
      <ErrorLine message={error} onClose={() => setError(null)} />
      <div className="grid gap-x-6 gap-y-3 py-3 md:grid-cols-2">
        {STYLE_FIELDS.map((field) => (
          <label key={field.key} className="space-y-1">
            <span className="text-footnote font-medium text-text-muted">{field.label}</span>
            <TextInput value={style[field.key]} placeholder={field.placeholder} onChange={(e) => setStyle({ ...style, [field.key]: e.target.value })} className="w-full" />
          </label>
        ))}
        <label className="space-y-1">
          <span className="text-footnote font-medium text-text-muted">Palette (couleurs séparées par des virgules)</span>
          <TextInput
            value={style.palette.join(", ")}
            placeholder="#1d3557, #e63946, sable"
            onChange={(e) => setStyle({ ...style, palette: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
            className="w-full"
          />
        </label>
        <label className="space-y-1">
          <span className="text-footnote font-medium text-text-muted">Références (une par ligne : fichier du projet ou adresse)</span>
          <TextArea rows={2} value={style.references.join("\n")} onChange={(e) => setStyle({ ...style, references: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })} />
        </label>
      </div>
    </Group>
  );
}

/** Conception : ce que le jeu doit être, et pourquoi il est construit ainsi. */
export function DesignSection() {
  const current = useGameStudioStore((s) => s.current);
  const patch = useGameStudioStore((s) => s.patch);
  const apply = useGameStudioStore((s) => s.apply);
  const [idea, setIdea] = useState(current?.project.idea ?? "");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setIdea(current?.project.idea ?? ""), [current?.project.idea]);
  if (!current) return null;
  const { project, graph } = current;

  return (
    <div className="space-y-8">
      <Group
        title="L'idée"
        description="Telle que vous l'avez décrite. La modifier ne change pas les systèmes : demandez à l'assistant de revoir l'architecture."
        actions={
          idea !== project.idea && (
            <Button size="sm" variant="primary" icon={<Save size={13} />} onClick={() => void patch({ idea }).then(setError)}>
              Enregistrer
            </Button>
          )
        }
      >
        <div className="py-3">
          <TextArea rows={3} value={idea} aria-label="Idée du jeu" onChange={(e) => setIdea(e.target.value)} />
          {project.genres.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-2">
              {project.genres.map((g) => (
                <Badge key={g} tone="neutral">
                  {g}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </Group>
      <ErrorLine message={error} onClose={() => setError(null)} />

      <Assumptions />
      <Decisions />

      <div className="grid gap-8 md:grid-cols-2">
        <Group title={`Monde${graph.world ? ` · ${WORLD_KIND[graph.world.kind]}` : ""}`}>
          <div className="space-y-2 py-3">
            {graph.world ? (
              <>
                <p className="text-footnote text-text-muted">{graph.world.reason}</p>
                {graph.world.traits.length > 0 && <p className="text-footnote">Avec : {graph.world.traits.map((t) => WORLD_KIND[t]).join(", ")}</p>}
                <Bullets items={graph.world.concerns} />
              </>
            ) : (
              <p className="text-footnote text-text-subtle">Pas encore défini.</p>
            )}
          </div>
        </Group>
        <Group title={`Réseau${graph.network ? ` · ${TOPOLOGY[graph.network.topology]}` : ""}`}>
          <div className="space-y-2 py-3">
            {graph.network ? (
              <>
                <p className="text-footnote text-text-muted">{graph.network.reason}</p>
                <Bullets items={[...graph.network.features, ...graph.network.notes]} />
              </>
            ) : (
              <p className="text-footnote text-text-subtle">Pas encore défini.</p>
            )}
          </div>
        </Group>
      </div>

      <Group title="Feuille de route" description="Les grandes phases du projet ; la première est la plus détaillée.">
        <ol className="divide-y divide-border">
          {graph.roadmap.map((phase, index) => (
            <li key={phase.id} className="flex flex-wrap items-start gap-3 py-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 font-mono text-caption text-text-muted">{index + 1}</span>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-body-sm font-medium">{phase.title}</p>
                <Bullets items={phase.goals} />
                {phase.systems.length > 0 && <p className="text-footnote text-text-subtle">{phase.systems.length} système(s)</p>}
              </div>
              <Segmented label={`État de la phase ${phase.title}`} size="sm" value={phase.status} options={PHASE_STATUS} onChange={(status) => void apply({ op: "upsertPhase", phase: { ...phase, status } }).then(setError)} />
            </li>
          ))}
          {graph.roadmap.length === 0 && <li className="py-3 text-footnote text-text-subtle">Aucune phase.</li>}
        </ol>
      </Group>

      <StyleGuide />
    </div>
  );
}
