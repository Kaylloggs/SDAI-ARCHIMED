import { describe, expect, it } from "vitest";
import { readySignature } from "../local";
import type { LocalModule } from "../api";

const module = (id: string, ready: boolean, modifiedAt = 1): LocalModule => ({
  id,
  name: id,
  state: "new",
  path: `C:/src/modules/${id}`,
  modifiedAt,
  ready,
  unfinished: false,
});

describe("mise à jour locale", () => {
  it("ne compte que les modules prêts, et change dès que l'un d'eux bouge", () => {
    const first = readySignature([module("meteo", true, 10), module("crm", false)]);
    expect(first).toBe("meteo@10");
    expect(readySignature([module("meteo", true, 11)])).not.toBe(first);
    expect(readySignature([module("b", true), module("a", true)])).toBe("a@1|b@1");
    expect(readySignature([])).toBe("");
  });
});
