import { useEffect, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { FolderOpen, Save } from "lucide-react";
import { Button, Select } from "@/design-system/primitives";
import type { GameAutonomy } from "@/core/ipc/bindings/GameAutonomy";
import type { GameBudget } from "@/core/ipc/bindings/GameBudget";
import type { GameDimension } from "@/core/ipc/bindings/GameDimension";
import type { GameEngine } from "@/core/ipc/bindings/GameEngine";
import type { GameMode } from "@/core/ipc/bindings/GameMode";
import type { GamePlatform } from "@/core/ipc/bindings/GamePlatform";
import { errorText, gameStudioApi } from "../../api";
import { AUTONOMY, DIMENSION, ENGINE_LABEL, ENGINES, MODE, PLATFORM_LABEL, PLATFORMS, shortVersion } from "../../lib/labels";
import { useGameStudioStore } from "../../store";
import { Bullets, Chip, ErrorLine, Field, Group, Segmented, TextInput } from "../ui";

const EMPTY_BUDGET: GameBudget = { targetFps: null, resolution: null, memoryMb: null, cpuMs: null, gpuMs: null, networkKbps: null };

const BUDGET_FIELDS: { key: keyof GameBudget; label: string; unit: string; integer: boolean }[] = [
  { key: "targetFps", label: "Images par seconde visées", unit: "i/s", integer: true },
  { key: "memoryMb", label: "Mémoire maximale", unit: "Mo", integer: true },
  { key: "cpuMs", label: "Temps processeur par image", unit: "ms", integer: false },
  { key: "gpuMs", label: "Temps carte graphique par image", unit: "ms", integer: false },
  { key: "networkKbps", label: "Bande passante par joueur", unit: "kbit/s", integer: true },
];

/** Choix du moteur d'un projet créé sans moteur. */
function EngineChoice() {
  const current = useGameStudioStore((s) => s.current);
  const environment = useGameStudioStore((s) => s.environment);
  const loadEnvironment = useGameStudioStore((s) => s.loadEnvironment);
  const reload = useGameStudioStore((s) => s.reload);
  const refresh = useGameStudioStore((s) => s.refresh);
  const [engine, setEngine] = useState<GameEngine>("godot");
  const [cpp, setCpp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  useEffect(() => {
    if (!environment) void loadEnvironment(false);
  }, [environment, loadEnvironment]);
  if (!current) return null;
  const installed = (environment?.engines ?? []).filter((i) => i.engine === engine);

  const choose = async () => {
    setBusy(true);
    try {
      setNotes(await gameStudioApi.setEngine(current.project.id, engine, installed[0]?.editor ?? null, engine === "unreal" && cpp));
      await Promise.all([reload(), refresh()]);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Group title="Moteur" description="Le projet a été créé sans moteur : choisissez-le, Game Studio écrit ses fichiers à côté de la conception.">
      <ErrorLine message={error} onClose={() => setError(null)} />
      <Field label="Moteur du jeu" hint={installed.length ? `Installé : ${shortVersion(installed[0]!.version) || installed[0]!.editor}` : "Pas encore installé : le projet s'ouvrira dès qu'il le sera."}>
        <Segmented label="Moteur" value={engine} onChange={setEngine} options={ENGINES.map((e) => ({ value: e, label: ENGINE_LABEL[e] }))} />
      </Field>
      {engine === "unreal" && (
        <Field label="Module C++" hint="Sinon, projet Blueprints seulement.">
          <input type="checkbox" checked={cpp} onChange={(e) => setCpp(e.target.checked)} aria-label="Module C++" className="accent-[var(--color-accent)]" />
        </Field>
      )}
      <div className="flex justify-end border-t border-border py-3">
        <Button variant="primary" size="sm" disabled={busy} onClick={() => void choose()}>
          {busy ? "Écriture…" : `Créer le projet ${ENGINE_LABEL[engine]}`}
        </Button>
      </div>
      {notes.length > 0 && (
        <div className="pb-3">
          <Bullets items={notes} />
        </div>
      )}
    </Group>
  );
}

/** Réglages du projet : identité, ambition, liberté des agents, plateformes et budget. */
export function SettingsSection() {
  const current = useGameStudioStore((s) => s.current);
  const patch = useGameStudioStore((s) => s.patch);
  const [name, setName] = useState(current?.project.name ?? "");
  const [budget, setBudget] = useState<GameBudget>(current?.project.budget ?? EMPTY_BUDGET);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setName(current?.project.name ?? "");
    setBudget(current?.project.budget ?? EMPTY_BUDGET);
  }, [current?.project.name, current?.project.budget]);
  if (!current) return null;
  const { project } = current;
  const save = (value: Parameters<typeof patch>[0]) => void patch(value).then(setError);
  const budgetDirty = JSON.stringify(budget) !== JSON.stringify(project.budget);

  return (
    <div className="space-y-8">
      <ErrorLine message={error} onClose={() => setError(null)} />
      {!project.engine && <EngineChoice />}
      <Group title="Projet">
        <Field label="Nom" htmlFor="gs-project-name">
          <TextInput id="gs-project-name" value={name} onChange={(e) => setName(e.target.value)} className="w-64" />
          {name.trim() !== project.name && (
            <Button size="sm" variant="primary" icon={<Save size={13} />} disabled={!name.trim()} onClick={() => save({ name })}>
              Enregistrer
            </Button>
          )}
        </Field>
        <Field label="Dossier" hint={project.root}>
          <Button size="sm" variant="ghost" icon={<FolderOpen size={13} />} onClick={() => void revealItemInDir(project.root).catch((e) => setError(errorText(e)))}>
            Ouvrir dans l'Explorateur
          </Button>
        </Field>
        <Field label="Moteur" hint={project.engine ? "Changer de moteur est un portage : demandez-le à l'assistant comme une tâche." : "Aucun pour l'instant."}>
          <span className="text-body-sm">{project.engine ? `${ENGINE_LABEL[project.engine]} ${shortVersion(project.engineVersion)}` : "—"}</span>
        </Field>
        <Field label="Dimension">
          <Segmented label="Dimension" value={project.dimension} onChange={(dimension: GameDimension) => save({ dimension })} options={(Object.keys(DIMENSION) as GameDimension[]).map((d) => ({ value: d, label: DIMENSION[d] }))} />
        </Field>
        <Field label="Version du jeu" hint="Avancée à chaque étape marquante (0.1 prototype, 0.2 inventaire…).">
          <span className="font-mono text-body-sm">v{project.version}</span>
        </Field>
      </Group>

      <Group title="Travail des agents">
        <Field label="Ambition" hint={MODE[project.mode].hint}>
          <Select label="Ambition du projet" value={project.mode} onChange={(mode) => save({ mode: mode as GameMode })} options={(Object.keys(MODE) as GameMode[]).map((m) => ({ value: m, label: MODE[m].label }))} className="w-48" />
        </Field>
        <Field label="Liberté des agents" hint={AUTONOMY[project.autonomy].hint}>
          <Segmented label="Liberté des agents" value={project.autonomy} onChange={(autonomy: GameAutonomy) => save({ autonomy })} options={(Object.keys(AUTONOMY) as GameAutonomy[]).map((a) => ({ value: a, label: AUTONOMY[a].label }))} />
        </Field>
      </Group>

      <Group title="Plateformes">
        <div className="flex flex-wrap gap-1.5 py-3">
          {PLATFORMS.map((p) => (
            <Chip
              key={p}
              selected={project.targets.includes(p)}
              onClick={() => {
                const targets: GamePlatform[] = project.targets.includes(p) ? project.targets.filter((t) => t !== p) : [...project.targets, p];
                if (targets.length > 0) save({ targets });
              }}
            >
              {PLATFORM_LABEL[p]}
            </Chip>
          ))}
        </div>
      </Group>

      <Group
        title="Budget de performance"
        description="Les agents en tiennent compte (LOD, streaming, effets) et l'optimisation s'y compare. Laissez vide ce qui ne compte pas."
        actions={
          budgetDirty && (
            <Button size="sm" variant="primary" icon={<Save size={13} />} onClick={() => save({ budget })}>
              Enregistrer
            </Button>
          )
        }
      >
        {BUDGET_FIELDS.map((field) => (
          <Field key={field.key} label={field.label}>
            <TextInput
              type="number"
              min={0}
              step={field.integer ? 1 : 0.1}
              aria-label={field.label}
              value={budget[field.key] === null || budget[field.key] === undefined ? "" : String(budget[field.key])}
              onChange={(e) => {
                const raw = e.target.value;
                const value = raw === "" ? null : field.integer ? Math.max(0, Math.round(Number(raw))) : Math.max(0, Number(raw));
                setBudget({ ...budget, [field.key]: value });
              }}
              className="w-28 text-right tabular-nums"
            />
            <span className="w-12 text-footnote text-text-muted">{field.unit}</span>
          </Field>
        ))}
        <Field label="Résolution visée">
          <TextInput value={budget.resolution ?? ""} placeholder="1920x1080" aria-label="Résolution visée" onChange={(e) => setBudget({ ...budget, resolution: e.target.value || null })} className="w-40" />
        </Field>
      </Group>
    </div>
  );
}
