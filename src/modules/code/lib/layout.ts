/**
 * Largeur des colonnes du module Code selon la place disponible (design.md §7.3.bis).
 *
 * L'éditeur garde toujours au moins `EDITOR_MIN`. Les panneaux ouverts (arborescence, aperçu,
 * assistant) partent de la largeur choisie par la personne (mémorisée), rétrécissent d'abord
 * jusqu'à leur minimum, puis, s'il manque encore de la place, les moins récemment ouverts se
 * replient (l'arborescence devient une barre d'icônes de `RAIL` px). Rien ne sort de l'écran,
 * et les largeurs mémorisées ne sont jamais modifiées : elles reviennent quand la place revient.
 */

export type PanelId = "tree" | "preview" | "chat";

export type PanelRequest = {
  /** Ouvert selon la personne. */
  open: boolean;
  /** Largeur choisie (mémorisée). */
  desired: number;
  min: number;
};

export type CodeLayout = Record<PanelId, number | null> & {
  /** Arborescence repliée faute de place : barre d'icônes affichée. */
  treeRail: boolean;
};

export const EDITOR_MIN = 280;
export const RAIL = 40;
export const PANEL_MIN: Record<PanelId, number> = { tree: 180, preview: 280, chat: 300 };

/**
 * `width` : largeur du module (0 tant qu'elle n'est pas mesurée : rien n'est replié).
 * `recent` : panneaux du moins au plus récemment ouvert ; les premiers se replient d'abord.
 */
export function computeLayout(width: number, panels: Record<PanelId, PanelRequest>, recent: PanelId[]): CodeLayout {
  const order = [...recent, ...(["tree", "preview", "chat"] as PanelId[]).filter((id) => !recent.includes(id))];
  let shown = order.filter((id) => panels[id].open);

  const rail = (list: PanelId[]) => (panels.tree.open && !list.includes("tree") ? RAIL : 0);
  const minimum = (list: PanelId[]) => EDITOR_MIN + rail(list) + list.reduce((sum, id) => sum + panels[id].min, 0);

  if (width > 0) {
    while (shown.length > 0 && minimum(shown) > width) shown = shown.slice(1);
  }

  const widths = new Map<PanelId, number>(shown.map((id) => [id, Math.max(panels[id].min, panels[id].desired)]));
  if (width > 0) {
    const budget = width - EDITOR_MIN - rail(shown);
    const total = [...widths.values()].reduce((sum, w) => sum + w, 0);
    const excess = total - budget;
    if (excess > 0) {
      const slack = shown.reduce((sum, id) => sum + ((widths.get(id) ?? 0) - panels[id].min), 0);
      const ratio = slack > 0 ? Math.min(1, excess / slack) : 0;
      for (const id of shown) {
        const current = widths.get(id) ?? panels[id].min;
        widths.set(id, Math.floor(current - (current - panels[id].min) * ratio));
      }
    }
  }

  return {
    tree: widths.get("tree") ?? null,
    preview: widths.get("preview") ?? null,
    chat: widths.get("chat") ?? null,
    treeRail: panels.tree.open && !shown.includes("tree"),
  };
}

/** Met `id` en dernier (le plus récent). */
export function touch(recent: PanelId[], id: PanelId): PanelId[] {
  return [...recent.filter((panel) => panel !== id), id];
}
