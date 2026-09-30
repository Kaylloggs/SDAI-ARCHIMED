import { useEffect, useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Badge, Button, Select } from "@/design-system/primitives";
import type { GameSystem } from "@/core/ipc/bindings/GameSystem";
import type { GameSystemCategory } from "@/core/ipc/bindings/GameSystemCategory";
import { errorText, gameStudioApi } from "../../api";
import { consumers, systemId } from "../../lib/graph";
import { CATEGORY_LABEL, CATEGORY_ORDER, NET_MODE, SYSTEM_STATUS } from "../../lib/labels";
import { fold } from "../../lib/naming";
import { useGameStudioStore } from "../../store";
import { Chip, ErrorLine, focusRing, Segmented, TextInput, ToneBadge } from "../ui";
import { SystemDetail } from "./SystemDetail";
import { SystemGraph } from "./SystemGraph";

type View = "graph" | "list";

/** Ajout d'un système : depuis le catalogue (avec ses dépendances), ou propre au jeu. */
function AddPanel({ systems, onClose }: { systems: GameSystem[]; onClose: () => void }) {
  const apply = useGameStudioStore((s) => s.apply);
  const select = useGameStudioStore((s) => s.selectSystem);
  const [mode, setMode] = useState<"catalog" | "custom">("catalog");
  const [catalog, setCatalog] = useState<GameSystem[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [custom, setCustom] = useState({ name: "", role: "", category: "gameplay" as GameSystemCategory, deps: [] as string[] });

  useEffect(() => {
    void gameStudioApi.catalog().then(setCatalog).catch((e) => setError(errorText(e)));
  }, []);

  const present = new Set(systems.map((s) => s.id));
  const matches = (catalog ?? []).filter((s) => !present.has(s.id)).filter((s) => !search.trim() || fold(`${s.name} ${s.role}`).includes(fold(search))).slice(0, 30);

  const addCustom = async () => {
    const id = systemId(custom.name);
    const message = await apply({
      op: "upsertSystem",
      system: {
        id,
        name: custom.name.trim(),
        category: custom.category,
        role: custom.role.trim() || custom.name.trim(),
        origin: "custom",
        dependencies: custom.deps,
        produces: [],
        files: [],
        assets: [],
        interfaces: [],
        data: [],
        constraints: [],
        tests: [],
        status: "planned",
        network: "local",
        risk: null,
        notes: null,
      },
    });
    setError(message);
    if (!message) {
      select(id);
      onClose();
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface-1 p-4">
      <div className="flex items-center justify-between gap-2">
        <Segmented
          label="Type de système à ajouter"
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { value: "catalog", label: "Depuis le catalogue" },
            { value: "custom", label: "Système propre au jeu" },
          ]}
        />
        <button type="button" onClick={onClose} aria-label="Fermer l'ajout" className={cn("flex size-7 cursor-pointer items-center justify-center rounded-sm text-text-subtle hover:bg-surface-2 hover:text-text", focusRing)}>
          <X size={14} />
        </button>
      </div>
      <ErrorLine message={error} onClose={() => setError(null)} />
      {mode === "catalog" ? (
        <>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2 text-text-subtle" aria-hidden />
            <TextInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Chercher (météo, pêche, réplication…)" aria-label="Chercher dans le catalogue" className="w-full pl-8" autoFocus />
          </div>
          <ul className="max-h-72 overflow-y-auto">
            {matches.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() =>
                    void apply({ op: "addCatalogSystem", id: s.id }).then((message) => {
                      setError(message);
                      if (!message) select(s.id);
                    })
                  }
                  className={cn("flex w-full cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-surface-2", focusRing)}
                >
                  <Plus size={13} className="mt-1 shrink-0 text-text-subtle" aria-hidden />
                  <span className="min-w-0">
                    <span className="text-body-sm">{s.name}</span> <span className="text-caption text-text-subtle">{CATEGORY_LABEL[s.category]}</span>
                    <span className="block truncate text-footnote text-text-muted">{s.role}</span>
                  </span>
                </button>
              </li>
            ))}
            {catalog && matches.length === 0 && <li className="px-2 py-1.5 text-footnote text-text-subtle">Rien de plus dans le catalogue : créez un système propre au jeu.</li>}
          </ul>
        </>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-footnote font-medium text-text-muted">Nom</span>
            <TextInput value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} placeholder="Pêche au harpon" className="w-full" />
            {custom.name && <span className="block font-mono text-caption text-text-subtle">{systemId(custom.name)}</span>}
          </label>
          <div className="space-y-1">
            <span className="text-footnote font-medium text-text-muted">Catégorie</span>
            <Select label="Catégorie" value={custom.category} onChange={(v) => setCustom({ ...custom, category: v as GameSystemCategory })} options={CATEGORY_ORDER.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))} className="w-full" />
          </div>
          <label className="space-y-1 md:col-span-2">
            <span className="text-footnote font-medium text-text-muted">Rôle dans le jeu</span>
            <TextInput value={custom.role} onChange={(e) => setCustom({ ...custom, role: e.target.value })} placeholder="Viser et lancer un harpon sur les gros poissons, avec une jauge de tension." className="w-full" />
          </label>
          <div className="space-y-1 md:col-span-2">
            <span className="text-footnote font-medium text-text-muted">Dépend de</span>
            <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
              {systems.map((s) => (
                <Chip key={s.id} selected={custom.deps.includes(s.id)} onClick={() => setCustom({ ...custom, deps: custom.deps.includes(s.id) ? custom.deps.filter((d) => d !== s.id) : [...custom.deps, s.id] })}>
                  {s.name}
                </Chip>
              ))}
            </div>
          </div>
          <div className="flex justify-end md:col-span-2">
            <Button variant="primary" size="sm" disabled={!custom.name.trim()} onClick={() => void addCustom()}>
              Ajouter le système
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Systèmes du jeu : graphe des dépendances ou liste, et fiche du système choisi. */
export function SystemsSection() {
  const systems = useGameStudioStore((s) => s.current?.graph.systems ?? []);
  const selected = useGameStudioStore((s) => s.selectedSystem);
  const select = useGameStudioStore((s) => s.selectSystem);
  const [view, setView] = useState<View>("graph");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);

  const visible = useMemo(() => {
    if (!search.trim()) return systems;
    const q = fold(search);
    const hits = new Set(systems.filter((s) => fold(`${s.name} ${s.role} ${s.id}`).includes(q)).map((s) => s.id));
    // Garder les dépendances des résultats : le graphe reste lisible.
    return systems.filter((s) => hits.has(s.id) || systems.some((h) => hits.has(h.id) && h.dependencies.includes(s.id)));
  }, [systems, search]);
  const current = systems.find((s) => s.id === selected) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Affichage" value={view} onChange={setView} options={[{ value: "graph", label: "Graphe" }, { value: "list", label: "Liste" }]} />
        <div className="relative min-w-[200px] flex-1">
          <Search size={14} className="absolute left-2.5 top-2 text-text-subtle" aria-hidden />
          <TextInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filtrer les systèmes" aria-label="Filtrer les systèmes" className="w-full max-w-sm pl-8" />
        </div>
        <span className="text-footnote tabular-nums text-text-muted">{systems.length} systèmes</span>
        <Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={() => setAdding((v) => !v)}>
          Ajouter un système
        </Button>
      </div>
      {adding && <AddPanel systems={systems} onClose={() => setAdding(false)} />}

      {systems.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface-1 px-4 py-6 text-center text-body-sm text-text-muted">
          Aucun système. Ajoutez-en depuis le catalogue, ou demandez à l'assistant d'analyser le projet.
        </p>
      ) : (
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
          <div className="min-w-0 flex-1">
            {view === "graph" ? (
              <SystemGraph systems={visible} selected={selected} onSelect={select} />
            ) : (
              <div className="space-y-4">
                {CATEGORY_ORDER.map((category) => {
                  const items = visible.filter((s) => s.category === category);
                  if (items.length === 0) return null;
                  return (
                    <section key={category} aria-label={CATEGORY_LABEL[category]} className="space-y-1.5">
                      <p className="text-caption font-medium text-text-subtle">{CATEGORY_LABEL[category]}</p>
                      <ul className="divide-y divide-border rounded-lg border border-border bg-surface-1">
                        {items.map((s) => (
                          <li key={s.id}>
                            <button
                              type="button"
                              aria-pressed={selected === s.id}
                              onClick={() => select(selected === s.id ? null : s.id)}
                              className={cn("flex w-full cursor-pointer flex-wrap items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-2", focusRing, selected === s.id && "bg-accent-soft")}
                            >
                              <span className="min-w-0 flex-1">
                                <span className="text-body-sm">{s.name}</span>
                                <span className="block truncate text-footnote text-text-muted">{s.role}</span>
                              </span>
                              <span className="text-caption text-text-subtle">{NET_MODE[s.network]}</span>
                              <span className="text-caption tabular-nums text-text-subtle">
                                {s.dependencies.length} dép. · {consumers(systems, s.id).length} util.
                              </span>
                              <ToneBadge tone={SYSTEM_STATUS[s.status].tone}>{SYSTEM_STATUS[s.status].label}</ToneBadge>
                              {s.origin === "custom" && <Badge tone="accent">Propre</Badge>}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
            )}
          </div>
          {current && <SystemDetail system={current} systems={systems} onClose={() => select(null)} />}
        </div>
      )}
    </div>
  );
}
