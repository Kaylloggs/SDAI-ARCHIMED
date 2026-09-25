import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Crop,
  Eraser,
  Expand,
  ImagePlus,
  Layers,
  Palette,
  PlugZap,
  UserRound,
  Replace,
  Scaling,
  Sparkles,
  Download,
  WandSparkles,
} from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Button } from "@/design-system/primitives";
import { run } from "../actions";
import { usable } from "../lib/capabilities";
import { PROVIDERS } from "../lib/format";
import { currentNode, useImageMaker, type EditTask } from "../store";
import { AiPanel } from "./AiPanel";
import { Canvas } from "./Canvas";
import { Dock } from "./Dock";
import { ModelPicker } from "./ModelPicker";
import { ToolOptions, ToolRail, useStudioShortcuts } from "./Tools";
import { focusRing } from "./ui";

export function Studio() {
  const panel = useImageMaker((s) => s.panel);
  const submit = useCallback(() => void run(panel === "edit" ? "edit" : "create"), [panel]);
  useStudioShortcuts(submit);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <ToolRail />
        <div className="relative flex min-w-0 flex-1 flex-col">
          <ToolOptions />
          <div className="relative min-h-0 flex-1">
            <Canvas />
            <QuickActions />
          </div>
        </div>
        <AiPanel />
      </div>
      <Dock />
    </div>
  );
}

function ProjectName() {
  const name = useImageMaker((s) => s.project?.name ?? "");
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);
  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void useImageMaker.getState().renameProject(value).then(() => setValue(useImageMaker.getState().project?.name ?? value))}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setValue(name);
          e.currentTarget.blur();
        }
      }}
      aria-label="Nom du projet"
      className={cn(
        "selectable h-8 min-w-0 max-w-64 flex-1 truncate rounded-md border border-transparent bg-transparent px-2 text-body font-medium text-text",
        "hover:border-border focus:border-accent",
        focusRing,
      )}
    />
  );
}

function TopBar() {
  const s = useImageMaker();
  const node = currentNode(s);
  const connected = PROVIDERS.filter((p) => usable(s.statuses[p]?.state)).length;
  const [sending, setSending] = useState(false);
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2">
      <Button size="sm" variant="ghost" icon={<ArrowLeft size={14} />} onClick={s.closeProject}>
        Projets
      </Button>
      <div className="h-5 w-px bg-border" aria-hidden />
      <ProjectName />
      {node && (
        <span className="hidden whitespace-nowrap text-footnote tabular-nums text-text-subtle lg:inline">
          {node.width} × {node.height}
        </span>
      )}
      <div className="flex-1" />
      <ModelPicker />
      <Button
        size="md"
        variant="ghost"
        aria-label={`Connexions : ${connected} sur ${PROVIDERS.length}`}
        icon={<PlugZap size={14} className={connected > 0 ? "text-success" : "text-warning"} />}
        onClick={() => s.set({ dialog: "connections" })}
      >
        <span className="hidden lg:inline">Connexions</span>
        <span className="tabular-nums text-text-subtle">
          {connected}/{PROVIDERS.length}
        </span>
      </Button>
      <Button
        size="md"
        variant="ghost"
        aria-label="Créer avec votre compte"
        icon={<UserRound size={14} />}
        onClick={() => s.set({ dialog: "account" })}
      >
        <span className="hidden lg:inline">Compte</span>
      </Button>
      <Button
        size="md"
        variant="ghost"
        aria-label="Exporter"
        icon={<Download size={14} />}
        disabled={!node}
        onClick={() => node && s.set({ dialog: "export", exportNodes: s.selected.length > 0 ? s.selected : [node.id] })}
      >
        <span className="hidden lg:inline">Exporter</span>
      </Button>
      <Button
        size="md"
        variant="primary"
        icon={<ImagePlus size={14} />}
        disabled={sending}
        onClick={() => {
          setSending(true);
          void run("create").finally(() => setSending(false));
        }}
      >
        Générer
      </Button>
    </header>
  );
}

type Quick = { label: string; Icon: typeof Crop; run: () => void };

/** Actions rapides selon le contexte : avec une sélection, sur l'image, ou sur une toile vide. */
function QuickActions() {
  const node = useImageMaker((s) => currentNode(s));
  const mask = useImageMaker((s) => s.mask);
  useImageMaker((s) => s.maskRevision);
  const tool = useImageMaker((s) => s.tool);
  const comparing = useImageMaker((s) => s.compare.mode !== "off");
  if (!node || comparing || tool === "crop") return null;
  const s = useImageMaker.getState();
  const edit = (task: EditTask, extra: Parameters<typeof s.setDraft>[0] = {}) => () => {
    s.setDraft({ task, ...extra });
    s.set({ panel: "edit", focusPrompt: s.focusPrompt + 1 });
  };
  const selected = Boolean(mask && !mask.isEmpty);
  const actions: Quick[] = selected
    ? [
        { label: "Remplacer", Icon: Replace, run: edit("inpaint", { inpaintMode: "replace" }) },
        { label: "Effacer", Icon: Eraser, run: edit("inpaint", { inpaintMode: "remove" }) },
        { label: "Ajouter", Icon: ImagePlus, run: edit("inpaint", { inpaintMode: "add" }) },
        { label: "Modifier", Icon: WandSparkles, run: edit("inpaint", { inpaintMode: "modify" }) },
        {
          label: "Recadrer ici",
          Icon: Crop,
          run: () => {
            const b = mask?.bounds();
            if (b) void s.local({ type: "crop", ...b });
          },
        },
      ]
    : [
        {
          label: "Générer",
          Icon: ImagePlus,
          run: () => s.set({ panel: "create", focusPrompt: s.focusPrompt + 1 }),
        },
        { label: "Modifier", Icon: WandSparkles, run: edit("edit") },
        { label: "Fond", Icon: Eraser, run: edit("background") },
        { label: "Étendre", Icon: Expand, run: edit("outpaint") },
        { label: "Améliorer", Icon: Sparkles, run: edit("upscale") },
        { label: "Style", Icon: Palette, run: edit("restyle") },
        { label: "Variantes", Icon: Layers, run: edit("variation", { editCount: Math.max(4, s.draft.editCount) }) },
        { label: "Recadrer", Icon: Crop, run: () => s.setTool("crop") },
        { label: "Taille", Icon: Scaling, run: () => s.set({ panel: "image" }) },
      ];
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
      <div
        role="toolbar"
        aria-label={selected ? "Actions sur la sélection" : "Actions sur l'image"}
        className="glass pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full p-1"
      >
        {actions.map(({ label, Icon, run: act }) => (
          <button
            key={label}
            type="button"
            onClick={act}
            className={cn(
              "flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-footnote text-text-muted transition-colors hover:bg-surface-3 hover:text-text",
              focusRing,
            )}
          >
            <Icon size={14} strokeWidth={1.75} />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
