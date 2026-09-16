import { Slot } from "@/core/modules";
import { allModules, manifestIssues } from "@/core/modules/registry";
import { useEnabledModules } from "@/core/modules/useModules";

export function StatusBar() {
  const enabled = useEnabledModules();

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-border bg-bg-subtle px-3 text-caption text-text-subtle">
      <span>
        {enabled.length} module{enabled.length > 1 ? "s" : ""} actif
        {enabled.length > 1 ? "s" : ""} / {allModules.length}
      </span>
      {manifestIssues.length > 0 && (
        <span className="text-warning">
          {manifestIssues.length} manifest(s) invalide(s)
        </span>
      )}
      <div className="ml-auto flex items-center gap-3">
        <Slot name="statusbar.items" />
      </div>
    </footer>
  );
}
