import { useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, ArrowLeft, CheckCircle2, FolderOpen, HelpCircle, Loader2, Plus, Search, Sparkles, X } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Badge, Button, Select } from "@/design-system/primitives";
import type { GameAnalysis } from "@/core/ipc/bindings/GameAnalysis";
import type { GameAutonomy } from "@/core/ipc/bindings/GameAutonomy";
import type { GameCreateOutcome } from "@/core/ipc/bindings/GameCreateOutcome";
import type { GameEngine } from "@/core/ipc/bindings/GameEngine";
import type { GameMode } from "@/core/ipc/bindings/GameMode";
import type { GamePlatform } from "@/core/ipc/bindings/GamePlatform";
import type { GameSystem } from "@/core/ipc/bindings/GameSystem";
import { errorText, gameStudioApi } from "../api";
import {
  AUTONOMY,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  DIMENSION,
  ENGINE_LABEL,
  MODE,
  PLATFORM_LABEL,
  PLATFORMS,
  shortVersion,
  topicLabel,
  TOPOLOGY,
  WORLD_KIND,
} from "../lib/labels";
import { fold, folderName, joinPath } from "../lib/naming";
import { neededBy, prune, withDependencies } from "../lib/selection";
import { useGameStudioStore } from "../store";
import { Bullets, Chip, ErrorLine, focusRing, Segmented, TextArea, TextInput } from "./ui";

/** Idées de départ, de la plus simple à la plus ambitieuse. */
const EXAMPLES = [
  "Je veux créer un jeu où le joueur pêche.",
  "Un jeu de pêche relaxant avec une ville, des PNJ qui ont des routines, des bateaux, une économie, de la météo et du multijoueur coop.",
  "Un jeu comme Terraria mais en 3D, avec un monde procédural infini, du crafting, des boss, du coopératif, des véhicules et de la construction.",
  "Un souls-like open world avec coop à 3 joueurs.",
  "Un FPS compétitif avec des parties 5v5.",
  "Un platformer 2D en pixel art avec des boss et des capacités qui ouvrent le monde.",
];

type Step = "idea" | "review" | "done";

function Summary({ analysis }: { analysis: GameAnalysis }) {
  const facts = [
    ...analysis.genres,
    DIMENSION[analysis.dimension],
    analysis.perspective,
    WORLD_KIND[analysis.world.kind],
    analysis.network.topology === "none"
      ? "Solo"
      : `${TOPOLOGY[analysis.network.topology]}${analysis.network.maxPlayers ? ` · ${analysis.network.maxPlayers} joueurs` : ""}`,
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {[...new Set(facts.filter(Boolean))].map((fact) => (
        <Badge key={fact} tone="neutral">
          {fact}
        </Badge>
      ))}
    </div>
  );
}

/** Assistant de création : l'idée, ce que Game Studio en a compris, puis le projet. */
export function NewGameWizard({ onClose }: { onClose: () => void }) {
  const environment = useGameStudioStore((s) => s.environment);
  const loadEnvironment = useGameStudioStore((s) => s.loadEnvironment);
  const refresh = useGameStudioStore((s) => s.refresh);
  const openProject = useGameStudioStore((s) => s.open);

  const [step, setStep] = useState<Step>("idea");
  const [idea, setIdea] = useState("");
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Choix de la personne sur l'analyse.
  const [systems, setSystems] = useState<Map<string, GameSystem>>(new Map());
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [catalog, setCatalog] = useState<GameSystem[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [assumptionValues, setAssumptionValues] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});

  // Réglages du projet.
  const [name, setName] = useState("");
  const [engine, setEngine] = useState<GameEngine | "none">("none");
  const [editor, setEditor] = useState<string>("");
  const [cpp, setCpp] = useState(false);
  const [mode, setMode] = useState<GameMode>("standard");
  const [autonomy, setAutonomy] = useState<GameAutonomy>("assisted");
  const [targets, setTargets] = useState<GamePlatform[]>(["windows"]);
  const [parent, setParent] = useState("");
  const [git, setGit] = useState(true);
  const [outcome, setOutcome] = useState<GameCreateOutcome | null>(null);

  useEffect(() => {
    if (!environment) void loadEnvironment(false);
    void gameStudioApi.defaultParent().then(setParent).catch(() => undefined);
  }, [environment, loadEnvironment]);

  const gitReady = environment?.tools.find((t) => t.id === "git")?.state === "ready";
  const installs = useMemo(() => (environment?.engines ?? []).filter((i) => engine !== "none" && i.engine === engine), [environment, engine]);
  useEffect(() => {
    setEditor(installs[0]?.editor ?? "");
  }, [installs]);

  const analyze = async (text = idea) => {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await gameStudioApi.analyze(text);
      setAnalysis(result);
      const map = new Map(result.systems.map((d) => [d.system.id, d.system]));
      setSystems(map);
      setKept(new Set(map.keys()));
      setAssumptionValues({});
      setAnswers({});
      setName((current) => (current && current !== "Nouveau jeu" ? current : result.name));
      setEngine(result.engines[0]?.engine ?? "none");
      setMode(result.mode === "existing" ? "standard" : result.mode);
      setTargets(result.targets.length ? result.targets : ["windows"]);
      setStep("review");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const detected = useMemo(() => new Map((analysis?.systems ?? []).map((d) => [d.system.id, d])), [analysis]);

  const toggle = (id: string) => {
    setKept((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        if (neededBy(id, next, systems).length === 0) next.delete(id);
      } else {
        for (const dep of withDependencies(id, systems)) next.add(dep);
      }
      return next;
    });
  };

  const addFromCatalog = (system: GameSystem) => {
    const all = new Map(systems);
    for (const s of catalog ?? []) if (!all.has(s.id)) all.set(s.id, s);
    const ids = withDependencies(system.id, all);
    const next = new Map(systems);
    ids.forEach((id) => next.set(id, all.get(id)!));
    setSystems(next);
    setKept((current) => new Set([...current, ...ids]));
  };

  useEffect(() => {
    if (adding && !catalog) void gameStudioApi.catalog().then(setCatalog).catch((e) => setError(errorText(e)));
  }, [adding, catalog]);

  const create = async () => {
    if (!analysis) return;
    setBusy(true);
    setError(null);
    try {
      const at = new Date().toISOString();
      const assumptions = [
        ...analysis.assumptions.map((a) =>
          assumptionValues[a.id] !== undefined && assumptionValues[a.id] !== a.value
            ? { ...a, value: assumptionValues[a.id]!, status: "confirmed" as const, reason: `Choisi par vous (proposé : ${a.value}).` }
            : a,
        ),
        ...analysis.questions
          .filter((q) => answers[q.topic])
          .map((q) => ({ id: `a-answer-${q.topic}`, topic: q.topic, value: answers[q.topic]!, reason: `Réponse à : ${q.question}`, status: "confirmed" as const, at })),
      ];
      const recommended = analysis.engines[0]?.engine;
      const decisions =
        engine !== "none" && recommended && engine !== recommended
          ? analysis.decisions.map((d) => (d.id === "d-engine" ? { ...d, decision: ENGINE_LABEL[engine], reason: `Choisi par vous (recommandé : ${ENGINE_LABEL[recommended]}).`, by: "vous" } : d))
          : analysis.decisions;
      const result = await gameStudioApi.create({
        name: name.trim(),
        parent,
        engine: engine === "none" ? null : engine,
        engineEditor: editor || null,
        mode,
        autonomy,
        idea: analysis.idea,
        genres: analysis.genres,
        dimension: analysis.dimension,
        targets,
        systems: prune([...systems.values()], kept),
        assumptions,
        decisions,
        world: analysis.world,
        network: analysis.network,
        roadmap: analysis.roadmap.map((phase) => ({ ...phase, systems: phase.systems.filter((id) => kept.has(id)) })),
        cpp: engine === "unreal" && cpp,
        git: git && gitReady,
      });
      setOutcome(result);
      setStep("done");
      await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  // ── Étape 1 : l'idée ────────────────────────────────────────────────────────────────
  if (step === "idea") {
    return (
      <div className="mx-auto max-w-[720px] space-y-6 px-8 py-10">
        <button type="button" onClick={onClose} className={cn("inline-flex cursor-pointer items-center gap-1.5 text-footnote text-text-muted hover:text-text", focusRing)}>
          <ArrowLeft size={14} /> Jeux
        </button>
        <header className="space-y-1">
          <h1 className="text-title-1 font-semibold tracking-[-0.015em]">Décrivez votre jeu</h1>
          <p className="text-body text-text-muted">
            Une phrase suffit ; plus vous en dites, plus l'architecture sera juste. Game Studio en tire les systèmes nécessaires, sans se limiter à un genre.
          </p>
        </header>
        <div className="space-y-2">
          <label htmlFor="gs-idea" className="sr-only">
            Idée de jeu
          </label>
          <TextArea
            id="gs-idea"
            rows={6}
            autoFocus
            value={idea}
            placeholder="Ex. : un jeu de pêche relaxant avec une ville, des bateaux et des amis en coopération…"
            onChange={(e) => setIdea(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void analyze();
              }
            }}
          />
          <p className="text-caption text-text-subtle">Ctrl + Entrée pour analyser. Écrivez « sans combat » ou « pas de multijoueur » pour exclure quelque chose.</p>
        </div>
        <div className="space-y-2">
          <p className="text-caption font-medium text-text-subtle">Exemples</p>
          <ul className="space-y-1.5">
            {EXAMPLES.map((example) => (
              <li key={example}>
                <button
                  type="button"
                  onClick={() => setIdea(example)}
                  className={cn("w-full cursor-pointer rounded-md border border-border bg-surface-1 px-3 py-2 text-left text-body-sm text-text-muted transition-colors duration-[80ms] hover:border-border-strong hover:text-text", focusRing)}
                >
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <ErrorLine message={error} onClose={() => setError(null)} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" icon={busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} disabled={busy || !idea.trim()} onClick={() => void analyze()}>
            {busy ? "Analyse…" : "Analyser l'idée"}
          </Button>
        </div>
      </div>
    );
  }

  // ── Étape 3 : créé ──────────────────────────────────────────────────────────────────
  if (step === "done" && outcome) {
    return (
      <div className="mx-auto max-w-[640px] space-y-6 px-8 py-12">
        <div className="flex items-center gap-3">
          <CheckCircle2 size={24} className="text-success" aria-hidden />
          <h1 className="text-title-1 font-semibold tracking-[-0.015em]">« {outcome.project.name} » est créé</h1>
        </div>
        <p className="break-all font-mono text-footnote text-text-muted">{outcome.project.root}</p>
        <Bullets items={[`${outcome.files.length} fichier(s) écrit(s).`, ...outcome.notes]} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Revenir aux jeux
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onClose();
              void openProject(outcome.project.id);
            }}
          >
            Ouvrir le projet
          </Button>
        </div>
      </div>
    );
  }

  if (!analysis) return null;

  // ── Étape 2 : ce qui a été compris ──────────────────────────────────────────────────
  const foundationIds = new Set(analysis.systems.filter((d) => d.foundation).map((d) => d.system.id));
  const byCategory = CATEGORY_ORDER.map((category) => ({
    category,
    items: [...systems.values()].filter((s) => s.category === category && !foundationIds.has(s.id)),
  })).filter((group) => group.items.length > 0);
  const foundations = [...systems.values()].filter((s) => foundationIds.has(s.id));
  const matches = (catalog ?? [])
    .filter((s) => !kept.has(s.id))
    .filter((s) => !search.trim() || fold(`${s.name} ${s.role} ${s.id}`).includes(fold(search)))
    .slice(0, 40);
  const folder = parent ? joinPath(parent, folderName(name || "Nouveau jeu")) : "";

  const chip = (system: GameSystem) => {
    const info = detected.get(system.id);
    const users = neededBy(system.id, kept, systems);
    const title = [
      system.role,
      info?.evidence.length ? `Trouvé : ${info.evidence.join(", ")}` : null,
      info?.requiredBy.length ? `Nécessaire à : ${info.requiredBy.join(", ")}` : null,
      kept.has(system.id) && users.length ? `Gardé car utilisé par : ${users.map((u) => u.name).join(", ")}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    return (
      <Chip key={system.id} selected={kept.has(system.id)} disabled={kept.has(system.id) && users.length > 0} title={title} onClick={() => toggle(system.id)}>
        {system.name}
      </Chip>
    );
  };

  return (
    <div className="mx-auto max-w-[1180px] space-y-6 px-8 py-8">
      <div className="space-y-3">
        <button type="button" onClick={() => setStep("idea")} className={cn("inline-flex cursor-pointer items-center gap-1.5 text-footnote text-text-muted hover:text-text", focusRing)}>
          <ArrowLeft size={14} /> Modifier l'idée
        </button>
        <h1 className="text-title-1 font-semibold tracking-[-0.015em]">Ce que Game Studio a compris</h1>
        <blockquote className="max-w-[72ch] border-l border-border-strong pl-3 text-body text-text-muted">{analysis.idea}</blockquote>
        <Summary analysis={analysis} />
      </div>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-8">
          {analysis.questions.length > 0 && (
            <section aria-label="Questions" className="space-y-2">
              {analysis.questions.map((q) => (
                <div key={q.topic} className="space-y-2 rounded-lg bg-warning-soft p-4">
                  <p className="flex items-start gap-2 text-body-sm font-medium">
                    <HelpCircle size={15} className="mt-0.5 shrink-0 text-warning" aria-hidden /> {q.question}
                  </p>
                  <p className="text-footnote text-text-muted">{q.why}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {q.options.map((option) => (
                      <Chip key={option} selected={answers[q.topic] === option} onClick={() => setAnswers((a) => ({ ...a, [q.topic]: option }))}>
                        {option}
                      </Chip>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          )}

          <section aria-label="Systèmes" className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div className="space-y-0.5">
                <h2 className="text-title-3 font-semibold">Systèmes ({kept.size})</h2>
                <p className="text-footnote text-text-muted">Cliquez pour retirer ou remettre. Un système grisé est nécessaire à un autre.</p>
              </div>
              <Button size="sm" variant="secondary" icon={adding ? <X size={13} /> : <Plus size={13} />} onClick={() => setAdding((v) => !v)}>
                {adding ? "Fermer le catalogue" : "Ajouter un système"}
              </Button>
            </div>
            {adding && (
              <div className="space-y-2 rounded-lg border border-border bg-surface-1 p-3">
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-2 text-text-subtle" aria-hidden />
                  <TextInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Chercher dans le catalogue (ex. météo, véhicules, quêtes)" className="w-full pl-8" aria-label="Chercher un système" autoFocus />
                </div>
                {!catalog ? (
                  <p className="text-footnote text-text-subtle">Chargement du catalogue…</p>
                ) : (
                  <ul className="max-h-64 overflow-y-auto">
                    {matches.map((system) => (
                      <li key={system.id}>
                        <button type="button" onClick={() => addFromCatalog(system)} className={cn("flex w-full cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-surface-2", focusRing)}>
                          <Plus size={13} className="mt-1 shrink-0 text-text-subtle" aria-hidden />
                          <span className="min-w-0">
                            <span className="text-body-sm">{system.name}</span>
                            <span className="ml-2 text-caption text-text-subtle">{CATEGORY_LABEL[system.category]}</span>
                            <span className="block truncate text-footnote text-text-muted">{system.role}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                    {matches.length === 0 && <li className="px-2 py-1.5 text-footnote text-text-subtle">Rien de plus dans le catalogue. Un agent pourra ajouter un système propre au jeu.</li>}
                  </ul>
                )}
              </div>
            )}
            <div className="space-y-4">
              {byCategory.map(({ category, items }) => (
                <div key={category} className="space-y-1.5">
                  <p className="text-caption font-medium text-text-subtle">{CATEGORY_LABEL[category]}</p>
                  <div className="flex flex-wrap gap-1.5">{items.map(chip)}</div>
                </div>
              ))}
              {foundations.length > 0 && (
                <details className="group">
                  <summary className={cn("cursor-pointer text-caption font-medium text-text-subtle hover:text-text", focusRing)}>
                    Fondations présentes dans tout jeu ({foundations.length})
                  </summary>
                  <div className="flex flex-wrap gap-1.5 pt-2">{foundations.map(chip)}</div>
                </details>
              )}
            </div>
          </section>

          {analysis.assumptions.length > 0 && (
            <section aria-label="Hypothèses" className="space-y-2">
              <div className="space-y-0.5">
                <h2 className="text-title-3 font-semibold">Hypothèses</h2>
                <p className="text-footnote text-text-muted">Ce que l'idée ne disait pas : choisi par défaut, modifiable maintenant ou plus tard.</p>
              </div>
              <ul className="divide-y divide-border rounded-lg border border-border bg-surface-1">
                {analysis.assumptions.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-caption font-medium text-text-subtle">{topicLabel(a.topic)}</p>
                      <TextInput
                        aria-label={`Valeur de l'hypothèse ${topicLabel(a.topic)}`}
                        value={assumptionValues[a.id] ?? a.value}
                        onChange={(e) => setAssumptionValues((v) => ({ ...v, [a.id]: e.target.value }))}
                        className="w-full max-w-sm"
                      />
                      <p className="text-footnote text-text-muted">{a.reason}</p>
                    </div>
                    {assumptionValues[a.id] !== undefined && assumptionValues[a.id] !== a.value && <Badge tone="accent">Modifiée</Badge>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-label="Décisions" className="space-y-2">
            <h2 className="text-title-3 font-semibold">Décisions d'architecture</h2>
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface-1">
              {analysis.decisions.map((d) => (
                <li key={d.id} className="space-y-1 px-4 py-3">
                  <p className="text-body-sm">
                    <span className="font-medium">{d.title} :</span> {d.decision}
                  </p>
                  <p className="text-footnote text-text-muted">{d.reason}</p>
                  {d.alternatives.length > 0 && <p className="text-footnote text-text-subtle">Autre option : {d.alternatives.join(" ; ")}</p>}
                  {d.tradeoffs && <p className="text-footnote text-text-subtle">Contrepartie : {d.tradeoffs}</p>}
                </li>
              ))}
            </ul>
          </section>

          <div className="grid gap-6 md:grid-cols-2">
            <section aria-label="Monde" className="space-y-2">
              <h2 className="text-title-3 font-semibold">Monde · {WORLD_KIND[analysis.world.kind]}</h2>
              <p className="text-footnote text-text-muted">{analysis.world.reason}</p>
              <Bullets items={analysis.world.concerns} />
            </section>
            <section aria-label="Réseau" className="space-y-2">
              <h2 className="text-title-3 font-semibold">Réseau · {TOPOLOGY[analysis.network.topology]}</h2>
              <p className="text-footnote text-text-muted">{analysis.network.reason}</p>
              <Bullets items={[...analysis.network.features, ...analysis.network.notes]} />
            </section>
          </div>

          {analysis.risks.length > 0 && (
            <section aria-label="Risques" className="space-y-2">
              <h2 className="flex items-center gap-2 text-title-3 font-semibold">
                <AlertTriangle size={16} className="text-warning" aria-hidden /> Risques à surveiller
              </h2>
              <Bullets items={analysis.risks} />
            </section>
          )}

          <div className="grid gap-6 md:grid-cols-2">
            <section aria-label="Feuille de route" className="space-y-2">
              <h2 className="text-title-3 font-semibold">Feuille de route</h2>
              <ol className="space-y-1.5">
                {analysis.roadmap.map((phase, index) => (
                  <li key={phase.id} className="flex gap-2 text-body-sm">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-2 font-mono text-caption text-text-muted">{index + 1}</span>
                    <span className="min-w-0">
                      {phase.title}
                      <span className="block text-footnote text-text-muted">{phase.goals[0]}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </section>
            {analysis.content.length > 0 && (
              <section aria-label="Contenu à produire" className="space-y-2">
                <h2 className="text-title-3 font-semibold">Contenu à produire</h2>
                <Bullets items={analysis.content} />
              </section>
            )}
          </div>
        </div>

        <aside aria-label="Réglages du projet" className="space-y-5 rounded-lg border border-border bg-surface-1 p-4 lg:sticky lg:top-4">
          <div className="space-y-1.5">
            <label htmlFor="gs-name" className="text-body-sm font-medium">
              Nom du jeu
            </label>
            <TextInput id="gs-name" value={name} onChange={(e) => setName(e.target.value)} className="w-full" />
          </div>

          <div className="space-y-1.5" role="radiogroup" aria-label="Moteur">
            <p className="text-body-sm font-medium">Moteur</p>
            {analysis.engines.map((score, index) => (
              <button
                key={score.engine}
                type="button"
                role="radio"
                aria-checked={engine === score.engine}
                onClick={() => setEngine(score.engine)}
                className={cn(
                  "w-full cursor-pointer rounded-md border px-3 py-2 text-left transition-colors duration-[80ms]",
                  focusRing,
                  engine === score.engine ? "border-accent bg-accent-soft" : "border-border hover:border-border-strong",
                )}
              >
                <span className="flex items-center gap-2 text-body-sm font-medium">
                  {ENGINE_LABEL[score.engine]}
                  {index === 0 && <Badge tone="accent">Recommandé</Badge>}
                  {score.installed ? <Badge tone="success">Installé</Badge> : <span className="text-caption text-text-subtle">À installer</span>}
                </span>
                <span className="block text-footnote text-text-muted">{score.reasons[0] ?? ""}</span>
                {score.concerns[0] && <span className="block text-footnote text-text-subtle">{score.concerns[0]}</span>}
              </button>
            ))}
            <button
              type="button"
              role="radio"
              aria-checked={engine === "none"}
              onClick={() => setEngine("none")}
              className={cn("w-full cursor-pointer rounded-md border px-3 py-2 text-left text-body-sm", focusRing, engine === "none" ? "border-accent bg-accent-soft" : "border-border hover:border-border-strong")}
            >
              Choisir plus tard
              <span className="block text-footnote text-text-muted">Le projet garde la conception ; le moteur se choisit dans ses réglages.</span>
            </button>
            {installs.length > 1 && (
              <Select
                label="Version installée"
                value={editor}
                onChange={setEditor}
                options={installs.map((i) => ({ value: i.editor, label: `${ENGINE_LABEL[i.engine]} ${shortVersion(i.version)}`.trim(), hint: i.source }))}
                className="w-full"
              />
            )}
            {engine === "unreal" && (
              <label className="flex items-center gap-2 pt-1 text-body-sm">
                <input type="checkbox" checked={cpp} onChange={(e) => setCpp(e.target.checked)} className="accent-[var(--color-accent)]" />
                Module C++ (sinon Blueprints seulement)
              </label>
            )}
          </div>

          <div className="space-y-1.5">
            <p className="text-body-sm font-medium">Ambition</p>
            <Segmented
              label="Ambition du projet"
              size="sm"
              value={mode}
              onChange={setMode}
              options={(["prototype", "standard", "advanced", "production"] as GameMode[]).map((m) => ({ value: m, label: MODE[m].label.split(" ")[0]!, hint: MODE[m].hint }))}
            />
            <p className="text-footnote text-text-muted">{MODE[mode].hint}</p>
          </div>

          <div className="space-y-1.5">
            <p className="text-body-sm font-medium">Liberté des agents</p>
            <Segmented label="Liberté des agents" size="sm" value={autonomy} onChange={setAutonomy} options={(["manual", "assisted", "autonomous"] as GameAutonomy[]).map((a) => ({ value: a, label: AUTONOMY[a].label }))} />
            <p className="text-footnote text-text-muted">{AUTONOMY[autonomy].hint}</p>
          </div>

          <div className="space-y-1.5">
            <p className="text-body-sm font-medium">Plateformes</p>
            <div className="flex flex-wrap gap-1.5">
              {PLATFORMS.map((p) => (
                <Chip key={p} selected={targets.includes(p)} onClick={() => setTargets((t) => (t.includes(p) ? (t.length > 1 ? t.filter((x) => x !== p) : t) : [...t, p]))}>
                  {PLATFORM_LABEL[p]}
                </Chip>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-body-sm font-medium">Dossier</p>
            <p className="break-all font-mono text-caption text-text-muted">{folder || "…"}</p>
            <Button
              size="sm"
              variant="ghost"
              icon={<FolderOpen size={13} />}
              onClick={() =>
                void openDialog({ directory: true, multiple: false, title: "Dossier où créer le jeu" }).then((picked) => {
                  if (typeof picked === "string") setParent(picked);
                })
              }
            >
              Changer…
            </Button>
          </div>

          <label className={cn("flex items-start gap-2 text-body-sm", !gitReady && "opacity-60")}>
            <input type="checkbox" checked={git && gitReady} disabled={!gitReady} onChange={(e) => setGit(e.target.checked)} className="mt-1 accent-[var(--color-accent)]" />
            <span>
              Suivre les versions avec Git
              <span className="block text-footnote text-text-muted">{gitReady ? "Points de restauration et retour en arrière." : "Git n'est pas installé (onglet Outils)."}</span>
            </span>
          </label>

          <ErrorLine message={error} onClose={() => setError(null)} />
          <Button variant="primary" className="w-full" icon={busy ? <Loader2 size={14} className="animate-spin" /> : undefined} disabled={busy || !name.trim() || !parent || kept.size === 0} onClick={() => void create()}>
            {busy ? "Création…" : "Créer le jeu"}
          </Button>
        </aside>
      </div>
    </div>
  );
}
