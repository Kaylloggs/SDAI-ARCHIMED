import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/core/lib/cn";
import type { GameSystem } from "@/core/ipc/bindings/GameSystem";
import type { GameSystemStatus } from "@/core/ipc/bindings/GameSystemStatus";
import { layoutGraph, neighbourhood, NODE_H, NODE_W } from "../../lib/graph-layout";
import { SYSTEM_STATUS } from "../../lib/labels";

const STROKE: Record<GameSystemStatus, string> = {
  planned: "stroke-border-strong",
  inProgress: "stroke-info",
  implemented: "stroke-accent",
  validated: "stroke-success",
  broken: "stroke-danger",
  deprecated: "stroke-border",
};

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Graphe des systèmes : chaque système à droite de ce dont il dépend. Sélectionner un système
 * met en avant ses dépendances et ce qui l'utilise (le reste s'estompe).
 */
export function SystemGraph({ systems, selected, onSelect }: { systems: GameSystem[]; selected: string | null; onSelect: (id: string | null) => void }) {
  const items = useMemo(() => systems.map((s) => ({ id: s.id, dependencies: s.dependencies, group: s.category })), [systems]);
  const layout = useMemo(() => layoutGraph(items), [items]);
  const focus = useMemo(() => (selected ? neighbourhood(items, selected) : null), [items, selected]);
  const byId = useMemo(() => new Map(systems.map((s) => [s.id, s])), [systems]);
  const pos = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);
  const frame = useRef<HTMLDivElement>(null);

  // Système choisi ailleurs (liste, fiche, agent) : on l'amène dans la vue s'il n'y est pas.
  useEffect(() => {
    const box = frame.current;
    const node = selected ? pos.get(selected) : undefined;
    if (!box || !node) return;
    const margin = 24;
    const outX = node.x < box.scrollLeft || node.x + NODE_W > box.scrollLeft + box.clientWidth;
    const outY = node.y < box.scrollTop || node.y + NODE_H > box.scrollTop + box.clientHeight;
    if (!outX && !outY) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    box.scrollTo({
      left: outX ? Math.max(0, node.x + NODE_W / 2 - box.clientWidth / 2) : box.scrollLeft,
      top: outY ? Math.max(0, node.y - margin) : box.scrollTop,
      behavior: still ? "auto" : "smooth",
    });
  }, [selected, pos]);

  return (
    <div ref={frame} className="max-h-[calc(100vh-260px)] overflow-auto rounded-lg border border-border bg-bg-subtle">
      <svg
        width={layout.width}
        height={layout.height}
        role="group"
        aria-label={`Graphe de ${systems.length} systèmes`}
        onClick={(e) => {
          if (e.target === e.currentTarget) onSelect(null);
        }}
      >
        <g aria-hidden>
          {layout.edges.map((edge) => {
            const a = pos.get(edge.from);
            const b = pos.get(edge.to);
            if (!a || !b) return null;
            const x1 = a.x + NODE_W;
            const y1 = a.y + NODE_H / 2;
            const x2 = b.x;
            const y2 = b.y + NODE_H / 2;
            const mid = (x1 + x2) / 2;
            const lit = focus ? focus.has(edge.from) && focus.has(edge.to) : false;
            return (
              <path
                key={`${edge.from}->${edge.to}`}
                d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                fill="none"
                className={cn(lit ? "stroke-accent" : "stroke-border-strong", focus && !lit && "opacity-20")}
                strokeWidth={lit ? 1.5 : 1}
              />
            );
          })}
        </g>
        {layout.nodes.map((node) => {
          const system = byId.get(node.id);
          if (!system) return null;
          const isSelected = selected === node.id;
          const dim = focus && !focus.has(node.id);
          return (
            <g
              key={node.id}
              transform={`translate(${node.x}, ${node.y})`}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              aria-label={`${system.name}, ${SYSTEM_STATUS[system.status].label}`}
              onClick={() => onSelect(isSelected ? null : node.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(isSelected ? null : node.id);
                }
              }}
              className={cn("cursor-pointer outline-none focus-visible:[&>rect]:stroke-accent", dim && "opacity-35")}
            >
              <title>{`${system.name} — ${system.role}`}</title>
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={8}
                className={cn(isSelected ? "fill-accent-soft stroke-accent" : cn("fill-surface-1", STROKE[system.status]))}
                strokeWidth={isSelected ? 1.5 : 1}
              />
              <text x={12} y={NODE_H / 2 + 4} className="fill-text text-footnote">
                {truncate(system.name, 24)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
