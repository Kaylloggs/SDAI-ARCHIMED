import { useEffect, useMemo, useRef, useState } from "react";
import { Globe2, MapPin, Minus, Plus, RotateCcw, X } from "lucide-react";
import { Button, EmptyState } from "@/design-system/primitives";
import { cn } from "@/core/lib/cn";
import world from "../data/world.json";
import { isSent } from "../lib/triage";
import { useJobAgentStore } from "../store";
import type { Offer } from "../types";
import { OfferCard } from "./OfferCard";

type Shape = { c: string; r: number[][][] };

/** Contours des pays, sans détail : 177 formes arrondies au dixième de degré. */
const SHAPES = (world as { shapes: Shape[] }).shapes;

/** Carte entière, en degrés. */
const WORLD_BOX = { minX: -180, minY: -90, maxX: 180, maxY: 90 };

/** Lignes de coordonnées pour le rendu cartographique discret. */
const LATITUDES = [-60, -30, 0, 30, 60];
const LONGITUDES = [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150];

/**
 * Projection équirectangulaire : la longitude devient l'abscisse, la latitude l'ordonnée
 * (inversée). Suffisante pour poser des points de repère, et sans dépendance.
 */
const project = (longitude: number, latitude: number) => [longitude, -latitude] as const;

function toPath(rings: number[][][]): string {
  let path = "";
  for (const ring of rings) {
    ring.forEach((point, index) => {
      const [x, y] = project(point[0]!, point[1]!);
      path += `${index === 0 ? "M" : "L"}${x} ${y}`;
    });
    path += "Z";
  }
  return path;
}

/** Un point de la carte : toutes les annonces d'un même lieu. */
type Spot = {
  key: string;
  label: string;
  x: number;
  y: number;
  offers: Offer[];
  approximate: boolean;
};

/** Regroupement de points proches pour éviter les chevauchements. */
type Cluster = {
  id: string;
  x: number;
  y: number;
  offers: Offer[];
  spots: Spot[];
  label: string;
  approximate: boolean;
};

function spotsOf(offers: Offer[]): Spot[] {
  const map = new Map<string, Spot>();
  for (const offer of offers) {
    if (offer.latitude == null || offer.longitude == null) continue;
    const key = `${offer.latitude.toFixed(2)},${offer.longitude.toFixed(2)}`;
    const existing = map.get(key);
    if (existing) {
      existing.offers.push(offer);
      continue;
    }
    const [x, y] = project(offer.longitude, offer.latitude);
    map.set(key, {
      key,
      label: offer.geo === "city" ? (offer.city ?? offer.country ?? "") : (offer.country ?? ""),
      x,
      y,
      offers: [offer],
      approximate: offer.geo !== "city",
    });
  }
  return [...map.values()].sort((a, b) => b.offers.length - a.offers.length);
}

/** Cadre resserré sur les points, avec une marge proportionnelle à leur étendue. */
function frameOf(spots: Spot[]) {
  if (spots.length === 0) return WORLD_BOX;
  const xs = spots.map((spot) => spot.x);
  const ys = spots.map((spot) => spot.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const margin = Math.max(6, (maxX - minX) * 0.35, (maxY - minY) * 0.35);
  return {
    minX: Math.max(-180, minX - margin),
    minY: Math.max(-90, minY - margin),
    maxX: Math.min(180, maxX + margin),
    maxY: Math.min(90, maxY + margin),
  };
}

/**
 * Regroupe les points selon la distance visuelle à l'écran : évite que des villes proches
 * se superposent dans une pile illisible. Au zoom, les clusters s'ouvrent naturellement.
 */
function clusterSpots(spots: Spot[], currentWidth: number, containerWidth: number): Cluster[] {
  const widthPx = Math.max(containerWidth, 400);
  // Distance minimale en pixels entre les centres des pastilles
  const minPixelDistance = 44;
  const thresholdSvg = (minPixelDistance * currentWidth) / widthPx;

  const clusters: Cluster[] = [];
  const assigned = new Set<string>();

  for (const spot of spots) {
    if (assigned.has(spot.key)) continue;

    const members: Spot[] = [spot];
    assigned.add(spot.key);

    for (const other of spots) {
      if (assigned.has(other.key)) continue;
      const dist = Math.hypot(spot.x - other.x, spot.y - other.y);
      if (dist < thresholdSvg) {
        members.push(other);
        assigned.add(other.key);
      }
    }

    let totalWeight = 0;
    let sumX = 0;
    let sumY = 0;
    const allOffers: Offer[] = [];
    let allApprox = true;

    for (const m of members) {
      const weight = m.offers.length;
      totalWeight += weight;
      sumX += m.x * weight;
      sumY += m.y * weight;
      allOffers.push(...m.offers);
      if (!m.approximate) allApprox = false;
    }

    const cx = sumX / Math.max(1, totalWeight);
    const cy = sumY / Math.max(1, totalWeight);

    const firstMember = members[0];
    let label = firstMember ? firstMember.label : spot.label;
    if (members.length > 1) {
      const distinct = Array.from(new Set(members.map((s) => s.label).filter(Boolean)));
      const first = distinct[0] ?? label;
      const second = distinct[1] ?? "";
      if (distinct.length === 1) {
        label = first;
      } else if (distinct.length === 2) {
        label = `${first} et ${second}`;
      } else {
        label = `${first} + ${distinct.length - 1} lieux`;
      }
    }

    clusters.push({
      id: members.map((m) => m.key).join("|"),
      x: cx,
      y: cy,
      offers: allOffers,
      spots: members,
      label,
      approximate: allApprox,
    });
  }

  return clusters;
}

/**
 * Carte interactive des offres d'emploi :
 * - Rendu cartographique vectoriel soigné aux tokens du thème
 * - Regroupement dynamique (clustering) évitant les chevauchements
 * - Zoom (molette, boutons, double-clic) et déplacement (pan par glisser-déposer)
 */
export function WorldMap({
  offers,
  selectedId,
  onSelect,
}: {
  offers: Offer[];
  selectedId: string | null;
  onSelect: (offer: Offer) => void;
}) {
  const starred = useJobAgentStore((state) => state.starred);
  const seen = useJobAgentStore((state) => state.seen);
  const applications = useJobAgentStore((state) => state.applications);
  const toggleStar = useJobAgentStore((state) => state.toggleStar);
  const dismissOffer = useJobAgentStore((state) => state.dismissOffer);

  const [focused, setFocused] = useState<string | null>(null);
  const [whole, setWhole] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [containerWidth, setContainerWidth] = useState(800);
  const [hovered, setHovered] = useState<{ id: string; label: string; count: number } | null>(null);

  const svgContainerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const dragStart = useRef({ clientX: 0, clientY: 0, panX: 0, panY: 0 });
  const hasMoved = useRef(false);
  const [dragging, setDragging] = useState(false);

  const spots = useMemo(() => spotsOf(offers), [offers]);
  const frame = useMemo(() => (whole ? WORLD_BOX : frameOf(spots)), [spots, whole]);
  const placed = spots.reduce((total, spot) => total + spot.offers.length, 0);

  const baseWidth = frame.maxX - frame.minX;
  const baseHeight = frame.maxY - frame.minY;
  const baseCenterX = (frame.minX + frame.maxX) / 2;
  const baseCenterY = (frame.minY + frame.maxY) / 2;

  // Calcul du cadre visible selon le niveau de zoom et le déplacement actuel
  const currentWidth = baseWidth / zoom;
  const currentHeight = baseHeight / zoom;
  const centerX = baseCenterX + pan.x;
  const centerY = baseCenterY + pan.y;
  const viewMinX = centerX - currentWidth / 2;
  const viewMinY = centerY - currentHeight / 2;

  // Mesure de la largeur du conteneur pour calibrer la taille des pastilles à l'écran
  useEffect(() => {
    const el = svgContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry?.contentRect.width) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Recalcul des clusters : s'adapte dynamiquement au niveau de zoom pour ne jamais chevaucher
  const clusters = useMemo(
    () => clusterSpots(spots, currentWidth, containerWidth),
    [spots, currentWidth, containerWidth],
  );

  // Remise à zéro du cadrage lors d'un changement de recherche ou de mode monde/résultats
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [whole, offers]);

  // Si l'offre sélectionnée change depuis la liste, on focus son cluster
  useEffect(() => {
    if (!selectedId) return;
    const targetCluster = clusters.find((c) => c.offers.some((o) => o.id === selectedId));
    if (targetCluster) setFocused(targetCluster.id);
  }, [selectedId, clusters]);

  // Gestion du zoom à la molette (centré sous le curseur de la souris)
  useEffect(() => {
    const el = svgContainerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const ratioX = (e.clientX - rect.left) / rect.width;
      const ratioY = (e.clientY - rect.top) / rect.height;

      setZoom((prevZoom) => {
        const factor = e.deltaY < 0 ? 1.25 : 0.8;
        const newZoom = Math.min(30, Math.max(0.6, prevZoom * factor));

        const curW = baseWidth / prevZoom;
        const curH = baseHeight / prevZoom;
        const curMinX = baseCenterX + pan.x - curW / 2;
        const curMinY = baseCenterY + pan.y - curH / 2;
        const mouseSvgX = curMinX + ratioX * curW;
        const mouseSvgY = curMinY + ratioY * curH;

        const newW = baseWidth / newZoom;
        const newH = baseHeight / newZoom;
        const newCenterX = mouseSvgX - (ratioX - 0.5) * newW;
        const newCenterY = mouseSvgY - (ratioY - 0.5) * newH;

        setPan({
          x: newCenterX - baseCenterX,
          y: newCenterY - baseCenterY,
        });

        return newZoom;
      });
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [baseWidth, baseHeight, baseCenterX, baseCenterY, pan]);

  // Déplacement à la souris (Pan)
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    isDragging.current = true;
    hasMoved.current = false;
    dragStart.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - dragStart.current.clientX;
    const dy = e.clientY - dragStart.current.clientY;
    if (Math.hypot(dx, dy) > 4) {
      hasMoved.current = true;
    }
    const rect = svgContainerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;

    const scaleX = currentWidth / rect.width;
    const scaleY = currentHeight / rect.height;
    setPan({
      x: dragStart.current.panX - dx * scaleX,
      y: dragStart.current.panY - dy * scaleY,
    });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    isDragging.current = false;
    setDragging(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
  };

  // Double clic pour zoomer rapidement
  const onDoubleClick = (e: React.MouseEvent) => {
    const rect = svgContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ratioX = (e.clientX - rect.left) / rect.width;
    const ratioY = (e.clientY - rect.top) / rect.height;
    const mouseSvgX = viewMinX + ratioX * currentWidth;
    const mouseSvgY = viewMinY + ratioY * currentHeight;

    const newZoom = Math.min(30, zoom * 1.8);
    const newW = baseWidth / newZoom;
    const newH = baseHeight / newZoom;
    const newCenterX = mouseSvgX - (ratioX - 0.5) * newW;
    const newCenterY = mouseSvgY - (ratioY - 0.5) * newH;

    setZoom(newZoom);
    setPan({
      x: newCenterX - baseCenterX,
      y: newCenterY - baseCenterY,
    });
  };

  // Contrôles de zoom
  const zoomIn = () => setZoom((z) => Math.min(30, z * 1.4));
  const zoomOut = () => setZoom((z) => Math.max(0.6, z / 1.4));
  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setWhole(false);
  };

  // Facteur d'échelle écran pour maintenir une taille de pastille lisible quel que soit le zoom
  const svgPerPixel = currentWidth / Math.max(100, containerWidth);

  const active = clusters.find((c) => c.id === focused);

  if (spots.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={<Globe2 size={26} strokeWidth={1.5} />}
          title="Rien à placer sur la carte"
          description="Lancez une recherche : chaque ville où des annonces ont été trouvées apparaîtra ici."
        />
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col select-none">
      {/* Barre d'état haute */}
      <div className="flex items-center gap-2.5 border-b border-border bg-surface-1/40 px-4 py-2 text-caption text-text-subtle">
        <MapPin size={13} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate font-medium">
          {placed} annonce{placed > 1 ? "s" : ""} sur {spots.length} lieu
          {spots.length > 1 ? "x" : ""}
          {offers.length > placed ? ` · ${offers.length - placed} sans localisation` : ""}
        </span>

        <button
          onClick={() => setWhole((current) => !current)}
          className="shrink-0 cursor-pointer rounded-sm px-2 py-0.5 text-caption text-text-subtle transition-colors hover:bg-surface-2 hover:text-text"
        >
          {whole ? "Cadrer sur les résultats" : "Voir le monde entier"}
        </button>
      </div>

      {/* Conteneur de carte interactif */}
      <div
        ref={svgContainerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        className={cn(
          "relative min-h-0 flex-1 overflow-hidden bg-radial from-surface-1/80 via-surface-1/40 to-bg",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
      >
        <svg
          viewBox={`${viewMinX} ${viewMinY} ${currentWidth} ${currentHeight}`}
          preserveAspectRatio="xMidYMid meet"
          className="h-full w-full"
          role="img"
          aria-label="Carte des annonces d'emploi"
        >
          <defs>
            {/* Ombre portée douce pour détacher les marqueurs */}
            <filter id="job-pin-shadow" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="1.5" stdDeviation="2.5" floodColor="#000000" floodOpacity="0.6" />
            </filter>
            {/* Halo lumineux chaud aux couleurs Archimède */}
            <radialGradient id="cluster-ambient-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.45" />
              <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Graticule élégant (lignes de coordonnées discrètes) */}
          <g className="text-border/40 pointer-events-none">
            {LATITUDES.map((lat) => (
              <line
                key={`lat-${lat}`}
                x1="-180"
                y1={-lat}
                x2="180"
                y2={-lat}
                stroke="currentColor"
                strokeWidth="0.75"
                strokeDasharray="2 3"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {LONGITUDES.map((lon) => (
              <line
                key={`lon-${lon}`}
                x1={lon}
                y1="-90"
                x2={lon}
                y2="90"
                stroke="currentColor"
                strokeWidth="0.75"
                strokeDasharray="2 3"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>

          {/* Contours des pays */}
          <g className="text-border-strong/70 pointer-events-none">
            {SHAPES.map((shape, index) => (
              <path
                key={`${shape.c}-${index}`}
                d={toPath(shape.r)}
                fill="var(--color-surface-2)"
                stroke="currentColor"
                strokeWidth="0.8"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>

          {/* Clusters et pastilles sans chevauchement */}
          {clusters.map((cluster) => {
            const count = cluster.offers.length;
            // Rayon constant à l'écran : calibré en pixels (15px à 24px)
            const pixelRadius = Math.max(14, Math.min(24, 13 + Math.log2(count + 1) * 2.6));
            const radius = pixelRadius * svgPerPixel;

            const isFocused = cluster.id === focused;
            const holdsSelection = cluster.offers.some((o) => o.id === selectedId);
            const isHovered = hovered?.id === cluster.id;
            const isMultiLocation = cluster.spots.length > 1;

            return (
              <g
                key={cluster.id}
                onClick={(e) => {
                  e.stopPropagation();
                  if (hasMoved.current) return;

                  // Clic sur cluster multi-villes : zoom progressif pour ouvrir le groupe
                  if (isMultiLocation) {
                    const newZ = Math.min(30, zoom * 2);
                    setZoom(newZ);
                    setPan({
                      x: cluster.x - baseCenterX,
                      y: cluster.y - baseCenterY,
                    });
                  }
                  setFocused((prev) => (prev === cluster.id ? null : cluster.id));
                }}
                onPointerEnter={() =>
                  setHovered({ id: cluster.id, label: cluster.label, count })
                }
                onPointerLeave={() => setHovered(null)}
                className="cursor-pointer transition-transform"
                role="button"
                aria-label={`${count} annonce${count > 1 ? "s" : ""} : ${cluster.label}`}
              >
                {/* Halo d'ambiance pour les groupes ou la sélection active */}
                {(isFocused || holdsSelection || isMultiLocation || isHovered) && (
                  <circle
                    cx={cluster.x}
                    cy={cluster.y}
                    r={radius * (isFocused || holdsSelection ? 1.7 : 1.45)}
                    fill="url(#cluster-ambient-glow)"
                    className="pointer-events-none"
                  />
                )}

                {/* Anneau extérieur de sélection */}
                {(isFocused || holdsSelection) && (
                  <circle
                    cx={cluster.x}
                    cy={cluster.y}
                    r={radius * 1.32}
                    fill="none"
                    stroke="var(--color-accent)"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                    className="pointer-events-none opacity-90"
                  />
                )}

                {/* Anneau d'indication de groupe multi-villes */}
                {isMultiLocation && !isFocused && (
                  <circle
                    cx={cluster.x}
                    cy={cluster.y}
                    r={radius * 1.22}
                    fill="none"
                    stroke="var(--color-accent)"
                    strokeWidth={1.25}
                    strokeDasharray="3 2"
                    vectorEffect="non-scaling-stroke"
                    className="pointer-events-none opacity-60"
                  />
                )}

                {/* Pastille principale avec ombre portée */}
                <circle
                  cx={cluster.x}
                  cy={cluster.y}
                  r={radius}
                  fill="var(--color-accent)"
                  fillOpacity={cluster.approximate ? 0.75 : 0.95}
                  stroke="var(--color-bg)"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                  filter="url(#job-pin-shadow)"
                />

                {/* Compte d'offres parfaitement centré */}
                <text
                  x={cluster.x}
                  y={cluster.y + radius * 0.35}
                  textAnchor="middle"
                  fontSize={radius * 0.92}
                  fill="var(--color-accent-fg)"
                  className="pointer-events-none select-none font-semibold tracking-tight"
                >
                  {count}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Info-bulle flottante au survol */}
        {hovered && (
          <div className="pointer-events-none absolute bottom-4 left-4 z-20 flex items-center gap-2 rounded-md border border-border-strong bg-surface-3/95 px-3 py-1.5 shadow-float backdrop-blur-md">
            <span className="text-caption font-medium text-text">{hovered.label}</span>
            <span className="rounded-xs bg-accent/20 px-1.5 py-0.5 text-caption font-semibold tabular-nums text-accent">
              {hovered.count}
            </span>
          </div>
        )}

        {/* Barre d'outils flottante de navigation (Zoom & Centrage) */}
        <div className="absolute right-4 bottom-4 z-20 flex flex-col items-center gap-1 rounded-lg border border-border-strong bg-surface-2/85 p-1 shadow-float backdrop-blur-md">
          <button
            onClick={zoomIn}
            title="Zoom avant"
            aria-label="Zoom avant"
            className="flex size-7 cursor-pointer items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-surface-3 hover:text-text"
          >
            <Plus size={14} />
          </button>
          <div className="h-px w-4 bg-border" />
          <button
            onClick={zoomOut}
            title="Zoom arrière"
            aria-label="Zoom arrière"
            className="flex size-7 cursor-pointer items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-surface-3 hover:text-text"
          >
            <Minus size={14} />
          </button>
          <div className="h-px w-4 bg-border" />
          <button
            onClick={resetView}
            title="Recadrer sur les résultats"
            aria-label="Recadrer sur les résultats"
            className="flex size-7 cursor-pointer items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-surface-3 hover:text-text"
          >
            <RotateCcw size={13} />
          </button>
        </div>
      </div>

      {/* Tiroir inférieur affichant les offres du lieu sélectionné */}
      {active && (
        <div className="max-h-[45%] shrink-0 overflow-y-auto border-t border-border bg-surface-1/90 p-4 shadow-float backdrop-blur-md">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-body-sm font-semibold text-text">{active.label}</h3>
                <span className="rounded-full bg-accent/15 px-2 py-0.5 text-caption font-medium tabular-nums text-accent">
                  {active.offers.length} offre{active.offers.length > 1 ? "s" : ""}
                </span>
                {active.approximate && (
                  <span className="text-caption text-text-subtle">(ville non précisée)</span>
                )}
              </div>
              {active.spots.length > 1 && (
                <p className="truncate text-caption text-text-subtle">
                  Regroupe {active.spots.map((s) => s.label).join(", ")}
                </p>
              )}
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setFocused(null)}
              aria-label="Fermer la sélection"
            >
              <X size={14} />
            </Button>
          </div>
          <ul className="space-y-2">
            {active.offers.map((offer) => (
              <OfferCard
                key={offer.id}
                offer={offer}
                selected={offer.id === selectedId}
                starred={starred.includes(offer.id)}
                seen={seen.includes(offer.id)}
                applied={applications.some((item) => item.offerId === offer.id && isSent(item))}
                onSelect={() => onSelect(offer)}
                onStar={() => toggleStar(offer.id)}
                onDismiss={() => dismissOffer(offer.id)}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
