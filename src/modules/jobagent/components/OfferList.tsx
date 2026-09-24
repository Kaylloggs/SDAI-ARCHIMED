import { useEffect, useMemo, useState, type MouseEvent } from "react";
import {
  Check,
  ChevronRight,
  Filter,
  Minus,
  Search,
  Send,
  Star,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { Button, EmptyState, Kbd, Select } from "@/design-system/primitives";
import { cn } from "@/core/lib/cn";
import {
  inScope,
  nextAfter,
  rangeBetween,
  sentIds,
  type Scope,
} from "../lib/triage";
import { useJobAgentStore } from "../store";
import type { Offer } from "../types";
import { contractLabel, daysSince, OfferCard } from "./OfferCard";
import { focusRing } from "./Panel";

export type GroupBy =
  "domain" | "freshness" | "contract" | "city" | "company" | "source" | "none";

const SCOPES: Array<{ id: Scope; label: string }> = [
  { id: "unseen", label: "À voir" },
  { id: "all", label: "Toutes" },
  { id: "starred", label: "Favoris" },
  { id: "applied", label: "Candidatures" },
];

const GROUPS: Array<{ value: GroupBy; label: string }> = [
  { value: "domain", label: "Par métier" },
  { value: "freshness", label: "Par fraîcheur" },
  { value: "contract", label: "Par contrat" },
  { value: "city", label: "Par ville" },
  { value: "company", label: "Par entreprise" },
  { value: "source", label: "Par plateforme" },
  { value: "none", label: "Sans regroupement" },
];

/** Tranches d'ancienneté, de la plus fraîche à la plus ancienne. */
const FRESHNESS_BUCKETS: Array<{ label: string; maxDays: number }> = [
  { label: "Aujourd'hui", maxDays: 0 },
  { label: "Cette semaine", maxDays: 7 },
  { label: "Ce mois-ci", maxDays: 31 },
  { label: "Plus ancien", maxDays: Number.POSITIVE_INFINITY },
];

export function bucketOf(offer: Offer): string {
  const days = daysSince(offer.posted);
  if (days === null) return "Date inconnue";
  const age = Math.max(0, days);
  return (
    FRESHNESS_BUCKETS.find((bucket) => age <= bucket.maxDays) ??
    FRESHNESS_BUCKETS[3]!
  ).label;
}

export function groupKey(offer: Offer, by: GroupBy): string {
  switch (by) {
    case "domain":
      return offer.domain ?? "Autres";
    case "freshness":
      return bucketOf(offer);
    case "contract":
      return contractLabel(offer.contract) ?? "Contrat non précisé";
    case "city":
      return offer.city ?? offer.country ?? "Lieu non précisé";
    case "company":
      return offer.company ?? "Entreprise non précisée";
    case "source":
      return offer.source_label;
    default:
      return "";
  }
}

/** Ordre des sections : la fraîcheur suit ses tranches, le reste va du plus gros au plus petit. */
export function sortGroups(
  entries: Array<[string, Offer[]]>,
  by: GroupBy,
): Array<[string, Offer[]]> {
  if (by === "freshness") {
    const order = [
      ...FRESHNESS_BUCKETS.map((bucket) => bucket.label),
      "Date inconnue",
    ];
    return entries.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  }
  return entries.sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "fr"),
  );
}

/**
 * Résultats d'une recherche : deux cents annonces se passent en revue par sections,
 * pas en liste continue. Chaque annonce ne vit que dans un onglet — mise en favori, elle
 * quitte « Toutes » ; candidature partie, elle quitte les favoris — pour que chaque onglet
 * soit une pile qui se vide.
 *
 * Tri rapide : cases à cocher (Ctrl ou Maj + clic, Maj + ↑ ↓), puis une seule action pour
 * toute la sélection. Au clavier, F met en favori et Suppr supprime, et la revue passe
 * d'elle-même à l'annonce suivante.
 */
export function OfferList({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (offer: Offer) => void;
}) {
  const {
    offers,
    starred,
    seen,
    applications,
    undo,
    toggleStar,
    setStarred,
    undoDismiss,
    dismissMany,
    markAllSeen,
    prepareBatch,
    lastRunAt,
  } = useJobAgentStore();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("unseen");
  const [groupBy, setGroupBy] = useState<GroupBy>("domain");
  const [collapsed, setCollapsed] = useState<string[]>([]);
  /** Annonces cochées pour une action groupée. */
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  /** Dernière carte cochée : Maj + clic coche tout jusqu'à elle. */
  const [anchor, setAnchor] = useState<string | null>(null);
  /**
   * Annonces déjà vues **à l'ouverture de l'onglet**. Sans cet instantané, l'annonce
   * qu'on vient d'ouvrir s'évanouit sous le curseur : elle reste affichée, grisée, et
   * ne disparaîtra qu'au prochain passage sur « À voir ».
   */
  const [reviewed, setReviewed] = useState<Set<string>>(() => new Set(seen));

  const starredSet = useMemo(() => new Set(starred), [starred]);
  const sent = useMemo(() => sentIds(applications), [applications]);
  const tracked = useMemo(
    () => new Set(applications.map((application) => application.offerId)),
    [applications],
  );
  const seenSet = useMemo(() => new Set(seen), [seen]);

  // Nouvel instantané, et sélection vidée, à chaque changement d'onglet et de recherche.
  useEffect(() => {
    setReviewed(new Set(useJobAgentStore.getState().seen));
    setChecked(new Set());
    setAnchor(null);
  }, [scope, lastRunAt]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const context = { starred: starredSet, sent, tracked, reviewed };
    return offers.filter((offer) => {
      if (!inScope(offer, scope, context)) return false;
      if (!needle) return true;
      return [offer.title, offer.company, offer.location, offer.domain]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle));
    });
  }, [offers, scope, starredSet, sent, tracked, reviewed, query]);

  const groups = useMemo(() => {
    if (groupBy === "none") return [["", visible]] as Array<[string, Offer[]]>;
    const map = new Map<string, Offer[]>();
    for (const offer of visible) {
      const key = groupKey(offer, groupBy);
      map.set(key, [...(map.get(key) ?? []), offer]);
    }
    return sortGroups([...map.entries()], groupBy);
  }, [visible, groupBy]);

  /** Ordre réel à l'écran : c'est lui que suivent les flèches et la sélection étendue. */
  const flat = useMemo(
    () =>
      groups.flatMap(([key, items]) => (collapsed.includes(key) ? [] : items)),
    [groups, collapsed],
  );
  const order = useMemo(() => flat.map((offer) => offer.id), [flat]);

  // Une coche ne survit pas à l'annonce qu'elle désignait (supprimée, partie ailleurs).
  useEffect(() => {
    const present = new Set(visible.map((offer) => offer.id));
    setChecked((current) => {
      const kept = [...current].filter((id) => present.has(id));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [visible]);

  const selection = useMemo(
    () =>
      visible.filter((offer) => checked.has(offer.id)).map((offer) => offer.id),
    [visible, checked],
  );

  /** Coche une carte ; avec Maj, toute la plage depuis la précédente. */
  const check = (id: string, extend: boolean) => {
    setChecked((current) => {
      const next = new Set(current);
      if (extend && anchor) {
        for (const item of rangeBetween(order, anchor, id)) next.add(item);
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setAnchor(id);
  };

  const clearSelection = () => {
    setChecked(new Set());
    setAnchor(null);
  };

  /** Ouvre l'annonce qui suit celles qui viennent de quitter la liste. */
  const advancePast = (removed: string[]) => {
    const next = nextAfter(order, new Set(removed), selectedId);
    const target = next ? flat.find((offer) => offer.id === next) : undefined;
    if (target && removed.includes(selectedId ?? "")) onSelect(target);
  };

  const removeSelection = (ids: string[]) => {
    if (!ids.length) return;
    advancePast(ids);
    dismissMany(ids);
    clearSelection();
  };

  /** En dehors des favoris, une annonce mise en favori quitte la liste. */
  const starSelection = (ids: string[], on: boolean) => {
    if (!ids.length) return;
    if (scope !== "applied") advancePast(ids);
    setStarred(ids, on);
    clearSelection();
  };

  const toggleOne = (offer: Offer) => {
    if (scope !== "applied") advancePast([offer.id]);
    toggleStar(offer.id);
    // Sur ce même clic, la carte quitte ou rejoint les favoris : sa coche n'a plus d'objet.
    setChecked((current) => {
      if (!current.has(offer.id)) return current;
      const next = new Set(current);
      next.delete(offer.id);
      return next;
    });
  };

  // Raccourcis de revue. L'écoute est posée sur le document : après un clic sur une
  // carte, le focus ne reste pas forcément dans la liste.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
          target.isContentEditable)
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      const current = flat.find((offer) => offer.id === selectedId) ?? null;

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (!flat.length) return;
        event.preventDefault();
        const index = flat.findIndex((offer) => offer.id === selectedId);
        const next = event.key === "ArrowDown" ? index + 1 : index - 1;
        const destination = flat[Math.max(0, Math.min(flat.length - 1, next))];
        if (!destination) return;
        // Maj + flèche : on coche en avançant, la plage se construit au clavier.
        if (event.shiftKey) {
          setChecked((selected) => {
            const grown = new Set(selected);
            if (current) grown.add(current.id);
            grown.add(destination.id);
            return grown;
          });
          setAnchor(destination.id);
        }
        onSelect(destination);
        return;
      }

      if ((event.ctrlKey || event.metaKey) && key === "a") {
        event.preventDefault();
        setChecked(new Set(order));
        return;
      }

      if ((event.ctrlKey || event.metaKey) && key === "z" && undo) {
        event.preventDefault();
        undoDismiss();
        return;
      }

      if (event.key === "Escape" && checked.size) {
        event.preventDefault();
        clearSelection();
        return;
      }

      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (key === "x" && current) {
        event.preventDefault();
        check(current.id, false);
        return;
      }

      if (key === "f") {
        event.preventDefault();
        if (selection.length) starSelection(selection, scope !== "starred");
        else if (current) toggleOne(current);
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        if (selection.length) removeSelection(selection);
        else if (current) removeSelection([current.id]);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  const context = { starred: starredSet, sent, tracked, reviewed: seenSet };
  const counts: Record<Scope, number> = {
    unseen: offers.filter((offer) => inScope(offer, "unseen", context)).length,
    all: offers.filter((offer) => inScope(offer, "all", context)).length,
    starred: offers.filter((offer) => inScope(offer, "starred", context))
      .length,
    applied: offers.filter((offer) => inScope(offer, "applied", context))
      .length,
  };

  const allChecked =
    selection.length > 0 && selection.length === visible.length;
  const inStarred = scope === "starred";

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-surface-1 px-3 transition-colors focus-within:border-accent hover:border-border-strong">
            <Search
              size={14}
              strokeWidth={1.75}
              className="shrink-0 text-text-subtle"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filtrer les résultats…"
              aria-label="Filtrer les résultats"
              className="selectable min-w-0 flex-1 bg-transparent text-body-sm outline-none placeholder:text-text-subtle"
            />
          </label>
          <div className="w-44 shrink-0">
            <Select
              label="Regrouper"
              className={cn(
                "h-8 w-full justify-between rounded-md border border-border bg-surface-1 px-3 text-body-sm transition-colors hover:border-border-strong",
                focusRing,
              )}
              value={groupBy}
              options={GROUPS}
              onChange={(value) => setGroupBy(value as GroupBy)}
            />
          </div>
        </div>

        <div
          role="tablist"
          aria-label="Onglets des annonces"
          className="flex gap-1 rounded-md bg-surface-2 p-1"
        >
          {SCOPES.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={scope === tab.id}
              onClick={() => setScope(tab.id)}
              className={cn(
                "flex h-7 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-sm px-2 text-footnote font-medium",
                "transition-colors duration-[80ms] ease-standard",
                focusRing,
                scope === tab.id
                  ? "bg-surface-1 text-text shadow-xs"
                  : "text-text-subtle hover:text-text",
              )}
            >
              {tab.id === "starred" ? (
                <Star
                  size={14}
                  strokeWidth={1.75}
                  className={scope === tab.id ? "text-warning" : ""}
                />
              ) : null}
              {tab.label}
              <span className="tabular-nums text-text-subtle">
                {counts[tab.id]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {visible.length > 0 ? (
        <div
          className={cn(
            "flex h-12 shrink-0 items-center gap-2 border-b border-border px-4",
            selection.length > 0 && "bg-surface-1",
          )}
        >
          <button
            role="checkbox"
            aria-checked={
              allChecked ? true : selection.length ? "mixed" : false
            }
            aria-label={allChecked ? "Tout décocher" : "Tout cocher"}
            onClick={() =>
              allChecked ? clearSelection() : setChecked(new Set(order))
            }
            className={cn(
              "flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-xs border transition-colors",
              focusRing,
              selection.length
                ? "border-transparent bg-accent text-accent-fg"
                : "border-border-strong bg-surface-1 hover:border-accent",
            )}
          >
            {allChecked ? (
              <Check size={14} strokeWidth={2.5} />
            ) : selection.length ? (
              <Minus size={14} strokeWidth={2.5} />
            ) : null}
          </button>

          {selection.length ? (
            <>
              <span className="min-w-0 flex-1 truncate text-body-sm font-medium text-text tabular-nums">
                {selection.length} sélectionnée{selection.length > 1 ? "s" : ""}
              </span>
              {scope !== "applied" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => starSelection(selection, !inStarred)}
                >
                  <Star
                    size={14}
                    strokeWidth={1.75}
                    fill={inStarred ? "none" : "currentColor"}
                  />
                  {inStarred ? "Retirer des favoris" : "Favoris"}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                className="hover:text-danger"
                onClick={() => removeSelection(selection)}
              >
                <Trash2 size={14} strokeWidth={1.75} /> Supprimer
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={clearSelection}
                aria-label="Annuler la sélection"
              >
                <X size={14} strokeWidth={1.75} />
              </Button>
            </>
          ) : (
            <span className="min-w-0 flex-1 truncate text-footnote text-text-subtle">
              Cochez pour trier par lot · Maj + clic pour une plage
            </span>
          )}
        </div>
      ) : null}

      {inStarred && visible.length > 0 ? (
        <div className="border-b border-border px-4 py-3">
          <Button
            size="md"
            variant="primary"
            className="w-full"
            onClick={() =>
              prepareBatch(
                selection.length
                  ? visible.filter((offer) => checked.has(offer.id))
                  : visible,
              )
            }
          >
            <Send size={14} strokeWidth={1.75} />
            {selection.length
              ? `Postuler aux ${selection.length} sélectionnée${selection.length > 1 ? "s" : ""}`
              : `Postuler aux ${visible.length} favori${visible.length > 1 ? "s" : ""}`}
          </Button>
        </div>
      ) : null}

      {undo ? (
        <div className="flex items-center gap-3 border-b border-border bg-surface-1 px-4 py-2 text-footnote text-text-muted">
          <span className="min-w-0 flex-1 truncate">
            {undo.offers.length === 1
              ? `« ${undo.offers[0]?.title} » supprimée`
              : `${undo.offers.length} annonces supprimées`}
          </span>
          <button
            onClick={undoDismiss}
            className={cn(
              "flex shrink-0 cursor-pointer items-center gap-1.5 rounded-sm font-medium text-accent hover:underline",
              focusRing,
            )}
          >
            <Undo2 size={14} strokeWidth={1.75} /> Annuler
            <Kbd>Ctrl Z</Kbd>
          </button>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={<Filter size={20} strokeWidth={1.75} />}
            title={
              offers.length === 0
                ? "Aucune recherche encore"
                : scope === "unseen"
                  ? "Tout est passé en revue"
                  : scope === "starred"
                    ? "Aucun favori en attente"
                    : "Rien ne correspond"
            }
            description={
              offers.length === 0
                ? "Indiquez un ou plusieurs métiers à gauche, choisissez vos villes et vos plateformes, puis lancez la recherche."
                : scope === "unseen"
                  ? "Les annonces déjà ouvertes sont rangées dans « Toutes »."
                  : scope === "starred"
                    ? "Les annonces mises en favori arrivent ici, et en repartent une fois la candidature envoyée."
                    : "Changez de filtre, ou relancez une recherche avec d'autres métiers."
            }
            action={
              offers.length > 0 && scope === "unseen" ? (
                <Button size="md" onClick={() => setScope("all")}>
                  Voir toutes les annonces
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {groups.map(([key, items]) => {
            const folded = collapsed.includes(key);
            const ids = items.map((offer) => offer.id);
            const sectionChecked = ids.every((id) => checked.has(id));
            return (
              <section key={key || "toutes"} className="mb-6 last:mb-0">
                {key ? (
                  <div className="group/section sticky top-0 z-10 -mx-4 mb-2 flex items-center gap-2 bg-bg/95 px-4 py-1 backdrop-blur-sm">
                    <button
                      onClick={() =>
                        setCollapsed((current) =>
                          folded
                            ? current.filter((item) => item !== key)
                            : [...current, key],
                        )
                      }
                      aria-expanded={!folded}
                      className={cn(
                        "flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-sm text-footnote font-medium text-text-muted transition-colors hover:text-text",
                        focusRing,
                      )}
                    >
                      <ChevronRight
                        size={14}
                        strokeWidth={1.75}
                        className={cn(
                          "shrink-0 transition-transform duration-150",
                          !folded && "rotate-90",
                        )}
                      />
                      <span className="truncate">{key}</span>
                      <span className="shrink-0 tabular-nums text-text-subtle">
                        {items.length}
                      </span>
                    </button>
                    <button
                      onClick={() =>
                        setChecked((current) => {
                          const next = new Set(current);
                          for (const id of ids) {
                            if (sectionChecked) next.delete(id);
                            else next.add(id);
                          }
                          return next;
                        })
                      }
                      className={cn(
                        "shrink-0 cursor-pointer rounded-sm px-1 text-caption text-text-subtle transition-[opacity,color] hover:text-text",
                        focusRing,
                        selection.length
                          ? "opacity-100"
                          : "opacity-0 focus-visible:opacity-100 group-hover/section:opacity-100",
                      )}
                    >
                      {sectionChecked
                        ? "Décocher la section"
                        : "Cocher la section"}
                    </button>
                    <button
                      onClick={() => markAllSeen(ids)}
                      className={cn(
                        "shrink-0 cursor-pointer rounded-sm px-1 text-caption text-text-subtle opacity-0 transition-[opacity,color] hover:text-text focus-visible:opacity-100 group-hover/section:opacity-100",
                        focusRing,
                      )}
                    >
                      Tout vu
                    </button>
                  </div>
                ) : null}

                {!folded ? (
                  <ul className="space-y-2">
                    {items.map((offer) => (
                      <OfferCard
                        key={offer.id}
                        offer={offer}
                        selected={offer.id === selectedId}
                        starred={starredSet.has(offer.id)}
                        seen={seenSet.has(offer.id)}
                        applied={sent.has(offer.id)}
                        checked={checked.has(offer.id)}
                        selecting={selection.length > 0}
                        onSelect={() => onSelect(offer)}
                        onCheck={(event: MouseEvent) =>
                          check(offer.id, event.shiftKey)
                        }
                        onStar={() => toggleOne(offer)}
                        onDismiss={() => removeSelection([offer.id])}
                      />
                    ))}
                  </ul>
                ) : null}
              </section>
            );
          })}

          <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 pt-3 text-caption text-text-subtle">
            {lastRunAt ? (
              <span>
                Dernière recherche :{" "}
                {new Date(lastRunAt).toLocaleString("fr-FR")}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> parcourir
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>F</Kbd> favori
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>Suppr</Kbd> supprimer
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>X</Kbd> cocher
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>Maj ↓</Kbd> cocher en avançant
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
