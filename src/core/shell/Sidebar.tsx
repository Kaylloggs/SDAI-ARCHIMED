import { motion } from "motion/react";
import { cn } from "@/core/lib/cn";
import { CATEGORY_LABELS, modulesByCategory } from "@/core/modules";
import { useEnabledModules } from "@/core/modules/useModules";
import { useUiStore } from "@/core/stores/ui.store";
import { spring } from "@/design-system/motion";

export function Sidebar() {
  const modules = useEnabledModules();
  const { activeModuleId, navigate, sidebarCollapsed } = useUiStore();
  const groups = modulesByCategory(modules);

  return (
    <motion.nav
      aria-label="Navigation principale"
      animate={{ width: sidebarCollapsed ? 56 : 248 }}
      transition={spring.gentle}
      className="flex shrink-0 flex-col gap-4 overflow-hidden border-r border-border bg-bg-subtle py-3"
    >
      {groups.map(([category, items]) => (
        <div key={category} className="flex flex-col gap-0.5 px-3">
          {!sidebarCollapsed && (
            <p className="px-2 pb-1 text-caption font-medium text-text-subtle">
              {CATEGORY_LABELS[category]}
            </p>
          )}
          {items.map((module) => {
            const Icon = module.icon;
            const active = module.id === activeModuleId;
            return (
              <button
                key={module.id}
                onClick={() => navigate(module.id)}
                title={sidebarCollapsed ? module.name : undefined}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-8 items-center gap-2.5 rounded-sm px-2 text-body-sm transition-colors duration-[80ms]",
                  active
                    ? "bg-accent-soft text-text"
                    : "text-text-muted hover:bg-surface-2 hover:text-text",
                )}
              >
                <Icon
                  size={16}
                  strokeWidth={1.75}
                  className={cn("shrink-0", active && "text-accent")}
                />
                {!sidebarCollapsed && <span className="truncate">{module.name}</span>}
              </button>
            );
          })}
        </div>
      ))}
    </motion.nav>
  );
}
