import { useMemo, useState, type MouseEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Columns2,
  Copy,
  Download,
  Heart,
  ImageUp,
  KeyRound,
  Layers,
  Loader2,
  Maximize2,
  PenLine,
  RefreshCw,
  Repeat2,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Badge, Button, ContextMenu, type ContextMenuItem } from "@/design-system/primitives";
import type { ImageJob } from "@/core/ipc/bindings/ImageJob";
import type { ImageNode } from "@/core/ipc/bindings/ImageNode";
import { PROVIDER_NAMES, PROVIDER_SITES, JOB_LABELS, KIND_LABELS, ago, elapsed, usageText } from "../lib/format";
import { layoutTree } from "../lib/history";
import { useImageMaker } from "../store";
import { copyImage } from "../clipboard";
import { Segmented, focusRing } from "./ui";

const CELL_W = 76;
const CELL_H = 64;
const THUMB = 48;

/** Actions sur une version (clic droit dans l'historique, survol des générations). */
function nodeActions(node: ImageNode) {
  const s = useImageMaker.getState();
  const isReference = s.draft.references.some((r) => r.node === node.id);
  return {
    open: { label: "Afficher", Icon: Maximize2, run: () => void s.selectNode(node.id) },
    edit: {
      label: "Retoucher",
      Icon: Wand2,
      run: () => {
        void s.selectNode(node.id);
        s.set({ panel: "edit" });
      },
    },
    variation: {
      label: "Créer des variantes",
      Icon: Repeat2,
      run: () => {
        void s.selectNode(node.id);
        s.setDraft({ task: "variation", editCount: Math.max(4, s.draft.editCount) });
        s.set({ panel: "edit" });
      },
    },
    reference: {
      label: isReference ? "Retirer des références" : "Utiliser comme référence",
      Icon: ImageUp,
      run: () => s.toggleReference(node.id),
    },
    compare: {
      label: "Comparer avec l'image affichée",
      Icon: Columns2,
      run: () => s.set({ compare: { mode: "slider", other: node.id } }),
    },
    copy: { label: "Copier l'image", Icon: Copy, run: () => void copyImage(node) },
    export: { label: "Exporter…", Icon: Download, run: () => s.set({ dialog: "export", exportNodes: [node.id] }) },
    favorite: {
      label: node.favorite ? "Retirer des favoris" : "Ajouter aux favoris",
      Icon: Heart,
      run: () => void s.toggleFavorite(node.id),
    },
    remove: { label: "Mettre à la Corbeille", Icon: Trash2, run: () => void s.deleteNode(node.id) },
  };
}

function nodeMenu(node: ImageNode): ContextMenuItem[] {
  const a = nodeActions(node);
  const current = useImageMaker.getState().project?.current === node.id;
  const item = (id: keyof typeof a, extra: Partial<Extract<ContextMenuItem, { onSelect: () => void }>> = {}): ContextMenuItem => {
    const { label, Icon, run } = a[id];
    return { id, label, icon: <Icon size={14} />, onSelect: run, ...extra };
  };
  return [
    item("open"),
    item("edit"),
    item("variation"),
    item("reference"),
    item("compare", { disabled: current }),
    item("copy"),
    item("export"),
    item("favorite"),
    { id: "sep", separator: true },
    item("remove", { danger: true }),
  ];
}

export function Dock() {
  const dock = useImageMaker((s) => s.dock);
  const open = useImageMaker((s) => s.dockOpen);
  const set = useImageMaker((s) => s.set);
  const project = useImageMaker((s) => s.project);
  const allJobs = useImageMaker((s) => s.jobs);
  const jobs = useMemo(() => allJobs.filter((j) => j.projectId === project?.id), [allJobs, project?.id]);
  const active = jobs.filter((j) => j.status === "running" || j.status === "waiting").length;
  const failed = jobs.filter((j) => j.status === "failed").length;
  const generated = project?.nodes.filter((n) => n.provider !== null).length ?? 0;

  return (
    <section aria-label="Historique, générations et file" className="flex shrink-0 flex-col border-t border-border">
      <div className="flex h-10 items-center gap-3 px-3">
        <Segmented
          label="Contenu du bas"
          value={dock}
          onChange={(value) => set({ dock: value, dockOpen: true })}
          options={[
            { value: "history", label: `Historique · ${project?.nodes.length ?? 0}` },
            { value: "generations", label: `Générations · ${generated}` },
            {
              value: "queue",
              label: (
                <span className="flex items-center gap-1.5">
                  File
                  {active > 0 && <Loader2 size={12} className="animate-spin text-accent" />}
                  {active > 0 ? ` · ${active}` : ""}
                  {failed > 0 && <AlertTriangle size={12} className="text-danger" aria-label={`${failed} en échec`} />}
                </span>
              ),
            },
          ]}
        />
        <div className="flex-1" />
        <DockActions />
        <button
          type="button"
          aria-label={open ? "Replier le bas" : "Déplier le bas"}
          aria-expanded={open}
          onClick={() => set({ dockOpen: !open })}
          className={cn("rounded-md p-1.5 text-text-muted hover:bg-surface-2 hover:text-text", focusRing)}
        >
          {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
      </div>
      {open && (
        <div className="h-[clamp(112px,24vh,176px)] min-h-0 border-t border-border">
          {dock === "history" ? <HistoryTree /> : dock === "generations" ? <Generations /> : <Queue jobs={jobs} />}
        </div>
      )}
    </section>
  );
}

/** Actions de lot quand plusieurs versions sont choisies (Ctrl+clic). */
function DockActions() {
  const selected = useImageMaker((s) => s.selected);
  const dock = useImageMaker((s) => s.dock);
  const s = useImageMaker.getState();
  if (dock === "queue") {
    return (
      <Button size="sm" variant="ghost" onClick={() => void s.clearJobs()}>
        Retirer les tâches finies
      </Button>
    );
  }
  if (selected.length === 0) {
    return <span className="hidden text-caption text-text-subtle lg:inline">Ctrl+clic : choisir plusieurs images</span>;
  }
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-footnote text-text-muted">{selected.length} choisie(s)</span>
      <Button size="sm" variant="ghost" icon={<Download size={14} />} onClick={() => s.set({ dialog: "export", exportNodes: selected })}>
        Exporter
      </Button>
      <Button size="sm" variant="ghost" onClick={() => void s.localBatch(selected, { type: "upscale", factor: 2, sharpen: true })}>
        Agrandir ×2
      </Button>
      <Button size="sm" variant="ghost" onClick={() => void batchBackground(selected)}>
        Retirer les fonds (IA)
      </Button>
      <Button size="sm" variant="ghost" aria-label="Vider le choix" icon={<X size={14} />} onClick={() => s.set({ selected: [] })} />
    </div>
  );
}

/** Retrait du fond sur plusieurs images : une demande par image, suivies dans la file. */
async function batchBackground(nodes: string[]) {
  const s = useImageMaker.getState();
  let sent = 0;
  for (const source of nodes) {
    const jobs = await s.submit({ type: "background", source, action: "remove" }, "background");
    if (!jobs) break;
    sent += jobs.length;
  }
  if (sent > 0) {
    s.set({ dock: "queue", selected: [] });
    s.notify("info", `${sent} demande(s) de détourage dans la file.`);
  }
}

function useNodeClick() {
  return (node: ImageNode, event: MouseEvent) => {
    const s = useImageMaker.getState();
    if (event.ctrlKey || event.metaKey) {
      const has = s.selected.includes(node.id);
      s.set({ selected: has ? s.selected.filter((id) => id !== node.id) : [...s.selected, node.id] });
      return;
    }
    s.set({ selected: [] });
    void s.selectNode(node.id);
  };
}

function Thumb({ node, size, current, selected }: { node: ImageNode; size: number; current: boolean; selected: boolean }) {
  return (
    <span
      className={cn(
        "relative block overflow-hidden rounded-sm border-2 bg-surface-2",
        current ? "border-accent" : selected ? "border-info" : "border-transparent",
      )}
      style={{ width: size, height: size }}
    >
      <img src={convertFileSrc(node.thumb)} alt="" loading="lazy" draggable={false} className="size-full object-cover" />
      {node.favorite && <Heart size={10} className="absolute right-0.5 top-0.5 fill-accent text-accent" aria-label="Favori" />}
      {node.provider && (
        <span className="absolute bottom-0.5 left-0.5 rounded-xs bg-bg/80 px-1 text-[10px] leading-3 text-text-muted" aria-hidden>
          IA
        </span>
      )}
    </span>
  );
}

function HistoryTree() {
  const project = useImageMaker((s) => s.project);
  const selected = useImageMaker((s) => s.selected);
  const references = useImageMaker((s) => s.draft.references);
  const onClick = useNodeClick();
  const [menu, setMenu] = useState<{ x: number; y: number; node: ImageNode } | null>(null);
  const nodes = useMemo(() => project?.nodes ?? [], [project]);
  const { cells, rows, cols } = useMemo(() => layoutTree(nodes), [nodes]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const place = useMemo(() => new Map(cells.map((c) => [c.id, c])), [cells]);

  if (nodes.length === 0) {
    return <p className="p-4 text-footnote text-text-muted">Les versions apparaîtront ici, reliées à celle dont elles partent.</p>;
  }

  const x = (col: number) => 12 + col * CELL_W;
  const y = (row: number) => 8 + row * CELL_H;

  return (
    <div className="size-full overflow-auto" role="tree" aria-label="Arbre des versions">
      <div className="relative" style={{ width: x(cols) + 12, height: y(rows) + 8 }}>
        <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden>
          {cells
            .filter((c) => c.parent)
            .map((c) => {
              const p = place.get(c.parent!);
              if (!p) return null;
              const x1 = x(p.col) + THUMB;
              const y1 = y(p.row) + THUMB / 2;
              const x2 = x(c.col);
              const y2 = y(c.row) + THUMB / 2;
              const mid = x1 + (x2 - x1) / 2;
              return (
                <path
                  key={c.id}
                  d={y1 === y2 ? `M${x1} ${y1}H${x2}` : `M${x1} ${y1}H${mid}V${y2}H${x2}`}
                  className="fill-none stroke-border-strong"
                  strokeWidth={1.5}
                />
              );
            })}
        </svg>
        {cells.map((c) => {
          const node = byId.get(c.id)!;
          const current = project?.current === node.id;
          return (
            <button
              key={c.id}
              type="button"
              role="treeitem"
              aria-selected={current}
              aria-label={`${node.label}, ${KIND_LABELS[node.kind]}, ${node.width} × ${node.height}`}
              onClick={(e) => onClick(node, e)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, node });
              }}
              className={cn("group absolute flex flex-col items-center gap-0.5 rounded-sm", focusRing)}
              style={{ left: x(c.col), top: y(c.row), width: THUMB }}
            >
              <Thumb node={node} size={THUMB} current={current} selected={selected.includes(node.id)} />
              <span className="w-[68px] truncate text-center text-[10px] leading-3 text-text-subtle group-hover:text-text-muted">
                {references.some((r) => r.node === node.id) ? "Référence" : KIND_LABELS[node.kind]}
              </span>
            </button>
          );
        })}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} label={menu.node.label} items={nodeMenu(menu.node)} onClose={() => setMenu(null)} />}
    </div>
  );
}

function Generations() {
  const project = useImageMaker((s) => s.project);
  const selected = useImageMaker((s) => s.selected);
  const onClick = useNodeClick();
  const [menu, setMenu] = useState<{ x: number; y: number; node: ImageNode } | null>(null);
  const nodes = useMemo(() => (project?.nodes ?? []).filter((n) => n.provider !== null).reverse(), [project]);
  if (nodes.length === 0) {
    return <p className="p-4 text-footnote text-text-muted">Les images produites par l'IA s'afficheront ici, les plus récentes en premier.</p>;
  }
  return (
    <div className="flex size-full gap-2 overflow-x-auto p-3">
      {nodes.map((node) => (
        <div key={node.id} className="group relative shrink-0">
          <button
            type="button"
            aria-label={`${node.label} : ${node.prompt ?? ""}`}
            onClick={(e) => onClick(node, e)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, node });
            }}
            className={cn("block rounded-sm", focusRing)}
          >
            <Thumb node={node} size={112} current={project?.current === node.id} selected={selected.includes(node.id)} />
          </button>
          <div className="pointer-events-none absolute inset-x-0.5 bottom-0.5 flex translate-y-1 justify-center gap-0.5 opacity-0 transition-[opacity,transform] duration-[140ms] group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100">
            {(["edit", "variation", "reference", "export"] as const).map((id) => {
              const { label, Icon, run } = nodeActions(node)[id];
              return (
                <button
                  key={id}
                  type="button"
                  aria-label={label}
                  onClick={run}
                  className={cn("glass rounded-sm p-1 text-text-muted hover:text-text", focusRing)}
                >
                  <Icon size={12} />
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {menu && <ContextMenu x={menu.x} y={menu.y} label={menu.node.label} items={nodeMenu(menu.node)} onClose={() => setMenu(null)} />}
    </div>
  );
}

const FIXES: Record<string, { label: string; Icon: typeof KeyRound }> = {
  key: { label: "Ouvrir les connexions", Icon: KeyRound },
  credit: { label: "Voir le compte du fournisseur", Icon: KeyRound },
  moderation: { label: "Reformuler", Icon: PenLine },
  model: { label: "Changer de modèle", Icon: Layers },
  input: { label: "Reprendre la demande", Icon: PenLine },
};

function Queue({ jobs }: { jobs: ImageJob[] }) {
  const s = useImageMaker.getState();
  const ordered = [...jobs].reverse();
  if (ordered.length === 0) {
    return <p className="p-4 text-footnote text-text-muted">Aucune demande en cours. Elles s'affichent ici, avec leur état et leur coût.</p>;
  }
  return (
    <ul className="size-full divide-y divide-border overflow-y-auto" aria-live="polite">
      {ordered.map((job) => {
        const look = JOB_LABELS[job.status];
        const fix = job.failure ? FIXES[job.failure] : undefined;
        const finished = job.status === "completed" || job.status === "failed" || job.status === "cancelled";
        return (
          <li key={job.id} className="flex items-start gap-3 px-3 py-2">
            <span className="mt-0.5 w-20 shrink-0">
              <Badge tone={look.tone === "neutral" ? "neutral" : look.tone}>
                {job.status === "running" && <Loader2 size={10} className="animate-spin" />}
                {look.label}
              </Badge>
            </span>
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="truncate text-body-sm text-text">
                {job.label}
                <span className="ml-2 text-footnote text-text-subtle">
                  {PROVIDER_NAMES[job.provider]} · {job.model}
                </span>
              </p>
              {job.settings.prompt && <p className="truncate text-footnote text-text-muted">« {job.settings.prompt} »</p>}
              {job.error && (
                <p role="alert" className="text-footnote text-danger">
                  {job.error}
                </p>
              )}
              <p className="text-caption text-text-subtle">
                {job.startedAt && job.finishedAt
                  ? `${elapsed(job.startedAt, job.finishedAt)} · `
                  : job.startedAt
                    ? `commencée ${ago(job.startedAt)} · `
                    : `demandée ${ago(job.createdAt)} · `}
                {job.status === "completed" ? usageText(job.usage) : job.status === "waiting" ? "attend une place chez le fournisseur" : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {!finished && (
                <Button size="sm" variant="ghost" onClick={() => void s.cancelJob(job.id)}>
                  Annuler
                </Button>
              )}
              {job.status === "completed" && job.results[0] && (
                <Button size="sm" variant="ghost" onClick={() => void s.selectNode(job.results[0]!)}>
                  Afficher
                </Button>
              )}
              {fix && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<fix.Icon size={14} />}
                  onClick={() => {
                    if (job.failure === "key") s.set({ dialog: "connections" });
                    else if (job.failure === "credit") void openUrl(PROVIDER_SITES[job.provider].url);
                    else s.restoreJob(job);
                  }}
                >
                  {fix.label}
                </Button>
              )}
              {(job.status === "failed" || job.status === "cancelled") && (
                <Button size="sm" icon={<RefreshCw size={14} />} onClick={() => void s.retryJob(job.id)}>
                  Réessayer
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
