import { Suspense, createElement, useEffect, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import packageInfo from "../../../package.json";
import { allModules, manifestIssues } from "@/core/modules/registry";
import { isModuleEnabled, useModulesStore } from "@/core/stores/modules.store";
import { useSessionStore } from "@/core/engine/session.store";
import { bus } from "@/core/bus/event-bus";
import { Badge, Button, Card, SectionHeader } from "@/design-system/primitives";
import { ThemeSection } from "./components/ThemeSection";
import { EngineSection } from "./components/EngineSection";
import { TokenSaverSection } from "./components/TokenSaverSection";

const FALLBACK_VERSION = packageInfo.version;

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="pt-8">
      <h2 className="text-title-3 font-semibold">{title}</h2>
      {description && <p className="pb-3 pt-0.5 text-footnote text-text-subtle">{description}</p>}
      <div className={description ? "" : "pt-3"}>{children}</div>
    </section>
  );
}

export default function SettingsModule() {
  const { overrides, setOverride } = useModulesStore();
  const sessions = useSessionStore((s) => s.sessions);
  const clearAll = useSessionStore((s) => s.clearAll);
  const [version, setVersion] = useState(FALLBACK_VERSION);

  // Version de l'exécutable (tauri.conf.json) ; celle du package hors Tauri.
  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => undefined);
  }, []);

  return (
    <div className="mx-auto max-w-[900px] px-8 py-8">
      <SectionHeader
        title="Réglages"
        description="Apparence, moteur d'IA, modules et données."
      />

      <Section title="Thème" description="Presets de couleurs appliqués à toute l'application.">
        <ThemeSection />
      </Section>

      <Section
        title="Moteur — CLI d'IA"
        description="Claude Code, Antigravity et Codex sont détectés automatiquement. Indiquez un chemin si une CLI est installée hors PATH."
      >
        <EngineSection />
      </Section>

      <Section
        title="Économie de tokens"
        description="Tout ce qui réduit la consommation : réponses plus courtes, moins de réflexion, contexte allégé."
      >
        <TokenSaverSection />
      </Section>

      <Section
        title="Modules"
        description="Activez ou désactivez les blocs. Les modules requis ne sont pas désactivables."
      >
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
                  <p className="line-clamp-1 text-footnote text-text-subtle">
                    {module.description}
                  </p>
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
      </Section>

      <Section
        title="Données"
        description="Les conversations sont stockées localement sur cette machine."
      >
        <Card className="flex items-center gap-3 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-body font-medium">Historique des conversations</p>
            <p className="text-footnote text-text-subtle">
              {sessions.length} conversation{sessions.length > 1 ? "s" : ""} enregistrée
              {sessions.length > 1 ? "s" : ""}.
            </p>
          </div>
          <Button
            size="sm"
            variant="danger"
            disabled={sessions.length === 0}
            onClick={() => {
              if (window.confirm("Supprimer définitivement toutes les conversations ?")) clearAll();
            }}
          >
            Tout supprimer
          </Button>
        </Card>
      </Section>

      {manifestIssues.length > 0 && (
        <Section title="Manifests invalides">
          <ul className="flex flex-col gap-2">
            {manifestIssues.map((issue) => (
              <Card key={issue.source} className="py-3">
                <p className="font-mono text-footnote text-text-muted">{issue.source}</p>
                <p className="text-footnote text-warning">{issue.message}</p>
              </Card>
            ))}
          </ul>
        </Section>
      )}

      {allModules
        .filter((m) => m.settings && isModuleEnabled(overrides, m))
        .map((module) => (
          <Section key={module.id} title={module.name}>
            <Suspense fallback={null}>{createElement(module.settings!)}</Suspense>
          </Section>
        ))}

      <footer className="mt-12 border-t border-border pt-4 text-center text-footnote text-text-subtle">
        Logiciel réalisé par SearaDesign - v{version} - ARCHIMED
      </footer>
    </div>
  );
}
