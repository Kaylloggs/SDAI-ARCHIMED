import { describe, expect, it } from "vitest";
import { moduleStorageKeys } from "../removal";
import { isModuleEnabled, useModulesStore } from "@/core/stores/modules.store";

describe("suppression d'un module", () => {
  it("ne touche qu'aux réglages du module", () => {
    const keys = ["archimed.planner.view", "planner.x", "archimed.plannerx", "archimed.modules", "mcstudio.textureProvider"];
    expect(moduleStorageKeys("planner", keys)).toEqual(["archimed.planner.view", "planner.x"]);
    expect(moduleStorageKeys("mcstudio", keys)).toEqual(["mcstudio.textureProvider"]);
  });

  it("un module supprimé est désactivé, et revient actif", () => {
    const module = { id: "jobagent", enabledByDefault: true };
    useModulesStore.getState().markRemoved("jobagent");
    let state = useModulesStore.getState();
    expect(state.removed).toEqual(["jobagent"]);
    expect(isModuleEnabled(state.overrides, module)).toBe(false);
    useModulesStore.getState().markRestored("jobagent");
    state = useModulesStore.getState();
    expect(state.removed).toEqual([]);
    expect(isModuleEnabled(state.overrides, module)).toBe(true);
  });
});
