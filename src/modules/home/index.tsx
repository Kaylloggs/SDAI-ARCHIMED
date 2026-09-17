import { motion } from "motion/react";
import { ArrowUpRight, Clock, MessagesSquare, Code2 } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Slot } from "@/core/modules";
import { useEnabledModules } from "@/core/modules/useModules";
import type { LoadedModule } from "@/core/modules/types";
import { useSessionStore } from "@/core/engine/session.store";
import { useUiStore } from "@/core/stores/ui.store";
import { ArchimedLogo } from "@/design-system/brand/ArchimedLogo";
import { duration, ease } from "@/design-system/motion";

const appear = (index: number) => ({
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: {
    duration: duration.base,
    ease: ease.emphasized,
    delay: index * 0.035,
  },
});

const relativeTime = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
function ago(timestamp: number): string {
  const minutes = Math.round((timestamp - Date.now()) / 60_000);
  if (Math.abs(minutes) < 60) return relativeTime.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relativeTime.format(hours, "hour");
  return relativeTime.format(Math.round(hours / 24), "day");
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return "Bonne nuit.";
  if (hour < 18) return "Bonjour.";
  return "Bonsoir.";
}

/** Tuile de module (bloc du launchpad). */
function Tile({
  module,
  index,
  className,
  hero = false,
  onOpen,
}: {
  module: LoadedModule;
  index: number;
  className?: string;
  hero?: boolean;
  onOpen: () => void;
}) {
  const Icon = module.icon;
  return (
    <motion.button
      {...appear(index)}
      onClick={onOpen}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-[20px] border border-border bg-surface-2/60 p-5 text-left",
        "transition-colors duration-[80ms] hover:border-border-strong hover:bg-surface-2",
        className,
      )}
    >
      <span
        className={cn(
          "flex items-center justify-center rounded-[12px] border border-border bg-surface-1",
          hero ? "size-12" : "size-10",
        )}
      >
        <Icon
          size={hero ? 22 : 18}
          strokeWidth={1.75}
          className={cn(
            "text-text-muted transition-colors group-hover:text-text",
            hero && "text-accent",
          )}
        />
      </span>
      <span
        className={cn(
          "mt-auto font-semibold",
          hero ? "pt-8 text-title-1 tracking-[-0.015em]" : "pt-4 text-title-3",
        )}
      >
        {module.name}
      </span>
      <span
        className={cn(
          "line-clamp-2 text-text-subtle",
          hero ? "max-w-[46ch] pt-1 text-body" : "pt-0.5 text-footnote",
        )}
      >
        {module.description}
      </span>
      {hero && (
        <ArchimedLogo
          size={360}
          tone="mono"
          title=""
          className="pointer-events-none absolute -right-16 -top-10 text-text opacity-[0.045] transition-transform duration-700 ease-emphasized group-hover:rotate-[24deg]"
        />
      )}
      <ArrowUpRight
        size={16}
        strokeWidth={1.75}
        className="absolute right-4 top-4 text-text-subtle opacity-0 transition-opacity group-hover:opacity-100"
      />
    </motion.button>
  );
}

/** Launchpad en grille bento, généré depuis le registre des modules. */
export default function HomeModule() {
  const modules = useEnabledModules();
  const { navigate, openModule } = useUiStore();
  const sessions = useSessionStore((s) => s.sessions);
  const setActive = useSessionStore((s) => s.setActive);

  const tiles = modules.filter((m) => m.launchpad !== false && m.id !== "home");
  const heroModule =
    tiles.find((m) => m.launchpad && m.launchpad.accent) ??
    tiles.find((m) => m.launchpad && m.launchpad.size === "lg") ??
    tiles[0];
  const others = tiles.filter((m) => m !== heroModule);
  const recent = [...sessions]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5);

  const openSession = (id: string, origin: string, cwd: string | null) => {
    if (origin === "code" && cwd) {
      openModule("code", { cwd });
    } else {
      setActive(id);
      navigate("chat");
    }
  };

  return (
    // Page défilante : les tuiles gardent leur taille quand les modules s'accumulent.
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1180px] flex-col px-6 py-6">
        <header className="flex items-end justify-between gap-4 pb-5">
          <div>
            <p className="text-footnote text-text-subtle">SDAI ARCHIMED</p>
            <h1 className="text-display font-semibold tracking-[-0.02em]">
              {greeting()}
            </h1>
          </div>
          <p className="hidden text-footnote text-text-subtle md:block">
            Ctrl K pour tout retrouver
          </p>
        </header>

        <div className="grid auto-rows-[minmax(150px,auto)] grid-cols-4 gap-3">
          {heroModule && (
            <Tile
              module={heroModule}
              index={0}
              hero
              className="col-span-4 row-span-2 lg:col-span-3"
              onOpen={() => navigate(heroModule.id)}
            />
          )}

          <motion.section
            {...appear(1)}
            aria-label="Conversations récentes"
            className="col-span-4 row-span-2 flex flex-col rounded-[20px] border border-border bg-surface-2/60 p-4 lg:col-span-1"
          >
            <p className="flex items-center gap-1.5 pb-3 text-footnote font-medium text-text-muted">
              <Clock size={13} strokeWidth={1.75} />
              Récemment
            </p>
            {recent.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                <ArchimedLogo
                  size={32}
                  tone="mono"
                  className="text-text-subtle"
                />
                <p className="text-footnote text-text-subtle">
                  Vos conversations apparaîtront ici.
                </p>
              </div>
            ) : (
              <ul className="flex max-h-72 min-h-0 flex-col gap-1 overflow-y-auto">
                {recent.map((session) => {
                  const Icon =
                    session.origin === "code" ? Code2 : MessagesSquare;
                  return (
                    <li key={session.id}>
                      <button
                        onClick={() =>
                          openSession(session.id, session.origin, session.cwd)
                        }
                        className="flex w-full items-center gap-2.5 rounded-[12px] px-2 py-2 text-left transition-colors hover:bg-surface-2"
                      >
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface-1">
                          <Icon
                            size={14}
                            strokeWidth={1.75}
                            className="text-text-muted"
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body-sm">
                            {session.title}
                          </span>
                          <span className="block text-caption text-text-subtle">
                            {ago(session.updatedAt)}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </motion.section>

          {others.map((module, index) => (
            <Tile
              key={module.id}
              module={module}
              index={index + 2}
              className="col-span-2 lg:col-span-1"
              onOpen={() => navigate(module.id)}
            />
          ))}
        </div>

        <div className="grid grid-cols-4 gap-3 pt-3 empty:hidden">
          <Slot name="launchpad.widgets" />
        </div>
      </div>
    </div>
  );
}
