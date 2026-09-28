import { Suspense, createElement, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { AlertTriangle, Blocks, Bot, Database, Download, Leaf, Palette, type LucideIcon } from "lucide-react";
import packageInfo from "../../../package.json";
import { cn } from "@/core/lib/cn";
import { allModules, manifestIssues } from "@/core/modules/registry";
import { isModuleEnabled, useModulesStore } from "@/core/stores/modules.store";
import { useUiStore } from "@/core/stores/ui.store";
import { useSessionStore } from "@/core/engine/session.store";
import { Button, Card, ResizeHandle, SectionHeader, usePanelSize } from "@/design-system/primitives";
import { ThemeSection } from "./components/ThemeSection";
import { EngineSection } from "./components/EngineSection";
import { TokenSaverSection } from "./components/TokenSaverSection";
import { ModulesSection } from "./components/ModulesSection";
import { SourceFolderSection, UpdateSection } from "./components/UpdateSection";

const SELF = "settings";
const FALLBACK_VERSION = packageInfo.version;

type NavItem = { id: string; label: string; icon: LucideIcon };
type NavGroup = { title: string; items: NavItem[] };

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section id={`settings-${id}`} data-section={id} aria-labelledby={`settings-${id}-title`} className="scroll-mt-6 pt-8">
      <h2 id={`settings-${id}-title`} className="text-title-3 font-semibold">
        {title}
      </h2>
      {description && <p className="pb-3 pt-0.5 text-footnote text-text-subtle">{description}</p>}
      <div className={description ? "" : "pt-3"}>{children}</div>
    </section>
  );
}

/** Section visible : la dernière dont le titre a passé le haut de la zone de lecture. */
function visibleSection(container: HTMLElement): string | null {
  const sections = Array.from(container.querySelectorAll<HTMLElement>("[data-section]"));
  if (sections.length === 0) return null;
  // Tout en bas : la dernière section, même courte, est celle qu'on lit.
  if (container.scrollTop + container.clientHeight >= container.scrollHeight - 4) return sections.at(-1)!.dataset.section ?? null;
  const top = container.getBoundingClientRect().top + 96;
  let current = sections[0]!.dataset.section ?? null;
  for (const section of sections) {
    if (section.getBoundingClientRect().top <= top) current = section.dataset.section ?? current;
  }
  return current;
}

export default function SettingsModule() {
  const overrides = useModulesStore((s) => s.overrides);
  const [confirmClear, setConfirmClear] = useState(false);
  const sessions = useSessionStore((s) => s.sessions);
  const clearAll = useSessionStore((s) => s.clearAll);
  const [version, setVersion] = useState(FALLBACK_VERSION);
  const [navWidth, setNavWidth] = usePanelSize("settings.nav", 212, 176, 300);
  const [active, setActive] = useState("theme");
  const scroller = useRef<HTMLElement>(null);
  const handoff = useUiStore((s) => s.moduleParams[SELF]);
  const clearParams = useUiStore((s) => s.clearModuleParams);

  const moduleSettings = allModules.filter((m) => m.settings && isModuleEnabled(overrides, m));
  const groups: NavGroup[] = [
    {
      title: "Application",
      items: [
        { id: "theme", label: "Thème", icon: Palette },
        { id: "agents", label: "Assistants IA", icon: Bot },
        { id: "tokens", label: "Économie de tokens", icon: Leaf },
      ],
    },
    {
      title: "Système",
      items: [
        { id: "modules", label: "Modules", icon: Blocks },
        { id: "updates", label: "Mises à jour", icon: Download },
        { id: "data", label: "Données", icon: Database },
        ...(manifestIssues.length > 0 ? [{ id: "manifests", label: "Manifests invalides", icon: AlertTriangle }] : []),
      ],
    },
    ...(moduleSettings.length > 0
      ? [{ title: "Modules", items: moduleSettings.map((m) => ({ id: `module-${m.id}`, label: m.name, icon: m.icon })) }]
      : []),
  ];

  // Version de l'exécutable (tauri.conf.json) ; celle du package hors Tauri.
  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => undefined);
  }, []);

  const jump = useCallback((id: string, smooth = true) => {
    const target = document.getElementById(`settings-${id}`);
    if (!target) return;
    setActive(id);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: smooth && !reduced ? "smooth" : "auto", block: "start" });
  }, []);

  // Suit la lecture : la section visible est surlignée dans la liste.
  useEffect(() => {
    const container = scroller.current;
    if (!container) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const id = visibleSection(container);
        if (id) setActive(id);
      });
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  // Un autre écran peut ouvrir une section précise (ex. Voice › « Assistants IA »).
  useEffect(() => {
    const wanted = handoff?.["section"];
    if (typeof wanted !== "string") return;
    clearParams(SELF);
    requestAnimationFrame(() => jump(wanted, false));
  }, [handoff, clearParams, jump]);

  return (
    <div className="flex h-full min-h-0">
      <nav aria-label="Catégories des réglages" style={{ width: navWidth }} className="shrink-0 overflow-y-auto border-r border-border px-2 py-4">
        {groups.map((group) => (
          <div key={group.title} className="pb-4">
            <p className="flex h-7 items-center px-2.5 pb-1 text-caption font-medium text-text-subtle">{group.title}</p>
            <ul className="space-y-px">
              {group.items.map(({ id, label, icon: Icon }) => (
                <li key={id}>
                  <a
                    href={`#settings-${id}`}
                    onClick={(event) => {
                      event.preventDefault();
                      jump(id);
                    }}
                    aria-current={active === id ? "location" : undefined}
                    className={cn(
                      "flex h-8 w-full cursor-pointer items-center gap-2 rounded-sm px-2.5 text-left text-body-sm transition-colors duration-[80ms]",
                      active === id ? "bg-surface-2 font-medium text-text" : "text-text-muted hover:bg-surface-1 hover:text-text",
                    )}
                  >
                    <Icon size={15} strokeWidth={1.75} className="shrink-0" aria-hidden />
                    <span className="truncate">{label}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <ResizeHandle size={navWidth} onResize={setNavWidth} panel="before" label="Largeur de la liste des catégories" defaultSize={212} />

      <main ref={scroller} className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[900px] px-8 py-8">
          <SectionHeader title="Réglages" description="Apparence, assistants d'IA, modules et données." />

          <Section id="theme" title="Thème" description="Presets de couleurs appliqués à toute l'application.">
            <ThemeSection />
          </Section>

          <Section
            id="agents"
            title="Assistants IA"
            description="Les CLI qui font travailler ARCHIMED : Chat, Code, Voice et les modules passent par elles. Détectées automatiquement ; installez-les et connectez-vous ici."
          >
            <EngineSection />
          </Section>

          <Section
            id="tokens"
            title="Économie de tokens"
            description="Tout ce qui réduit la consommation : réponses plus courtes, moins de réflexion, contexte allégé."
          >
            <TokenSaverSection />
          </Section>

          <Section
            id="modules"
            title="Modules"
            description="Désactiver un module le met de côté en gardant tout. Le supprimer le retire de l'application et met ses données à la Corbeille."
          >
            <ModulesSection />
          </Section>

          <Section
            id="updates"
            title="Mises à jour"
            description="ARCHIMED vérifie au démarrage, puis toutes les six heures, si une nouvelle version est publiée sur GitHub, et repère les modules que vous créez dans votre code source. Rien n'est installé sans votre accord."
          >
            <div className="flex flex-col gap-2">
              <UpdateSection version={version} />
              <SourceFolderSection />
            </div>
          </Section>

          <Section id="data" title="Données" description="Les conversations sont stockées localement sur cette machine.">
            <Card className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-body font-medium">Historique des conversations</p>
                <p className="text-footnote text-text-subtle">
                  {sessions.length} conversation{sessions.length > 1 ? "s" : ""} enregistrée
                  {sessions.length > 1 ? "s" : ""}.
                </p>
              </div>
              {confirmClear && (
                <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>
                  Annuler
                </Button>
              )}
              <Button
                size="sm"
                variant="danger"
                disabled={sessions.length === 0}
                onClick={() => {
                  if (!confirmClear) return setConfirmClear(true);
                  clearAll();
                  setConfirmClear(false);
                }}
              >
                {confirmClear ? "Confirmer la suppression" : "Tout supprimer"}
              </Button>
            </Card>
          </Section>

          {manifestIssues.length > 0 && (
            <Section id="manifests" title="Manifests invalides">
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

          {moduleSettings.map((module) => (
            <Section key={module.id} id={`module-${module.id}`} title={module.name}>
              <Suspense fallback={null}>{createElement(module.settings!)}</Suspense>
            </Section>
          ))}

          <footer className="mt-12 border-t border-border pt-4 text-center text-footnote text-text-subtle">
            Logiciel réalisé par SearaDesign - v{version} - ARCHIMED
          </footer>
        </div>
      </main>
    </div>
  );
}
