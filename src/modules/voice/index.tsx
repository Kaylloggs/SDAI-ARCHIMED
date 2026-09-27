import { useEffect, useState } from "react";
import { cn } from "@/core/lib/cn";
import { useUiStore } from "@/core/stores/ui.store";
import { ResizeHandle, usePanelSize } from "@/design-system/primitives";
import { AgentsSection, McpSection, ProvidersSection } from "./settings/ConnectionsSection";
import { SttSection, TtsSection } from "./settings/EnginesSection";
import { AudioSection, GeneralSection } from "./settings/GeneralSection";
import { ModelsSection } from "./settings/ModelsSection";
import { OverlaySection, PerformanceSection, PermissionsSection, PrivacySection, ShortcutsSection } from "./settings/OptionsSection";
import { SECTION_GROUPS, SECTIONS, isSection, type SectionId } from "./settings/sections";
import { HistorySection, SessionSection } from "./settings/SessionSections";
import { useVoiceStore } from "./store";

const SELF = "voice";
const STORAGE_KEY = "voice.section";

function initialSection(): SectionId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isSection(saved)) return saved;
  } catch {
    // Stockage indisponible : première section.
  }
  return "session";
}

function Content({ id, go }: { id: SectionId; go: (id: SectionId) => void }) {
  switch (id) {
    case "session":
      return <SessionSection />;
    case "history":
      return <HistorySection />;
    case "general":
      return <GeneralSection />;
    case "audio":
      return <AudioSection />;
    case "stt":
      return <SttSection go={go} />;
    case "tts":
      return <TtsSection go={go} />;
    case "models":
      return <ModelsSection />;
    case "providers":
      return <ProvidersSection />;
    case "agents":
      return <AgentsSection go={go} />;
    case "mcp":
      return <McpSection />;
    case "shortcuts":
      return <ShortcutsSection />;
    case "overlay":
      return <OverlaySection />;
    case "privacy":
      return <PrivacySection />;
    case "permissions":
      return <PermissionsSection />;
    case "performance":
      return <PerformanceSection />;
  }
}

/** Page du module Voice : session en direct, historique et tous les réglages de la voix. */
export default function VoiceModule() {
  const [section, setSection] = useState<SectionId>(initialSection);
  const [navWidth, setNavWidth] = usePanelSize("voice.nav", 216, 180, 320);
  const handoff = useUiStore((s) => s.moduleParams[SELF]);
  const clearParams = useUiStore((s) => s.clearModuleParams);
  const loaded = useVoiceStore((s) => s.loaded);
  const info = SECTIONS.find((s) => s.id === section)!;

  const go = (id: SectionId) => {
    setSection(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Préférence non gardée : sans conséquence.
    }
  };

  // Un autre écran (pastille, action d'un agent) peut ouvrir une section précise.
  useEffect(() => {
    const wanted = handoff?.["section"];
    if (isSection(wanted)) {
      setSection(wanted);
      clearParams(SELF);
    }
  }, [handoff, clearParams]);

  useEffect(() => {
    void useVoiceStore.getState().load();
  }, []);

  return (
    <div className="flex h-full min-h-0">
      <nav aria-label="Sections de la voix" style={{ width: navWidth }} className="shrink-0 overflow-y-auto border-r border-border px-2 py-4">
        {SECTION_GROUPS.map((group) => (
          <div key={group.title} className="pb-4">
            <p className="px-2.5 pb-1 text-caption font-medium text-text-subtle">{group.title}</p>
            <ul className="space-y-px">
              {group.sections.map(({ id, label, icon: Icon }) => (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => go(id)}
                    aria-current={section === id ? "page" : undefined}
                    className={cn(
                      "flex h-8 w-full cursor-pointer items-center gap-2 rounded-sm px-2.5 text-left text-body-sm transition-colors duration-[80ms]",
                      section === id ? "bg-surface-2 font-medium text-text" : "text-text-muted hover:bg-surface-1 hover:text-text",
                    )}
                  >
                    <Icon size={15} strokeWidth={1.75} className="shrink-0" aria-hidden />
                    <span className="truncate">{label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <ResizeHandle size={navWidth} onResize={setNavWidth} panel="before" label="Largeur de la liste des sections" defaultSize={216} />

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[860px] px-8 py-8">
          <header className="pb-6">
            <h1 className="text-title-1 font-semibold tracking-[-0.015em]">{info.label}</h1>
            <p className="text-body text-text-muted">{info.description}</p>
          </header>
          {loaded ? <Content id={section} go={go} /> : <p className="text-footnote text-text-subtle">Chargement des réglages…</p>}
        </div>
      </main>
    </div>
  );
}
