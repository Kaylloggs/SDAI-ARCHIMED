/**
 * Diff ligne à ligne (plus longue sous-suite commune, algorithme de Myers), sans
 * dépendance. Sert aux cartes de permission et à la relecture des modifications d'une IA.
 */

export type DiffLine =
  | { kind: "same"; text: string; before: number; after: number }
  | { kind: "removed"; text: string; before: number }
  | { kind: "added"; text: string; after: number };

export type DiffHunk = {
  /** Première ligne du bloc dans l'ancien et le nouveau texte (à partir de 1). */
  beforeStart: number;
  afterStart: number;
  lines: DiffLine[];
};

export type DiffStats = { added: number; removed: number };

/** Au-delà, on renonce au calcul fin : tout l'ancien est retiré, tout le nouveau ajouté. */
const MAX_EDIT_DISTANCE = 4000;

function splitLines(text: string | null): string[] {
  if (text === null || text === "") return [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  // Retour à la ligne final : pas une ligne vide de plus.
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** Suite des opérations (Myers, O((N+M)·D)) : `same`, `removed`, `added`. */
export function diffLines(before: string | null, after: string | null): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);

  // Préfixe et suffixe communs : le cas courant (petite modification) devient trivial.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const middle = myers(a.slice(start, endA), b.slice(start, endB));
  const out: DiffLine[] = [];
  for (let i = 0; i < start; i++) out.push({ kind: "same", text: a[i]!, before: i + 1, after: i + 1 });
  let ia = start;
  let ib = start;
  for (const op of middle) {
    if (op === "=") {
      out.push({ kind: "same", text: a[ia]!, before: ia + 1, after: ib + 1 });
      ia++;
      ib++;
    } else if (op === "-") {
      out.push({ kind: "removed", text: a[ia]!, before: ia + 1 });
      ia++;
    } else {
      out.push({ kind: "added", text: b[ib]!, after: ib + 1 });
      ib++;
    }
  }
  for (let i = endA; i < a.length; i++) {
    out.push({ kind: "same", text: a[i]!, before: i + 1, after: i + 1 - endA + endB });
  }
  return out;
}

type Op = "=" | "-" | "+";

function myers(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return Array<Op>(m).fill("+");
  if (m === 0) return Array<Op>(n).fill("-");
  const max = Math.min(n + m, MAX_EDIT_DISTANCE);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];

  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)
          ? v[offset + k + 1]!
          : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }
  if (!found) return [...Array<Op>(n).fill("-"), ...Array<Op>(m).fill("+")];

  // Remontée du chemin.
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && vd[offset + k - 1]! < vd[offset + k + 1]!) ? k + 1 : k - 1;
    const prevX = vd[offset + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push("=");
      x--;
      y--;
    }
    if (d > 0) ops.push(x === prevX ? "+" : "-");
    x = prevX;
    y = prevY;
  }
  return ops.reverse();
}

export function diffStats(lines: DiffLine[]): DiffStats {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.kind === "added") added++;
    else if (line.kind === "removed") removed++;
  }
  return { added, removed };
}

/** Blocs de modifications entourés de `context` lignes inchangées (fusionnés s'ils se touchent). */
export function diffHunks(lines: DiffLine[], context = 3): DiffHunk[] {
  // Numéro de ligne, dans l'ancien et le nouveau texte, à chaque position.
  const beforeAt: number[] = [];
  const afterAt: number[] = [];
  let before = 1;
  let after = 1;
  for (const line of lines) {
    beforeAt.push(before);
    afterAt.push(after);
    if (line.kind !== "added") before++;
    if (line.kind !== "removed") after++;
  }

  const hunks: DiffHunk[] = [];
  let previousEnd = 0;
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.kind === "same") {
      i++;
      continue;
    }
    let lastChange = i;
    let j = i;
    while (j < lines.length) {
      if (lines[j]!.kind !== "same") {
        lastChange = j;
        j++;
        continue;
      }
      let k = j;
      while (k < lines.length && lines[k]!.kind === "same") k++;
      // Deux modifications séparées par peu de lignes : un seul bloc.
      if (k < lines.length && k - j <= 2 * context) {
        j = k;
        continue;
      }
      break;
    }
    const from = Math.max(previousEnd, i - context);
    const to = Math.min(lines.length, lastChange + 1 + context);
    hunks.push({ beforeStart: beforeAt[from] ?? 1, afterStart: afterAt[from] ?? 1, lines: lines.slice(from, to) });
    previousEnd = to;
    i = to;
  }
  return hunks;
}
