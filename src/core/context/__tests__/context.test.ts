import { describe, expect, it } from "vitest";
import { useUiStore } from "@/core/stores/ui.store";
import { currentContext, setModuleContext } from "..";

describe("contexte partagé", () => {
  it("publie, remplace et retire le contexte d'un module", () => {
    useUiStore.setState({ activeModuleId: "code" });
    setModuleContext("code", { project: { name: "boutique", path: "C:/p" }, file: "a.ts" });
    setModuleContext("planner", { object: { type: "tableau", name: "Roadmap" } });
    expect(currentContext()).toEqual({
      activeModule: "code",
      modules: {
        code: { project: { name: "boutique", path: "C:/p" }, file: "a.ts" },
        planner: { object: { type: "tableau", name: "Roadmap" } },
      },
    });
    setModuleContext("code", { file: "b.ts" });
    expect(currentContext().modules.code).toEqual({ file: "b.ts" });
    setModuleContext("code", null);
    expect("code" in currentContext().modules).toBe(false);
  });
});
