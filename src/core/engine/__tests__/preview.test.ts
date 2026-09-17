import { describe, expect, it } from "vitest";
import { htmlFiles, serverCandidates } from "@/core/preview/detect";
import type { TimelineItem } from "@/core/engine/session.store";

const tool = (id: string, name: string, input: unknown, output?: string, ok = true): TimelineItem => ({
  kind: "tool",
  id,
  tool: name,
  input,
  output,
  ok,
});

describe("détection des aperçus", () => {
  it("retient les URL locales citées et les ports explicites", () => {
    const timeline: TimelineItem[] = [
      tool("1", "run_command", { CommandLine: "python -m http.server 8123" }),
      tool("2", "Bash", { command: "pnpm dev" }, "  ➜  Local:   http://localhost:5174/app"),
      { kind: "assistant", id: "3", text: "Ouvrez http://127.0.0.1:3001 pour voir la page.", done: true },
    ];
    const candidates = serverCandidates(timeline, [1420]);
    expect(candidates.filter((c) => !c.guessed).map((c) => c.url)).toEqual([
      "http://localhost:3001/",
      "http://localhost:5174/app",
      "http://localhost:8123/",
    ]);
    // `pnpm dev` sans port explicite : ports usuels à sonder.
    expect(candidates.some((c) => c.guessed && c.port === 5173)).toBe(true);
  });

  it("ignore les ports exclus et les conversations sans serveur", () => {
    const timeline: TimelineItem[] = [
      tool("1", "Bash", { command: "npx vite --port 1420" }),
      tool("2", "Bash", { command: "git status" }),
    ];
    expect(serverCandidates(timeline, [1420]).filter((c) => !c.guessed)).toEqual([]);
    expect(serverCandidates([tool("3", "Read", { file_path: "a.ts" })])).toEqual([]);
  });

  it("liste les pages HTML écrites par l'agent", () => {
    const timeline: TimelineItem[] = [
      tool("1", "write_to_file", { TargetFile: "C:/site/index.html" }),
      tool("2", "Edit", { file_path: "C:/site/style.css" }),
      tool("3", "Edit", { file_path: "C:/site/about.htm" }, undefined, false),
      tool("4", "Edit", { file_path: "C:/site/index.html" }),
      tool("5", "view_file", { AbsolutePath: "C:/other.html" }),
    ];
    expect(htmlFiles(timeline)).toEqual(["C:/site/index.html"]);
  });
});
