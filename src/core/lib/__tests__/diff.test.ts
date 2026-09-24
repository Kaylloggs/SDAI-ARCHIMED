import { describe, expect, it } from "vitest";
import { diffHunks, diffLines, diffStats } from "../diff";

const render = (before: string | null, after: string | null) =>
  diffLines(before, after).map((line) => (line.kind === "same" ? " " : line.kind === "added" ? "+" : "-") + line.text);

describe("diff ligne à ligne", () => {
  it("trouve la plus petite modification", () => {
    expect(render("a\nb\nc\n", "a\nx\nc\n")).toEqual([" a", "-b", "+x", " c"]);
    expect(render("a\nb\nc", "a\nc")).toEqual([" a", "-b", " c"]);
    expect(render("a\nc", "a\nb\nc")).toEqual([" a", "+b", " c"]);
  });

  it("garde l'ordre même quand des lignes se répètent", () => {
    // Le diff naïf par ensemble ne voyait rien : les mêmes lignes, dans un autre ordre.
    expect(diffStats(diffLines("}\n{\n}", "{\n}\n}"))).toEqual({ added: 1, removed: 1 });
    expect(diffStats(diffLines("x\ny\nx\ny", "y\nx\ny\nx"))).toEqual({ added: 1, removed: 1 });
  });

  it("reconstruit exactement les deux textes (200 cas aléatoires)", () => {
    let seed = 42;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const text = () => Array.from({ length: Math.floor(random() * 30) }, () => "abcde"[Math.floor(random() * 5)]).join("\n");
    for (let i = 0; i < 200; i++) {
      const before = text();
      const after = text();
      const lines = diffLines(before, after);
      const rebuiltBefore = lines.filter((l) => l.kind !== "added").map((l) => l.text).join("\n");
      const rebuiltAfter = lines.filter((l) => l.kind !== "removed").map((l) => l.text).join("\n");
      expect(rebuiltBefore).toBe(before);
      expect(rebuiltAfter).toBe(after);
    }
  });

  it("gère fichiers créés, supprimés et fins de ligne Windows", () => {
    expect(render(null, "a\nb")).toEqual(["+a", "+b"]);
    expect(render("a\nb", null)).toEqual(["-a", "-b"]);
    expect(render("a\r\nb\r\n", "a\nb\n")).toEqual([" a", " b"]);
  });

  it("numérote les lignes des deux côtés", () => {
    const lines = diffLines("a\nb\nc", "a\nB\nc\nd");
    expect(lines).toContainEqual({ kind: "removed", text: "b", before: 2 });
    expect(lines).toContainEqual({ kind: "added", text: "B", after: 2 });
    expect(lines).toContainEqual({ kind: "same", text: "c", before: 3, after: 3 });
    expect(lines).toContainEqual({ kind: "added", text: "d", after: 4 });
  });

  it("découpe en blocs avec contexte", () => {
    const before = Array.from({ length: 40 }, (_, i) => `l${i + 1}`).join("\n");
    const after = before.replace("l5", "L5").replace("l7", "L7").replace("l30", "L30");
    const hunks = diffHunks(diffLines(before, after), 2);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]!.beforeStart).toBe(3);
    expect(hunks[0]!.lines.map((l) => l.text)).toEqual(["l3", "l4", "l5", "L5", "l6", "l7", "L7", "l8", "l9"]);
    expect(hunks[1]!.beforeStart).toBe(28);
    expect(diffHunks(diffLines("a", "a"))).toEqual([]);
  });
});
