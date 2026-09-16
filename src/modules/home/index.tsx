import { motion } from "motion/react";
import { cn } from "@/core/lib/cn";
import { Slot } from "@/core/modules";
import { useEnabledModules } from "@/core/modules/useModules";
import { useUiStore } from "@/core/stores/ui.store";
import { duration, ease } from "@/design-system/motion";

const sizeClass = { sm: "col-span-3", md: "col-span-4", lg: "col-span-6" } as const;

/** Launchpad : une tuile par module, générée depuis le registre. */
export default function HomeModule() {
  const modules = useEnabledModules();
  const navigate = useUiStore((s) => s.navigate);
  const tiles = modules.filter((m) => m.launchpad !== false && m.id !== "home");

  return (
    <div className="mx-auto max-w-[1100px] px-8 py-10">
      <header className="pb-8">
        <h1 className="text-display font-semibold tracking-[-0.02em]">Bonjour.</h1>
        <p className="pt-1 text-body text-text-muted">
          Choisissez un bloc, ou appuyez sur Ctrl K.
        </p>
      </header>

      <div className="grid grid-cols-12 gap-4">
        {tiles.map((module, index) => {
          const Icon = module.icon;
          const config = module.launchpad === false ? undefined : module.launchpad;
          const size: keyof typeof sizeClass = config?.size ?? "md";
          const accent = config?.accent ?? false;
          return (
            <motion.button
              key={module.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: duration.base, ease: ease.emphasized, delay: index * 0.03 }}
              onClick={() => navigate(module.id)}
              className={cn(
                "group flex flex-col gap-2 rounded-lg border border-border bg-surface-1 p-4 text-left transition-colors duration-[80ms]",
                "hover:border-border-strong hover:bg-surface-2",
                accent && "border-accent/30",
                sizeClass[size],
              )}
            >
              <Icon
                size={20}
                strokeWidth={1.75}
                className={cn("text-text-muted transition-colors", accent && "text-accent", "group-hover:text-text")}
              />
              <span className="text-title-3 font-semibold">{module.name}</span>
              <span className="line-clamp-2 text-footnote text-text-subtle">
                {module.description}
              </span>
            </motion.button>
          );
        })}
      </div>

      <div className="grid grid-cols-12 gap-4 pt-4">
        <Slot name="launchpad.widgets" />
      </div>
    </div>
  );
}
