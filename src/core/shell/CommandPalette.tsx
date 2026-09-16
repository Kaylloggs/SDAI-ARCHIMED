import { useEffect } from "react";
import { Command } from "cmdk";
import { AnimatePresence, motion } from "motion/react";
import { useEnabledModules } from "@/core/modules/useModules";
import { useUiStore } from "@/core/stores/ui.store";
import { popIn } from "@/design-system/motion";

export function CommandPalette() {
  const modules = useEnabledModules();
  const { paletteOpen, setPaletteOpen, navigate } = useUiStore();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        setPaletteOpen(!useUiStore.getState().paletteOpen);
      }
      if (event.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPaletteOpen]);

  const commands = modules.flatMap((module) =>
    (module.commands ?? []).map((command) => ({ module, command })),
  );

  return (
    <AnimatePresence>
      {paletteOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center bg-scrim pt-[18vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setPaletteOpen(false)}
        >
          <motion.div
            variants={popIn}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={(event) => event.stopPropagation()}
            className="glass w-[560px] overflow-hidden rounded-xl"
          >
            <Command label="Palette de commandes" className="[&_[cmdk-input]]:outline-none">
              <Command.Input
                autoFocus
                placeholder="Aller à un module, lancer une action…"
                className="h-12 w-full border-b border-border bg-transparent px-4 text-body text-text placeholder:text-text-subtle"
              />
              <Command.List className="max-h-[320px] overflow-y-auto p-2">
                <Command.Empty className="px-3 py-6 text-center text-body-sm text-text-subtle">
                  Aucun résultat.
                </Command.Empty>

                <Command.Group
                  heading="Modules"
                  className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:text-text-subtle"
                >
                  {modules.map((module) => {
                    const Icon = module.icon;
                    return (
                      <Command.Item
                        key={module.id}
                        value={`${module.name} ${module.description}`}
                        onSelect={() => navigate(module.id)}
                        className="flex h-9 cursor-pointer items-center gap-2.5 rounded-sm px-2 text-body-sm text-text-muted data-[selected=true]:bg-surface-2 data-[selected=true]:text-text"
                      >
                        <Icon size={16} strokeWidth={1.75} />
                        <span>{module.name}</span>
                        <span className="truncate text-footnote text-text-subtle">
                          {module.description}
                        </span>
                      </Command.Item>
                    );
                  })}
                </Command.Group>

                {commands.length > 0 && (
                  <Command.Group
                    heading="Actions"
                    className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:text-text-subtle"
                  >
                    {commands.map(({ module, command }) => (
                      <Command.Item
                        key={command.id}
                        value={command.title}
                        onSelect={() => {
                          if (command.run === "navigate") navigate(module.id);
                          else void command.run();
                          setPaletteOpen(false);
                        }}
                        className="flex h-9 cursor-pointer items-center gap-2.5 rounded-sm px-2 text-body-sm text-text-muted data-[selected=true]:bg-surface-2 data-[selected=true]:text-text"
                      >
                        <span>{command.title}</span>
                        <span className="ml-auto text-caption text-text-subtle">
                          {module.name}
                        </span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
              </Command.List>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
