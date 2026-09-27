import { describe, expect, it } from "vitest";
import { resolveConflicts, ruleFor } from "./merge-conflicts.mjs";

const conflict = (ours, theirs) => ["<<<<<<< HEAD", ...ours, "=======", ...theirs, ">>>>>>> v0.9.0"].join("\n");

describe("fusion de la version officielle", () => {
  it("prend le numéro de version officiel et garde le reste du fichier", () => {
    const text = ["{", '  "name": "sdai-archimed",', conflict(['  "version": "0.8.1",'], ['  "version": "0.9.0",']), '  "dependencies": { "mon-paquet": "1.0.0" }', "}"].join("\n");
    const { text: out, unresolved } = resolveConflicts(text, ruleFor("package.json"));
    expect(unresolved).toBe(0);
    expect(out).toContain('"version": "0.9.0"');
    expect(out).toContain("mon-paquet");
    expect(out).not.toContain("<<<<<<<");
  });

  it("laisse à la personne un conflit qui touche autre chose que la version", () => {
    const text = conflict(['version = "0.8.1"', 'mon-crate = "1"'], ['version = "0.9.0"']);
    expect(resolveConflicts(text, ruleFor("src-tauri/Cargo.toml")).unresolved).toBe(1);
    expect(ruleFor("src/core/shell/TitleBar.tsx")).toBeNull();
    expect(ruleFor("src/modules/meteo/index.tsx")).toBeNull();
  });

  it("gère le style diff3, les fins de ligne Windows et le journal officiel", () => {
    const diff3 = ["<<<<<<< HEAD", '  "version": "0.8.1",', "||||||| base", '  "version": "0.8.0",', "=======", '  "version": "0.9.0",', ">>>>>>> v0.9.0"].join("\r\n");
    const { text, unresolved } = resolveConflicts(diff3, ruleFor("src-tauri/tauri.conf.json"));
    expect(unresolved).toBe(0);
    expect(text).toBe('  "version": "0.9.0",');
    const changelog = conflict(["## [0.8.1] - 2026-09-30"], ["## [0.9.0] - 2026-10-02"]);
    expect(resolveConflicts(changelog, ruleFor("CHANGELOG.md")).text).toBe("## [0.9.0] - 2026-10-02");
  });
});
