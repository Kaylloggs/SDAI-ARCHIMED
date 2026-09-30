/**
 * Disposition en couches du graphe des systèmes : chaque système est placé à droite de ses
 * dépendances (couche = 1 + couche la plus haute de ses dépendances). Dans une couche, les
 * systèmes sont triés par position moyenne de leurs dépendances pour limiter les croisements.
 * Fonction pure, sans DOM.
 */
export type LayoutInput = { id: string; dependencies: string[]; group?: string };

export type LayoutNode = { id: string; layer: number; row: number; x: number; y: number };
export type LayoutEdge = { from: string; to: string };
export type Layout = { nodes: LayoutNode[]; edges: LayoutEdge[]; width: number; height: number };

export const NODE_W = 176;
export const NODE_H = 36;
const GAP_X = 72;
const GAP_Y = 12;
const PAD = 16;

export function layoutGraph(items: LayoutInput[]): Layout {
  const ids = new Set(items.map((i) => i.id));
  const deps = new Map(items.map((i) => [i.id, i.dependencies.filter((d) => ids.has(d) && d !== i.id)]));
  const layer = new Map<string, number>();

  const visiting = new Set<string>();
  const place = (id: string): number => {
    const known = layer.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0; // cycle : ne devrait pas arriver (refusé par le backend)
    visiting.add(id);
    const own = (deps.get(id) ?? []).reduce((max, d) => Math.max(max, place(d) + 1), 0);
    visiting.delete(id);
    layer.set(id, own);
    return own;
  };
  items.forEach((i) => place(i.id));

  const layers: string[][] = [];
  for (const item of items) {
    const l = layer.get(item.id) ?? 0;
    (layers[l] ??= []).push(item.id);
  }
  const group = new Map(items.map((i) => [i.id, i.group ?? ""]));
  const row = new Map<string, number>();
  layers.forEach((ids, l) => {
    if (l === 0) {
      ids.sort((a, b) => (group.get(a) ?? "").localeCompare(group.get(b) ?? "") || a.localeCompare(b));
    } else {
      const center = (id: string) => {
        const ds = deps.get(id) ?? [];
        return ds.length ? ds.reduce((sum, d) => sum + (row.get(d) ?? 0), 0) / ds.length : Number.MAX_SAFE_INTEGER;
      };
      ids.sort((a, b) => center(a) - center(b) || a.localeCompare(b));
    }
    ids.forEach((id, index) => row.set(id, index));
  });

  const nodes: LayoutNode[] = items.map((item) => {
    const l = layer.get(item.id) ?? 0;
    const r = row.get(item.id) ?? 0;
    return { id: item.id, layer: l, row: r, x: PAD + l * (NODE_W + GAP_X), y: PAD + r * (NODE_H + GAP_Y) };
  });
  const edges: LayoutEdge[] = items.flatMap((item) => (deps.get(item.id) ?? []).map((d) => ({ from: d, to: item.id })));
  const tallest = Math.max(0, ...layers.map((ids) => ids.length));
  return {
    nodes,
    edges,
    width: PAD * 2 + Math.max(1, layers.length) * (NODE_W + GAP_X) - GAP_X,
    height: PAD * 2 + Math.max(1, tallest) * (NODE_H + GAP_Y) - GAP_Y,
  };
}

/** Voisinage d'un système : lui, ses dépendances et ce qui l'utilise (directs et indirects). */
export function neighbourhood(items: LayoutInput[], id: string): Set<string> {
  const out = new Set<string>([id]);
  const byId = new Map(items.map((i) => [i.id, i]));
  const up = [id];
  while (up.length) {
    const current = byId.get(up.pop()!);
    for (const d of current?.dependencies ?? []) {
      if (!out.has(d) && byId.has(d)) {
        out.add(d);
        up.push(d);
      }
    }
  }
  const down = [id];
  while (down.length) {
    const target = down.pop()!;
    for (const item of items) {
      if (item.dependencies.includes(target) && !out.has(item.id)) {
        out.add(item.id);
        down.push(item.id);
      }
    }
  }
  return out;
}
