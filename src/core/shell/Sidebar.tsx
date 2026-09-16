import { Fragment } from "react";
import { motion } from "motion/react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { CATEGORY_LABELS, modulesByCategory } from "@/core/modules";
import { useEnabledModules } from "@/core/modules/useModules";
import type { LoadedModule } from "@/core/modules/types";
import { useUiStore } from "@/core/stores/ui.store";
import { ArchimedLogo } from "@/design-system/brand/ArchimedLogo";
import { Tooltip } from "@/design-system/primitives";
import { spring } from "@/design-system/motion";

const RAIL = 64;
const EXPANDED = 228;

function RailItem({
  module,
  active,
  expanded,
  onSelect,
}: {
  module: LoadedModule;
  active: boolean;
  expanded: boolean;
  onSelect: () => void;
}) {
  const Icon = module.icon;
  return (
    <Tooltip label={module.name} disabled={expanded}>
      <button
        onClick={onSelect}
        aria-label={module.name}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative flex h-10 shrink-0 items-center gap-3 rounded-[12px] transition-colors duration-[80ms]",
          expanded ? "w-full px-3" : "w-10 justify-center",
          active
            ? "bg-[color-mix(in_oklab,var(--color-text)_12%,transparent)] text-text shadow-[inset_0_1px_0_color-mix(in_oklab,white_10%,transparent)]"
            : "text-text-muted hover:bg-[color-mix(in_oklab,var(--color-text)_7%,transparent)] hover:text-text",
        )}
      >
        {active && (
          <motion.span
            layoutId="rail-active"
            transition={spring.snappy}
            className="absolute -left-3 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-accent"
          />
        )}
        <Icon size={18} strokeWidth={1.75} className={cn("shrink-0", active && "text-accent")} />
        {expanded && <span className="truncate text-body-sm">{module.name}</span>}
      </button>
    </Tooltip>
  );
}

/**
 * Rail de navigation flottant en verre (design.md §7.1).
 * Replié : icônes groupées par catégorie, séparées par un filet. Déployé : libellés.
 * Les modules de la catégorie « Réglages » sont épinglés en bas.
 */
export function Sidebar() {
  const modules = useEnabledModules();
  const { activeModuleId, navigate, sidebarCollapsed, setSidebarCollapsed } = useUiStore();
  const expanded = !sidebarCollapsed;
  const groups = modulesByCategory(modules);
  const main = groups.filter(([category]) => category !== "settings");
  const pinned = groups.find(([category]) => category === "settings")?.[1] ?? [];

  return (
    <motion.nav
      aria-label="Navigation principale"
      initial={false}
      animate={{ width: expanded ? EXPANDED : RAIL }}
      transition={spring.gentle}
      className="glass-chrome flex h-full shrink-0 flex-col items-center gap-2 overflow-hidden rounded-[22px] py-3"
    >
      <button
        onClick={() => navigate("home")}
        aria-label="Accueil SDAI ARCHIMED"
        className={cn(
          "flex h-10 shrink-0 items-center gap-2.5 rounded-[12px] transition-transform active:scale-95",
          expanded ? "w-full px-3" : "w-10 justify-center",
        )}
      >
        <ArchimedLogo size={28} />
        {expanded && (
          <span className="truncate text-body-sm font-semibold tracking-[-0.01em]">ARCHIMED</span>
        )}
      </button>

      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto overflow-x-hidden px-3 [scrollbar-width:none]">
        {main.map(([category, items], index) => (
          <Fragment key={category}>
            {index > 0 && <span aria-hidden className="my-1.5 h-px w-6 shrink-0 bg-border-strong" />}
            {expanded && (
              <p className="w-full px-3 pb-0.5 pt-1 text-caption text-text-subtle">
                {CATEGORY_LABELS[category]}
              </p>
            )}
            {items.map((module) => (
              <RailItem
                key={module.id}
                module={module}
                active={module.id === activeModuleId}
                expanded={expanded}
                onSelect={() => navigate(module.id)}
              />
            ))}
          </Fragment>
        ))}
      </div>

      <div className="flex w-full flex-col items-center gap-1 px-3">
        <span aria-hidden className="mb-1 h-px w-6 bg-border-strong" />
        {pinned.map((module) => (
          <RailItem
            key={module.id}
            module={module}
            active={module.id === activeModuleId}
            expanded={expanded}
            onSelect={() => navigate(module.id)}
          />
        ))}
        <Tooltip label={expanded ? "Replier le menu" : "Déployer le menu"} disabled={expanded}>
          <button
            onClick={() => setSidebarCollapsed(expanded)}
            aria-label={expanded ? "Replier le menu" : "Déployer le menu"}
            className={cn(
              "flex h-9 shrink-0 items-center gap-3 rounded-[12px] text-text-subtle transition-colors hover:text-text",
              expanded ? "w-full px-3" : "w-10 justify-center",
            )}
          >
            {expanded ? (
              <PanelLeftClose size={16} strokeWidth={1.75} />
            ) : (
              <PanelLeftOpen size={16} strokeWidth={1.75} />
            )}
            {expanded && <span className="text-footnote">Replier</span>}
          </button>
        </Tooltip>
      </div>
    </motion.nav>
  );
}
