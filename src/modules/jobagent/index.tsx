import { useEffect, useState } from "react";
import { List, Loader2, Map as MapIcon, Search, UserRound } from "lucide-react";
import { ResizeHandle, usePanelSize } from "@/design-system/primitives";
import { cn } from "@/core/lib/cn";
import { focusRing, Segmented } from "./components/Panel";
import { useJobAgentStore } from "./store";
import { EngineSetup } from "./components/EngineSetup";
import { OfferList } from "./components/OfferList";
import { BatchPanel } from "./components/BatchPanel";
import { OfferPanel } from "./components/OfferPanel";
import { ProfilePanel } from "./components/ProfilePanel";
import { SearchForm } from "./components/SearchForm";
import { WorldMap } from "./components/WorldMap";
import type { Offer } from "./types";

/**
 * JobAgent : chercher des annonces sur plusieurs plateformes à la fois, les trier,
 * puis préparer les candidatures avec le CV.
 */
export default function JobAgentModule() {
  const { load, loaded, status, offers, markSeen } = useJobAgentStore();
  const batch = useJobAgentStore((state) => state.batch);
  const [tab, setTab] = useState<"search" | "profile">("search");
  const [view, setView] = useState<"list" | "map">("list");
  const [selected, setSelected] = useState<Offer | null>(null);
  const [sideWidth, setSideWidth] = usePanelSize("jobagent.side", 400, 320, 620);
  const [detailWidth, setDetailWidth] = usePanelSize("jobagent.detail", 460, 320, 900);

  useEffect(() => {
    void load();
  }, [load]);

  /** Ouvrir une annonce la sort de la pile « À voir ». */
  const open = (offer: Offer) => {
    setSelected(offer);
    markSeen(offer.id);
  };

  // L'offre choisie disparaît quand une nouvelle recherche remplace la liste.
  useEffect(() => {
    if (selected && !offers.some((offer) => offer.id === selected.id)) setSelected(null);
  }, [offers, selected]);

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center text-text-subtle">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  // Statut illisible (backend indisponible) : on montre l'écran d'installation plutôt
  // qu'un chargement sans fin.
  if (!status?.ready) return <EngineSetup />;

  return (
    <div className="flex h-full min-w-0">
      <aside
        style={{ width: sideWidth }}
        className="flex shrink-0 flex-col border-r border-border bg-surface-1/40"
      >
        <div className="border-b border-border p-3">
          <Segmented
            value={tab}
            onChange={setTab}
            label="Panneau"
            options={[
              {
                value: "search" as const,
                label: "Recherche",
                icon: <Search size={14} strokeWidth={1.75} />,
              },
              {
                value: "profile" as const,
                label: "Profil",
                icon: <UserRound size={14} strokeWidth={1.75} />,
              },
            ]}
          />
        </div>
        <div className="min-h-0 flex-1">
          {tab === "search" ? <SearchForm /> : <ProfilePanel />}
        </div>
      </aside>

      <ResizeHandle
        size={sideWidth}
        onResize={setSideWidth}
        panel="before"
        label="Largeur du panneau de recherche"
        defaultSize={320}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <div
          role="radiogroup"
          aria-label="Affichage des offres"
          className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2"
        >
          {[
            { id: "list" as const, label: "Liste", icon: List },
            { id: "map" as const, label: "Carte", icon: MapIcon },
          ].map((item) => (
            <button
              key={item.id}
              role="radio"
              aria-checked={view === item.id}
              onClick={() => setView(item.id)}
              className={cn(
                "flex h-7 cursor-pointer items-center gap-2 rounded-sm px-2 text-footnote font-medium",
                "transition-colors duration-[80ms] ease-standard",
                focusRing,
                view === item.id
                  ? "bg-surface-2 text-text"
                  : "text-text-subtle hover:text-text",
              )}
            >
              <item.icon size={14} strokeWidth={1.75} /> {item.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1">
          {view === "list" ? (
            <OfferList selectedId={selected?.id ?? null} onSelect={open} />
          ) : (
            <WorldMap offers={offers} selectedId={selected?.id ?? null} onSelect={open} />
          )}
        </div>
      </main>

      {batch.length > 0 || selected ? (
        <>
          <ResizeHandle
            size={detailWidth}
            onResize={setDetailWidth}
            panel="after"
            label="Largeur du panneau de droite"
            defaultSize={460}
          />
          <aside
            style={{ width: detailWidth }}
            className="shrink-0 border-l border-border bg-surface-1/40"
          >
            {batch.length > 0 ? (
              <BatchPanel onClose={() => undefined} />
            ) : (
              selected && <OfferPanel offer={selected} onClose={() => setSelected(null)} />
            )}
          </aside>
        </>
      ) : null}
    </div>
  );
}
