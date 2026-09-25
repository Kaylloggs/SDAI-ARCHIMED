/** Arbre des versions : placement en lignes et colonnes, parcours parent / enfant. */

type Versioned = { id: string; parent: string | null };

export type TreeCell = { id: string; col: number; row: number; parent: string | null };

/**
 * Place l'arbre comme un graphe de branches : la profondeur donne la colonne, le premier
 * enfant reste sur la ligne de son parent, chaque autre enfant ouvre une nouvelle ligne.
 * Les versions sont prises dans l'ordre de création.
 */
export function layoutTree<T extends Versioned>(nodes: T[]): { cells: TreeCell[]; rows: number; cols: number } {
  const known = new Set(nodes.map((n) => n.id));
  const children = new Map<string | null, T[]>();
  for (const node of nodes) {
    // Parent disparu : la version devient une racine.
    const parent = node.parent && known.has(node.parent) ? node.parent : null;
    const list = children.get(parent) ?? [];
    list.push(node);
    children.set(parent, list);
  }
  const cells: TreeCell[] = [];
  let nextRow = 0;
  let cols = 0;
  const place = (node: T, col: number, row: number) => {
    cells.push({ id: node.id, col, row, parent: node.parent && known.has(node.parent) ? node.parent : null });
    cols = Math.max(cols, col + 1);
    const kids = children.get(node.id) ?? [];
    kids.forEach((child, index) => {
      const childRow = index === 0 ? row : nextRow++;
      place(child, col + 1, childRow);
    });
  };
  for (const root of children.get(null) ?? []) place(root, 0, nextRow++);
  return { cells, rows: nextRow, cols };
}

export function parentOf<T extends Versioned>(nodes: T[], id: string | null): T | undefined {
  const node = nodes.find((n) => n.id === id);
  return node?.parent ? nodes.find((n) => n.id === node.parent) : undefined;
}

/** Enfant le plus récent : « rétablir » après être revenu au parent. */
export function latestChild<T extends Versioned>(nodes: T[], id: string | null): T | undefined {
  return nodes.filter((n) => n.parent === id && id !== null).at(-1);
}

/** Chemin de la racine jusqu'à la version (incluse). */
export function lineage<T extends Versioned>(nodes: T[], id: string | null): T[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const path: T[] = [];
  let current = id ? byId.get(id) : undefined;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parent ? byId.get(current.parent) : undefined;
  }
  return path;
}
