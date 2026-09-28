import { describe, expect, it } from "vitest";
import type { TimelineItem } from "@/core/engine/session.store";
import { editedFiles, projectFolder } from "../lib/workspace";

const tool = (id: string, name: string, input: unknown, ok?: boolean): TimelineItem => ({ kind: "tool", id, tool: name, input, ok });
const user = (id: string): TimelineItem => ({ kind: "user", id, text: "…" });

describe("dossier de travail de l'agent", () => {
  it("garde les fichiers écrits au dernier tour qui a écrit", () => {
    const timeline: TimelineItem[] = [
      user("u1"),
      tool("t1", "Write", { file_path: "C:\\Users\\A\\ancien\\a.txt" }),
      user("u2"),
      tool("t2", "Read", { file_path: "C:\\Users\\A\\x.md" }),
      tool("t3", "Write", { file_path: "C:\\Users\\A\\portfolio\\index.html" }),
      tool("t4", "Edit", { file_path: "C:\\Users\\A\\portfolio\\css\\style.css" }),
      tool("t5", "Write", { file_path: "C:\\Users\\A\\portfolio\\raté.js" }, false),
      user("u3"),
      tool("t6", "WebSearch", { query: "météo" }),
    ];
    expect(editedFiles(timeline)).toEqual(["C:\\Users\\A\\portfolio\\index.html", "C:\\Users\\A\\portfolio\\css\\style.css"]);
  });

  it("remonte au dossier du projet créé sous le dossier de travail", () => {
    const cwd = "C:\\Users\\A\\Documents";
    expect(projectFolder(["C:\\Users\\A\\Documents\\site\\src\\a.ts", "C:\\Users\\A\\Documents\\site\\src\\b.ts"], cwd)).toBe("C:\\Users\\A\\Documents\\site");
    // Casse différente (Windows) : même dossier.
    expect(projectFolder(["c:\\users\\a\\documents\\site\\index.html"], cwd)).toBe("c:\\users\\a\\documents\\site");
    expect(projectFolder(["D:\\jeux\\mod\\build.gradle", "D:\\jeux\\mod\\src\\Main.java"], cwd)).toBe("D:\\jeux\\mod");
    expect(projectFolder(["/home/a/app/main.py"], "/home/a")).toBe("/home/a/app");
    expect(projectFolder(["notes/todo.md"], "/home/a")).toBe("/home/a/notes");
    expect(projectFolder([], cwd)).toBeNull();
  });
});
