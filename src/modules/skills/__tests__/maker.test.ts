import { describe, expect, it } from "vitest";
import {
  briefMessage,
  feedbackMessage,
  fixMessage,
  makerInstructions,
  mergeTests,
  nextTestId,
  parseTests,
  serializeTests,
  testInstructions,
  testsRequestMessage,
  transcriptMarkdown,
  type SkillTest,
} from "../lib/maker";
import { draftOfSession } from "../components/maker/origin";
import type { DraftInfo } from "../api";

describe("atelier de skills", () => {
  it("donne à l'IA l'organisation du brouillon et les règles du format", () => {
    const text = makerInstructions({ kind: "new", sourceId: null }, "fr");
    for (const expected of ["skill/SKILL.md", "tests.json", "64 caractères", "1024 caractères", "500 lignes", "français"]) {
      expect(text).toContain(expected);
    }
    expect(text).not.toContain("Amélioration d'un skill existant");
    const editing = makerInstructions({ kind: "edit", sourceId: "rapport-hebdo" }, "en");
    expect(editing).toContain("« rapport-hebdo » a été copié dans skill/");
    expect(editing).toContain("Écris le skill en anglais");
  });

  it("compose le premier message à partir du formulaire", () => {
    const message = briefMessage({ what: " Résumer une réunion ", when: "après un appel", output: "", language: "fr" }, ["C:/a.txt"]);
    expect(message).toContain("Ce qu'il doit faire : Résumer une réunion");
    expect(message).toContain("Quand s'en servir : après un appel");
    expect(message).not.toContain("Résultat attendu");
    expect(message).toContain("1 fichier(s)");
  });

  it("transforme une conversation en Markdown lisible", () => {
    const markdown = transcriptMarkdown({
      title: "Facture Dupont",
      adapter: "claude",
      model: "opus",
      cwd: "C:/Factures",
      timeline: [
        { kind: "user", id: "1", text: "Fais la facture", attachments: ["C:/devis.pdf"] },
        { kind: "tool", id: "2", tool: "Write", input: { file_path: "facture.md" }, ok: true },
        { kind: "assistant", id: "3", text: "Voilà la facture.", done: true },
        { kind: "system", id: "4", text: "ignoré" },
      ],
    });
    expect(markdown).toContain("# Conversation : Facture Dupont");
    expect(markdown).toContain("## Personne\n\nFais la facture");
    expect(markdown).toContain("C:/devis.pdf");
    expect(markdown).toContain('> Outil Write : {"file_path":"facture.md"}');
    expect(markdown).toContain("## IA\n\nVoilà la facture.");
    expect(markdown).not.toContain("ignoré");
  });

  it("lit tests.json, même incomplet ou au format skill-creator", () => {
    expect(parseTests(null)).toEqual([]);
    expect(parseTests("pas du json")).toEqual([]);
    const tests = parseTests(
      JSON.stringify({ evals: [], tests: [{ id: 1, prompt: "Fais X", expected_output: "un fichier" }, { prompt: "" }, "Fais Y"] }),
    );
    expect(tests.map((t) => [t.id, t.prompt, t.expect])).toEqual([
      ["1", "Fais X", "un fichier"],
      ["t3", "Fais Y", ""],
    ]);
    expect(parseTests(serializeTests(tests))).toEqual(tests);
    expect(nextTestId(tests)).toBe("t4");
  });

  it("rédige les retours et les corrections", () => {
    const tests: SkillTest[] = [
      { id: "t1", prompt: "Fais X", expect: "", verdict: "good", note: "", sessionId: null },
      { id: "t2", prompt: "Fais Y", expect: "", verdict: "bad", note: "le tableau manque", sessionId: null },
      { id: "t3", prompt: "Fais Z", expect: "", verdict: null, note: "", sessionId: null },
    ];
    const feedback = feedbackMessage(tests)!;
    expect(feedback).toContain("« Fais X » : réussi");
    expect(feedback).toContain("« Fais Y » : à revoir : le tableau manque");
    expect(feedback).not.toContain("Fais Z");
    expect(feedbackMessage([tests[2]!])).toBeNull();

    const fix = fixMessage([
      { level: "error", code: "link_missing", message: "cite x", file: "SKILL.md", line: 12 },
      { level: "info", code: "scripts_present", message: "scripts", file: null, line: null },
    ]);
    expect(fix).toContain("- Erreur (SKILL.md, ligne 12) : cite x");
    expect(fix).not.toContain("scripts");
    expect(testInstructions("C:\\skills\\d1\\skill")).toContain("C:\\skills\\d1\\skill\\SKILL.md");
  });

  it("garde les avis quand l'IA réécrit tests.json, sauf si la demande a changé", () => {
    const local: SkillTest[] = [
      { id: "t1", prompt: "A", expect: "", verdict: "good", note: "bien", sessionId: "s1" },
      { id: "t2", prompt: "B", expect: "", verdict: "bad", note: "", sessionId: "s2" },
    ];
    const merged = mergeTests(parseTests('[{"id":"t1","prompt":"A","expect":"x"},{"id":"t2","prompt":"B modifié"}]'), local);
    expect(merged[0]).toMatchObject({ expect: "x", verdict: "good", note: "bien", sessionId: "s1" });
    expect(merged[1]).toMatchObject({ prompt: "B modifié", verdict: null, sessionId: null });
    expect(testsRequestMessage()).toContain("tests.json");
  });

  it("retrouve le brouillon d'une conversation d'atelier ou d'essai", () => {
    const draft = { id: "d1", path: "C:\\Users\\a\\drafts\\d1" } as DraftInfo;
    const other = { id: "d10", path: "C:\\Users\\a\\drafts\\d10" } as DraftInfo;
    expect(draftOfSession([draft, other], "c:/users/a/drafts/d1")?.id).toBe("d1");
    expect(draftOfSession([draft, other], "C:\\Users\\a\\drafts\\d1\\runs\\2")?.id).toBe("d1");
    expect(draftOfSession([draft, other], "C:\\Users\\a\\drafts\\d10")?.id).toBe("d10");
    expect(draftOfSession([draft], "C:\\Users\\a\\drafts\\d100")).toBeNull();
    expect(draftOfSession([draft], null)).toBeNull();
  });
});
