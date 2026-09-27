import { describe, expect, it } from "vitest";
import type { ChatSession } from "@/core/engine/session.store";
import { groupSessions, matchesSearch, sessionState } from "../lib/sessions";
import { joinPath } from "../lib/changes";

const NOW = new Date(2026, 8, 27, 15, 0).getTime();
const HOUR = 60 * 60 * 1000;

function session(id: string, updatedAt: number, extra: Partial<ChatSession> = {}): ChatSession {
  return {
    id,
    title: `Conversation ${id}`,
    cwd: "C:\\Users\\Camille\\Projets\\site",
    updatedAt,
    createdAt: updatedAt,
    status: "idle",
    pendingPromptId: null,
    timeline: [],
    ...extra,
  } as ChatSession;
}

describe("groupSessions", () => {
  it("range par date, les plus récentes d'abord, sans groupe vide", () => {
    const groups = groupSessions(
      [
        session("vieille", NOW - 30 * 24 * HOUR),
        session("matin", NOW - 6 * HOUR),
        session("hier", NOW - 20 * HOUR),
        session("maintenant", NOW - HOUR),
      ],
      NOW,
    );
    expect(groups.map((g) => [g.label, g.sessions.map((s) => s.id)])).toEqual([
      ["Aujourd'hui", ["maintenant", "matin"]],
      ["Hier", ["hier"]],
      ["Plus ancien", ["vieille"]],
    ]);
  });

  it("met la semaine passée dans « 7 derniers jours »", () => {
    const groups = groupSessions([session("mardi", NOW - 4 * 24 * HOUR)], NOW);
    expect(groups[0]?.label).toBe("7 derniers jours");
  });
});

describe("matchesSearch", () => {
  const target = session("a", NOW, {
    title: "Refonte du menu",
    timeline: [{ kind: "user", id: "u", text: "Ajoute un mode sombre" }],
  });

  it("cherche dans le titre, le dossier et les messages, sans casse", () => {
    expect(matchesSearch(target, "MENU")).toBe(true);
    expect(matchesSearch(target, "site")).toBe(true);
    expect(matchesSearch(target, "sombre")).toBe(true);
    expect(matchesSearch(target, "facture")).toBe(false);
    expect(matchesSearch(target, "  ")).toBe(true);
  });
});

describe("sessionState", () => {
  it("signale le travail, l'attente et l'erreur", () => {
    expect(sessionState({ status: "running", pendingPromptId: null })).toBe("working");
    expect(sessionState({ status: "starting", pendingPromptId: null })).toBe("working");
    expect(sessionState({ status: "awaiting", pendingPromptId: "p" })).toBe("waiting");
    expect(sessionState({ status: "error", pendingPromptId: null })).toBe("error");
    expect(sessionState({ status: "idle", pendingPromptId: null })).toBe("idle");
  });
});

describe("joinPath", () => {
  it("garde le séparateur de la racine", () => {
    expect(joinPath("C:\\Projets\\site\\", "src/app.ts")).toBe("C:\\Projets\\site\\src\\app.ts");
    expect(joinPath("/home/camille/site", "src/app.ts")).toBe("/home/camille/site/src/app.ts");
  });
});
