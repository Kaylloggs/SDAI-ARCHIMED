import { describe, expect, it, vi } from "vitest";
import { catalogOf, loadCommands, searchCommands } from "../commands";
import { allModules, manifestIssues } from "../registry";

const TYPES = ["string", "number", "boolean", "object", "array"];

/**
 * Base de commandes réelle de l'application : chaque module en a une, bien formée, que la
 * recherche retrouve à partir de ce que la personne dirait.
 */
describe("base de commandes de tous les modules", () => {
  it("se charge sans erreur, avec des commandes propres à chaque module", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const entries = await loadCommands([...allModules]);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
    expect(manifestIssues).toEqual([]);
    expect(entries.length).toBe(allModules.length);

    for (const { module, actions } of entries) {
      const own = actions.filter((a) => a.name !== "open" && !a.name.startsWith("ui_"));
      expect(own.length, `${module.id} : aucune commande propre`).toBeGreaterThan(0);
      const names = actions.map((a) => a.name);
      expect(new Set(names).size, `${module.id} : noms en double`).toBe(names.length);
      for (const action of actions) {
        const where = `${module.id}.${action.name}`;
        expect(action.name, where).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(action.description.trim().length, where).toBeGreaterThan(10);
        expect(["read", "write", "destructive"], where).toContain(action.risk);
        for (const [param, spec] of Object.entries(action.params ?? {})) {
          expect(TYPES, `${where}.${param}`).toContain(spec.type);
          if (spec.enum) expect(spec.enum.length, `${where}.${param}`).toBeGreaterThan(0);
        }
      }
      // La copie sur le disque ne contient que des données.
      expect(() => JSON.stringify(catalogOf({ module, actions }))).not.toThrow();
    }
  });

  it("retrouve la bonne commande à partir d'une demande parlée", async () => {
    const entries = await loadCommands([...allModules]);
    const first = (query: string, module?: string) => {
      const [match] = searchCommands(entries, { query, module });
      return match ? `${match.module.id}.${match.action.name}` : null;
    };
    expect(first("modifier une carte", "planner")).toBe("planner.update_card");
    expect(first("déplacer une carte dans une autre colonne")).toBe("planner.move_card");
    expect(first("créer un tableau")).toBe("planner.create_board");
    expect(first("générer une image")).toBe("image-maker.generate_image");
    expect(first("compiler le mod")).toBe("mcstudio.build_project");
    expect(first("changer le thème")).toBe("settings.set_theme");
    expect(first("désactiver un module")).toBe("settings.set_module_enabled");
    expect(first("retenir une information")).toBe("memory.remember");
    expect(first("envoyer un message à l'agent", "chat")).toBe("chat.send_message");
    expect(first("lancer le jeu")).toBe("mcstudio.run_game");
    expect(first("rename board")).toBe("planner.rename_board");
    expect(first("retourner l'image")).toBe("image-maker.transform_image");
    expect(first("vérifier les mises à jour")).toBe("settings.check_updates");
    expect(first("lance npm run dev")).toBe("code.run_in_terminal");
    expect(first("explique comment marche le planner")).toBe("tutorial.explain");
    expect(first("nouvelle conversation avec codex")).toBe("chat.new_conversation");
  });
});
