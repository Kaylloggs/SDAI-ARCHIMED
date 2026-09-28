import { useEffect, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { useUiStore } from "@/core/stores/ui.store";
import { ResizeHandle, Tooltip, usePanelSize } from "@/design-system/primitives";
import { VoiceStage } from "./components/VoiceStage";
import { AgentsSection, McpSection } from "./settings/ConnectionsSection";
import { SttSection, TtsSection } from "./settings/EnginesSection";
import { AudioSection, GeneralSection } from "./settings/GeneralSection";
import { InstallsSection } from "./settings/InstallsSection";
import { OverlaySection, PerformanceSection, PermissionsSection, PrivacySection, ShortcutsSection } from "./settings/OptionsSection";
import { SECTION_GROUPS, SECTIONS, isSection, type SectionId } from "./settings/sections";
import { HistorySection, SessionSection } from "./settings/SessionSections";
import { useVoiceStore } from "./store";

const SELF = "voice";
const STORAGE_KEY = "voice.section";
const NAV_KEY = "voice.nav.hidden";

function initialSection(): SectionId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isSection(saved)) return saved;
  } catch {
    // Stockage indisponible : première section.
  }
  return "session";
}

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Préférence non gardée : sans conséquence.
  }
};

/** Masquer ou réafficher la liste des sections (même geste que le menu principal). */
function NavToggle({ hidden, onToggle }: { hidden: boolean; onToggle: () => void }) {
  const label = hidden ? "Afficher les sections" : "Masquer les sections";
  const Icon = hidden ? PanelLeftOpen : PanelLeftClose;
  return (
    <Tooltip label={label} side="bottom">
      <button
        type="button"
        aria-label={label}
        aria-expanded={!hidden}
        onClick={onToggle}
        className={cn(
          "flex shrink-0 cursor-pointer items-center justify-center text-text-subtle transition-colors duration-[80ms] hover:bg-surface-2 hover:text-text",
          hidden ? "size-9 rounded-full" : "size-7 rounded-sm",
        )}
      >
        <Icon size={16} strokeWidth={1.75} />
      </button>
    </Tooltip>
  );
}

/** Six pages de réglages : chacune regroupe les réglages qui vont ensemble. */
function Content({ id, go }: { id: SectionId; go: (id: SectionId) => void }) {
  switch (id) {
    case "session":
      return <SessionSection />;
    case "history":
      return <HistorySection />;
    case "general":
      return (
        <>
          <GeneralSection />
          <ShortcutsSection />
          <OverlaySection />
        </>
      );
    case "audio":
      return <AudioSection />;
    case "engines":
      return (
        <>
          <SttSection go={go} />
          <TtsSection go={go} />
          <PerformanceSection />
        </>
      );
    case "intelligence":
      return (
        <>
          <AgentsSection />
          <McpSection />
        </>
      );
    case "installs":
      return <InstallsSection />;
    case "privacy":
      return (
        <>
          <PrivacySection />
          <PermissionsSection />
        </>
      );
  }
}

/** Page du module Voice : session en direct, historique et tous les réglages de la voix. */
export default function VoiceModule() {
  const [section, setSection] = useState<SectionId>(initialSection);
  const [navWidth, setNavWidth] = usePanelSize("voice.nav", 216, 180, 320);
  const [navHidden, setNavHidden] = useState(() => read(NAV_KEY) === "1");
  const handoff = useUiStore((s) => s.moduleParams[SELF]);
  const clearParams = useUiStore((s) => s.clearModuleParams);
  const loaded = useVoiceStore((s) => s.loaded);
  const info = SECTIONS.find((s) => s.id === section)!;

  const go = (id: SectionId) => {
    setSection(id);
    remember(STORAGE_KEY, id);
  };

  const toggleNav = () => {
    setNavHidden((hidden) => {
      remember(NAV_KEY, hidden ? "0" : "1");
      return !hidden;
    });
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

  const toggle = <NavToggle hidden={navHidden} onToggle={toggleNav} />;

  return (
    <div className="flex h-full min-h-0">
      {!navHidden && (
        <>
          <nav aria-label="Sections de la voix" style={{ width: navWidth }} className="shrink-0 overflow-y-auto border-r border-border px-2 py-4">
            {SECTION_GROUPS.map((group, index) => (
              <div key={group.title} className="pb-4">
                <div className="flex h-7 items-center justify-between pb-1 pl-2.5">
                  <p className="text-caption font-medium text-text-subtle">{group.title}</p>
                  {index === 0 && toggle}
                </div>
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
        </>
      )}

      {navHidden && section === "session" && loaded ? (
        // Liste masquée : la conversation prend toute la place du module.
        <main className="min-w-0 flex-1">
          <VoiceStage variant="fill" leading={toggle} />
        </main>
      ) : (
        <main className="relative min-w-0 flex-1 overflow-y-auto">
          {navHidden && <div className="absolute left-3 top-3 z-10">{toggle}</div>}
          <div className="mx-auto max-w-[860px] px-8 py-8">
            <header className="pb-6">
              <h1 className="text-title-1 font-semibold tracking-[-0.015em]">{info.label}</h1>
              <p className="text-body text-text-muted">{info.description}</p>
            </header>
            {loaded ? <Content id={section} go={go} /> : <p className="text-footnote text-text-subtle">Chargement des réglages…</p>}
          </div>
        </main>
      )}
    </div>
  );
}
