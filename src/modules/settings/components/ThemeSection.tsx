import { Check } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { useThemeStore } from "@/core/stores/theme.store";
import { THEMES } from "@/design-system/themes";

export function ThemeSection() {
  const { theme, setTheme } = useThemeStore();

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {THEMES.map((preset) => {
        const active = preset.id === theme;
        return (
          <button
            key={preset.id}
            onClick={() => setTheme(preset.id)}
            aria-pressed={active}
            className={cn(
              "flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors duration-[80ms]",
              active
                ? "border-accent bg-accent-soft"
                : "border-border bg-surface-1 hover:border-border-strong hover:bg-surface-2",
            )}
          >
            <span className="flex items-center gap-1.5">
              {preset.swatch.map((color, index) => (
                <span
                  key={index}
                  className="size-5 rounded-full border border-border"
                  style={{ background: color }}
                />
              ))}
              {active && <Check size={14} strokeWidth={2} className="ml-auto text-accent" />}
            </span>
            <span className="text-body font-medium">{preset.name}</span>
            <span className="text-footnote text-text-subtle">{preset.description}</span>
          </button>
        );
      })}
    </div>
  );
}
