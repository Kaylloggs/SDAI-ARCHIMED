import { describe, expect, it } from "vitest";
import { computeLayout, EDITOR_MIN, PANEL_MIN, RAIL, touch, type PanelId, type PanelRequest } from "../lib/layout";

const panels = (overrides: Partial<Record<PanelId, Partial<PanelRequest>>> = {}): Record<PanelId, PanelRequest> => ({
  tree: { open: true, desired: 240, min: PANEL_MIN.tree, ...overrides.tree },
  preview: { open: false, desired: 520, min: PANEL_MIN.preview, ...overrides.preview },
  chat: { open: true, desired: 380, min: PANEL_MIN.chat, ...overrides.chat },
});
const RECENT: PanelId[] = ["tree", "preview", "chat"];
const used = (layout: ReturnType<typeof computeLayout>) =>
  (layout.tree ?? 0) + (layout.preview ?? 0) + (layout.chat ?? 0) + (layout.treeRail ? RAIL : 0);

describe("mise en page du module Code", () => {
  it("garde les largeurs choisies quand la place suffit (2560 px)", () => {
    const layout = computeLayout(2300, panels({ preview: { open: true } }), RECENT);
    expect(layout).toEqual({ tree: 240, preview: 520, chat: 380, treeRail: false });
  });

  it("rétrécit d'abord les panneaux jusqu'à leur minimum", () => {
    const layout = computeLayout(800, panels(), RECENT);
    expect(layout.tree).not.toBeNull();
    expect(layout.chat).not.toBeNull();
    expect(layout.tree!).toBeGreaterThanOrEqual(PANEL_MIN.tree);
    expect(layout.chat!).toBeGreaterThanOrEqual(PANEL_MIN.chat);
    expect(used(layout) + EDITOR_MIN).toBeLessThanOrEqual(800);
  });

  it("à 960 × 640 (module de 700 px), replie l'arborescence en barre et garde l'assistant", () => {
    const layout = computeLayout(700, panels(), RECENT);
    expect(layout.treeRail).toBe(true);
    expect(layout.tree).toBeNull();
    expect(layout.chat).toBe(380);
    expect(used(layout) + EDITOR_MIN).toBeLessThanOrEqual(700);
  });

  it("replie le panneau ouvert le moins récemment", () => {
    // Arborescence rouverte à l'instant : c'est l'assistant qui cède.
    const layout = computeLayout(700, panels(), touch(RECENT, "tree"));
    expect(layout.chat).toBeNull();
    expect(layout.tree).toBe(240);
    // Aperçu ouvert en dernier : arborescence et assistant cèdent.
    const withPreview = computeLayout(700, panels({ preview: { open: true } }), touch(RECENT, "preview"));
    expect(withPreview.preview).not.toBeNull();
    expect(used(withPreview) + EDITOR_MIN).toBeLessThanOrEqual(700);
  });

  it("des largeurs mémorisées démesurées ne poussent rien hors de l'écran", () => {
    const layout = computeLayout(1200, panels({ tree: { desired: 480 }, chat: { desired: 760 } }), RECENT);
    expect(used(layout) + EDITOR_MIN).toBeLessThanOrEqual(1200);
    expect(layout.tree).not.toBeNull();
    expect(layout.chat).not.toBeNull();
  });

  it("ne replie rien tant que la largeur n'est pas mesurée", () => {
    expect(computeLayout(0, panels(), RECENT)).toEqual({ tree: 240, preview: null, chat: 380, treeRail: false });
  });
});
