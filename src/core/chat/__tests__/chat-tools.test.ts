import { describe, expect, it } from "vitest";
import type { ChatSession, TimelineItem } from "@/core/engine/session.store";
import { latestTodos, todoProgress } from "../todos";
import { APP_COMMANDS, cliCommands, filterCommands, slashQuery } from "../slash";
import { fuzzyScore, insertMention, mentionAt, searchFiles } from "../mentions";
import { contextPercent, conversationMarkdown } from "../transcript";

const tool = (id: string, name: string, input: unknown): TimelineItem => ({ kind: "tool", id, tool: name, input, ok: true, output: "" });

describe("chat : tâches, commandes, mentions, export", () => {
  it("lit la dernière liste de tâches de l'agent", () => {
    const timeline = [
      tool("1", "TodoWrite", { todos: [{ content: "Lire", status: "pending", activeForm: "Lecture" }] }),
      tool("2", "Read", { file_path: "a" }),
      tool("3", "TodoWrite", {
        todos: [
          { content: "Lire", status: "completed", activeForm: "Lecture" },
          { content: "Corriger", status: "in_progress", activeForm: "Correction" },
          { content: "Tester", status: "bizarre" },
          { content: "" },
        ],
      }),
    ];
    const todos = latestTodos(timeline);
    expect(todos.map((t) => t.status)).toEqual(["completed", "in_progress", "pending"]);
    expect(todos[2]!.activeForm).toBe("Tester");
    expect(todoProgress(todos)).toMatchObject({ done: 1, total: 3, current: { content: "Corriger" } });
    expect(latestTodos([tool("1", "Read", {})])).toEqual([]);
  });

  it("propose les commandes / d'ARCHIMED et de la CLI", () => {
    expect(slashQuery("/pl")).toBe("pl");
    expect(slashQuery("/")).toBe("");
    expect(slashQuery("/plan maintenant")).toBeNull();
    expect(slashQuery("bonjour /plan")).toBeNull();
    const all = [...APP_COMMANDS, ...cliCommands(["compact", "/review", "plan", "compact", "mon-skill"])];
    expect(all.filter((c) => c.kind === "cli").map((c) => c.name)).toEqual(["compact", "review", "mon-skill"]);
    expect(filterCommands(all, "co").map((c) => c.name)).toEqual(["copier", "compact"]);
    expect(filterCommands(all, "skill")[0]!.name).toBe("mon-skill");
  });

  it("trouve un fichier à mentionner et l'insère", () => {
    expect(mentionAt("regarde @src/ap", 15)).toEqual({ query: "src/ap", start: 8, end: 15 });
    expect(mentionAt("mail@exemple", 12)).toBeNull();
    const files = ["src/app.ts", "src/core/api.ts", "README.md", "src/modules/chat/index.tsx"];
    expect(searchFiles(files, "app")[0]).toBe("src/app.ts");
    expect(searchFiles(files, "chidx")).toEqual(["src/modules/chat/index.tsx"]);
    expect(fuzzyScore("README.md", "zz")).toBe(-1);
    const token = mentionAt("vois @ap merci", 8)!;
    expect(insertMention("vois @ap merci", token, "src/app.ts")).toEqual({ text: "vois @src/app.ts  merci", caret: 17 });
  });

  it("exporte la conversation en Markdown et calcule la jauge de contexte", () => {
    const session = {
      title: "Mode sombre",
      adapter: "claude",
      model: "claude-opus-5-5",
      cwd: "C:/site",
      timeline: [
        { kind: "user", id: "u", text: "Ajoute un mode sombre" },
        tool("t1", "Write", { file_path: "theme.css" }),
        tool("t2", "Bash", { command: "pnpm test" }),
        { kind: "assistant", id: "a", text: "C'est fait.", done: true },
      ],
    } as Pick<ChatSession, "title" | "adapter" | "model" | "cwd" | "timeline">;
    const md = conversationMarkdown(session, "Claude Code");
    expect(md).toContain("# Mode sombre");
    expect(md).toContain("## Vous\n\nAjoute un mode sombre");
    expect(md).toContain("> 1 fichier créé · 1 commande exécutée");
    expect(md).toContain("## Claude Code\n\nC'est fait.");
    expect(contextPercent({ used: 250_000, window: 1_000_000 })).toBe(25);
    expect(contextPercent({ used: 5, window: null })).toBeNull();
    expect(contextPercent(undefined)).toBeNull();
  });
});
