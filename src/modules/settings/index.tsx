import { Suspense, createElement } from "react";
import { allModules, manifestIssues } from "@/core/modules/registry";
import { isModuleEnabled, useModulesStore } from "@/core/stores/modules.store";
import { bus } from "@/core/bus/event-bus";
import { Badge, Button, Card, SectionHeader } from "@/design-system/primitives";

export default function SettingsModule() {
  const { overrides, setOverride } = useModulesStore();

  return (
    <div className="mx-auto max-w-[900px] px-8 py-8">
      <SectionHeader
        title="Réglages"
        description="Activez ou désactivez les blocs. Les modules requis ne peuvent pas être désactivés."
      />

      <h2 className="pb-2 text-title-3 font-semibold">Modules</h2>
      <ul className="flex flex-col gap-2">
        {allModules.map((module) => {
          const Icon = module.icon;
          const enabled = isModuleEnabled(overrides, module);
          return (
            <Card key={module.id} className="flex items-center gap-3 py-3">
              <Icon size={16} strokeWidth={1.75} className="shrink-0 text-text-muted" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-body font-medium">{module.name}</p>
                  <Badge tone="neutral">v{module.version}</Badge>
                  {module.required && <Badge tone="accent">requis</Badge>}
                  {module.backend && <Badge tone="neutral">backend</Badge>}
                </div>
                <p className="line-clamp-1 text-footnote text-text-subtle">{module.description}</p>
              </div>
              <Button
                size="sm"
                variant={enabled ? "primary" : "secondary"}
                disabled={module.required}
                onClick={() => {
                  setOverride(module.id, !enabled);
                  bus.emit("modules.changed", { id: module.id, enabled: !enabled });
                }}
              >
                {enabled ? "Activé" : "Désactivé"}
              </Button>
            </Card>
          );
        })}
      </ul>

      {manifestIssues.length > 0 && (
        <>
          <h2 className="pb-2 pt-8 text-title-3 font-semibold text-warning">Manifests invalides</h2>
          <ul className="flex flex-col gap-2">
            {manifestIssues.map((issue) => (
              <Card key={issue.source} className="py-3">
                <p className="font-mono text-footnote text-text-muted">{issue.source}</p>
                <p className="text-footnote text-warning">{issue.message}</p>
              </Card>
            ))}
          </ul>
        </>
      )}

      {allModules
        .filter((m) => m.settings && isModuleEnabled(overrides, m))
        .map((module) => (
          <section key={module.id} className="pt-8">
            <h2 className="pb-2 text-title-3 font-semibold">{module.name}</h2>
            <Suspense fallback={null}>{createElement(module.settings!)}</Suspense>
          </section>
        ))}
    </div>
  );
}
