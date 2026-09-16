import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import type { SlotContext } from "@/core/modules";
import { useUiStore } from "@/core/stores/ui.store";
import { Button } from "@/design-system/primitives";
import { plannerApi } from "../api";
import { usePlannerStore } from "../store";
import type { RoadmapDoc } from "../types";

/**
 * Contribution au slot `code.editor.footer` : si le projet ouvert contient un
 * roadmap.md, propose de le suivre dans un tableau (ou d'ouvrir le tableau existant).
 */
export default function RoadmapFooter({ root }: SlotContext) {
  const [path, setPath] = useState<string | null>(null);
  const [doc, setDoc] = useState<RoadmapDoc | null>(null);
  const { boards, loaded, load, createBoard } = usePlannerStore();
  const openModule = useUiStore((s) => s.openModule);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  useEffect(() => {
    let alive = true;
    setPath(null);
    setDoc(null);
    if (!root) return;
    plannerApi
      .findRoadmap(root)
      .then(async (found) => {
        if (!alive || !found) return;
        setPath(found);
        const parsed = await plannerApi.readRoadmap(found).catch(() => null);
        if (alive) setDoc(parsed);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [root]);

  if (!path || !doc || doc.total === 0) return null;

  const board = boards.find((b) => b.roadmapPath?.toLowerCase() === path.toLowerCase());
  const folder = root?.split(/[\\/]/).filter(Boolean).at(-1) ?? "Projet";

  return (
    <div className="flex shrink-0 items-center gap-3 border-t border-border px-4 py-2">
      <FileText size={14} strokeWidth={1.75} className="shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-footnote">
          <span className="font-medium">Roadmap détectée</span> · {doc.done}/{doc.total} tâches terminées
        </p>
        <span className="mt-1 block h-1 overflow-hidden rounded-full bg-surface-3">
          <span className="block h-full rounded-full bg-accent" style={{ width: `${(doc.done / doc.total) * 100}%` }} />
        </span>
      </div>
      <Button
        size="sm"
        variant={board ? "secondary" : "primary"}
        onClick={async () => {
          const boardId = board?.id ?? (await createBoard({ name: folder, roadmapPath: path, projectRoot: root ?? null }));
          openModule("planner", { boardId });
        }}
      >
        {board ? "Ouvrir le tableau" : "Suivre dans le Planner"}
      </Button>
    </div>
  );
}
