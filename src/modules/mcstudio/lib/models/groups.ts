import type { BlockModel, ModelElement, Vec3 } from "./types";

/**
 * Groupes de cubes d'un modèle de bloc ou d'objet, au format de Blockbench : la clé `groups`
 * du JSON (le jeu l'ignore) liste l'arborescence ; un nombre est l'index d'un cube, un objet
 * un groupe. Un modèle sans `groups` est une simple liste de cubes.
 */

export type OutlinerGroup = {
  name: string;
  origin: Vec3;
  color?: number;
  children: OutlinerNode[];
  [key: string]: unknown;
};
export type OutlinerNode = number | OutlinerGroup;

function isGroup(node: unknown): node is OutlinerGroup {
  return typeof node === "object" && node !== null && Array.isArray((node as OutlinerGroup).children);
}

/** Arborescence du modèle : ses groupes (cubes inconnus écartés, oubliés ajoutés à la fin). */
export function outline(model: BlockModel): OutlinerNode[] {
  const count = model.elements?.length ?? 0;
  const seen = new Set<number>();
  const clean = (nodes: unknown[], depth: number): OutlinerNode[] =>
    nodes.flatMap((node): OutlinerNode[] => {
      if (typeof node === "number") {
        if (!Number.isInteger(node) || node < 0 || node >= count || seen.has(node)) return [];
        seen.add(node);
        return [node];
      }
      if (isGroup(node) && depth < 16) {
        const origin = (Array.isArray(node.origin) && node.origin.length === 3 ? node.origin : [8, 8, 8]) as Vec3;
        return [{ ...node, name: String(node.name ?? "groupe"), origin, children: clean(node.children, depth + 1) }];
      }
      return [];
    });
  const nodes = Array.isArray(model.groups) ? clean(model.groups as unknown[], 0) : [];
  for (let i = 0; i < count; i += 1) if (!seen.has(i)) nodes.push(i);
  return nodes;
}

/** Enregistre l'arborescence ; sans aucun groupe, la clé `groups` disparaît. */
export function setOutline(model: BlockModel, nodes: OutlinerNode[]): void {
  if (nodes.some(isGroup)) model.groups = nodes;
  else delete model.groups;
}

/** Cubes d'un nœud (et de ses sous-groupes). */
export function indicesOf(node: OutlinerNode): number[] {
  return typeof node === "number" ? [node] : node.children.flatMap(indicesOf);
}

/** Groupe désigné par son chemin (`"0"`, `"0/2"` : positions dans l'arborescence). */
export function groupAt(nodes: OutlinerNode[], path: string): OutlinerGroup | null {
  let list = nodes;
  let found: OutlinerNode | undefined;
  for (const part of path.split("/")) {
    found = list[Number(part)];
    if (!isGroup(found)) return null;
    list = found.children;
  }
  return isGroup(found) ? found : null;
}

/** Retire des cubes du modèle et renumérote l'arborescence (groupes vidés supprimés). */
export function removeElements(model: BlockModel, indices: number[]): void {
  const gone = new Set(indices);
  const nodes = outline(model);
  const shift = (index: number) => index - indices.filter((i) => i < index).length;
  const prune = (list: OutlinerNode[]): OutlinerNode[] =>
    list.flatMap((node): OutlinerNode[] => {
      if (typeof node === "number") return gone.has(node) ? [] : [shift(node)];
      const children = prune(node.children);
      return children.length > 0 ? [{ ...node, children }] : [];
    });
  model.elements = (model.elements ?? []).filter((_, i) => !gone.has(i));
  setOutline(model, prune(nodes));
}

/**
 * Ajoute des cubes (déjà placés à la fin de `model.elements`) à l'arborescence : dans un
 * nouveau groupe `group`, dans le groupe `into` (chemin), ou à la racine.
 */
export function placeElements(
  model: BlockModel,
  indices: number[],
  options: { group?: { name: string; origin: Vec3 }; into?: string | null } = {},
): string | null {
  const nodes = outline(model).filter((node) => typeof node !== "number" || !indices.includes(node));
  const strip = (list: OutlinerNode[]): OutlinerNode[] =>
    list.map((node) => (typeof node === "number" ? node : { ...node, children: strip(node.children).filter((c) => typeof c !== "number" || !indices.includes(c)) }));
  const clean = strip(nodes);
  const entry: OutlinerNode[] = options.group ? [{ name: options.group.name, origin: options.group.origin, color: 0, children: indices }] : indices;
  const parent = options.into ? groupAt(clean, options.into) : null;
  let path: string | null = null;
  if (parent) {
    parent.children.push(...entry);
    if (options.group) path = `${options.into}/${parent.children.length - 1}`;
  } else {
    clean.push(...entry);
    if (options.group) path = String(clean.length - 1);
  }
  setOutline(model, clean);
  return path;
}

/** Chemin du groupe qui contient directement le cube `index` ; `null` : racine. */
export function parentOf(nodes: OutlinerNode[], index: number, prefix = ""): string | null {
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]!;
    if (typeof node === "number") continue;
    const path = prefix ? `${prefix}/${i}` : String(i);
    if (node.children.includes(index)) return path;
    const deeper = parentOf(node.children, index, path);
    if (deeper) return deeper;
  }
  return null;
}

/** Renomme un groupe. */
export function renameGroup(model: BlockModel, path: string, name: string): void {
  const nodes = outline(model);
  const group = groupAt(nodes, path);
  if (!group) return;
  group.name = name;
  setOutline(model, nodes);
}

/** Défait un groupe : ses enfants prennent sa place. */
export function ungroup(model: BlockModel, path: string): void {
  const nodes = outline(model);
  const parts = path.split("/");
  const last = Number(parts.pop());
  const list = parts.length > 0 ? groupAt(nodes, parts.join("/"))?.children : nodes;
  const group = list?.[last];
  if (!list || !isGroup(group)) return;
  list.splice(last, 1, ...group.children);
  setOutline(model, nodes);
}

/** Nom libre (`cylindre`, `cylindre_2`…) parmi les groupes du modèle. */
export function freeGroupName(model: BlockModel, base: string): string {
  const names = new Set<string>();
  const visit = (list: OutlinerNode[]) => list.forEach((node) => typeof node !== "number" && (names.add(node.name), visit(node.children)));
  visit(outline(model));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

/**
 * Remplace des cubes par d'autres (morceaux d'un cube creusé…) à leur place dans la liste et
 * dans leur groupe. Renvoie les nouveaux index de chaque cube remplacé.
 */
export function replaceElements(model: BlockModel, replacements: Map<number, ModelElement[]>): Map<number, number[]> {
  const nodes = outline(model);
  const mapping = new Map<number, number[]>();
  const elements: ModelElement[] = [];
  (model.elements ?? []).forEach((element, index) => {
    const next = replacements.get(index) ?? [element];
    mapping.set(index, next.map((_, i) => elements.length + i));
    elements.push(...next);
  });
  const remap = (list: OutlinerNode[]): OutlinerNode[] =>
    list.flatMap((node): OutlinerNode[] => (typeof node === "number" ? (mapping.get(node) ?? []) : [{ ...node, children: remap(node.children) }]));
  model.elements = elements;
  setOutline(model, remap(nodes));
  return mapping;
}
