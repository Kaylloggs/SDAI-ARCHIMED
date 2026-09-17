import { Suspense, createElement, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Slot } from "@/core/modules";
import { useEnabledModules } from "@/core/modules/useModules";
import { useUiStore } from "@/core/stores/ui.store";
import { pageFade } from "@/design-system/motion";
import { CommandPalette } from "./CommandPalette";
import { ModuleErrorBoundary } from "./ModuleErrorBoundary";
import { Sidebar } from "./Sidebar";
import { TitleBar } from "./TitleBar";

/**
 * Cadre de l'application (design.md §2) :
 *   fond ambiant → rail de navigation en verre + [barre de titre, panneau de contenu arrondi].
 */
export function AppShell() {
  const modules = useEnabledModules();
  const { activeModuleId, navigate } = useUiStore();
  const active = modules.find((m) => m.id === activeModuleId) ?? modules[0];

  // Fenêtre affichée seulement une fois le premier rendu prêt (design.md §8).
  useEffect(() => {
    try {
      void getCurrentWindow().show();
    } catch {
      // hors Tauri (preview navigateur) : rien à afficher
    }
  }, []);

  useEffect(() => {
    if (active && active.id !== activeModuleId) navigate(active.id);
  }, [active, activeModuleId, navigate]);

  return (
    <div className="app-backdrop flex h-full gap-2 p-2 text-text">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <TitleBar />

        <main className="content-panel relative min-h-0 flex-1 overflow-hidden rounded-[20px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={active?.id ?? "empty"}
              variants={pageFade}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="h-full overflow-y-auto"
            >
              {active ? (
                <ModuleErrorBoundary moduleId={active.id}>
                  <Suspense
                    fallback={<div className="p-8 text-body-sm text-text-subtle">Chargement…</div>}
                  >
                    {createElement(active.page)}
                  </Suspense>
                </ModuleErrorBoundary>
              ) : (
                <div className="p-8 text-body-sm text-text-subtle">Aucun module actif.</div>
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <CommandPalette />
      {/* Contributions sans interface, actives quel que soit le module affiché. */}
      <Slot name="app.background" />
    </div>
  );
}
