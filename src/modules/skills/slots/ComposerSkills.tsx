import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Boxes, Loader2, Search } from "lucide-react";
import { cn } from "@/core/lib/cn";
import type { SlotContext } from "@/core/modules";
import { useUiStore } from "@/core/stores/ui.store";
import { Tooltip } from "@/design-system/primitives";
import { popIn } from "@/design-system/motion";
import { skillsApi, type Skill } from "../api";
import { skillSnippet } from "../lib/snippet";

const PANEL_WIDTH = 360;
const MARGIN = 8;

/** Bouton « Skills » du composer (slot `chat.composer.actions`). */
export default function ComposerSkills({ adapter, insertText }: SlotContext) {
  const [open, setOpen] = useState(false);
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const openModule = useUiStore((s) => s.openModule);

  // Liste relue à chaque ouverture : un import dans le module Skills est visible aussitôt.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHighlight(0);
    setError(null);
    skillsApi
      .list()
      .then(setSkills)
      .catch((e: unknown) => setError((e as { message?: string }).message ?? "Skills indisponibles"));
  }, [open]);

  useLayoutEffect(() => {
    if (open) setAnchor(trigger.current?.getBoundingClientRect() ?? null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || trigger.current?.contains(target)) return;
      setOpen(false);
    };
    const closeOnResize = () => setOpen(false);
    window.addEventListener("mousedown", close, true);
    window.addEventListener("resize", closeOnResize);
    return () => {
      window.removeEventListener("mousedown", close, true);
      window.removeEventListener("resize", closeOnResize);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = [...(skills ?? [])].sort(
      (a, b) => Number(b.targets.includes(adapter ?? "")) - Number(a.targets.includes(adapter ?? "")) || a.name.localeCompare(b.name),
    );
    if (!needle) return list;
    return list.filter(
      (skill) => skill.name.toLowerCase().includes(needle) || skill.description.toLowerCase().includes(needle),
    );
  }, [skills, query, adapter]);

  if (!insertText) return null;

  const choose = (skill: Skill) => {
    insertText(skillSnippet(skill, adapter));
    setOpen(false);
  };

  // Le composer est en bas de l'écran : le panneau s'ouvre au-dessus du bouton.
  const position = anchor
    ? {
        left: Math.max(MARGIN, Math.min(anchor.left, window.innerWidth - PANEL_WIDTH - MARGIN)),
        bottom: window.innerHeight - anchor.top + MARGIN,
      }
    : null;

  return (
    <>
      <Tooltip label="Utiliser un skill" side="bottom">
        <button
          ref={trigger}
          type="button"
          aria-label="Utiliser un skill"
          aria-expanded={open}
          aria-haspopup="listbox"
          onClick={() => setOpen((value) => !value)}
          className={cn(
            "flex size-7 items-center justify-center rounded-sm transition-colors",
            open ? "bg-surface-2 text-text" : "text-text-subtle hover:bg-surface-2 hover:text-text",
          )}
        >
          <Boxes size={14} strokeWidth={1.75} />
        </button>
      </Tooltip>

      {createPortal(
        <AnimatePresence>
          {open && position && (
            <motion.div
              ref={panel}
              variants={popIn}
              initial="hidden"
              animate="visible"
              exit="hidden"
              style={{ position: "fixed", left: position.left, bottom: position.bottom, width: PANEL_WIDTH, zIndex: 55 }}
              className="glass flex max-h-96 flex-col rounded-md p-1"
            >
              <label className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2 text-text-subtle">
                <Search size={13} strokeWidth={1.75} />
                <input
                  autoFocus
                  value={query}
                  placeholder="Rechercher un skill…"
                  aria-label="Rechercher un skill"
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setHighlight(0);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      event.preventDefault();
                      const step = event.key === "ArrowDown" ? 1 : -1;
                      setHighlight((index) => (index + step + filtered.length) % Math.max(filtered.length, 1));
                    } else if (event.key === "Enter") {
                      event.preventDefault();
                      const skill = filtered[highlight];
                      if (skill) choose(skill);
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      setOpen(false);
                      trigger.current?.focus();
                    }
                  }}
                  className="h-full min-w-0 flex-1 bg-transparent text-body-sm text-text outline-none placeholder:text-text-subtle"
                />
              </label>

              <div role="listbox" aria-label="Skills" className="min-h-0 flex-1 overflow-y-auto py-1">
                {error && <p className="px-2 py-3 text-footnote text-danger">{error}</p>}
                {!error && skills === null && (
                  <p className="flex items-center gap-2 px-2 py-3 text-footnote text-text-subtle">
                    <Loader2 size={13} className="animate-spin" /> Chargement…
                  </p>
                )}
                {!error && skills !== null && filtered.length === 0 && (
                  <div className="px-2 py-3 text-footnote text-text-subtle">
                    {skills.length === 0 ? "Aucun skill dans la bibliothèque." : "Aucun résultat."}
                    <button
                      onClick={() => {
                        setOpen(false);
                        openModule("skills", {});
                      }}
                      className="ml-1 text-accent hover:underline"
                    >
                      Gérer les skills
                    </button>
                  </div>
                )}
                {filtered.map((skill, index) => {
                  const native = adapter ? skill.targets.includes(adapter) : false;
                  return (
                    <button
                      key={`${skill.source}:${skill.id}`}
                      role="option"
                      aria-selected={index === highlight}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => choose(skill)}
                      className={cn(
                        "flex w-full flex-col gap-0.5 rounded-sm px-2 py-1.5 text-left transition-colors",
                        index === highlight ? "bg-surface-3" : "",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span className="truncate text-body-sm font-medium text-text">{skill.name}</span>
                        {native && (
                          <span className="shrink-0 rounded-xs bg-accent-soft px-1.5 text-caption text-accent">activé</span>
                        )}
                      </span>
                      {skill.description && (
                        <span className="line-clamp-2 text-caption text-text-subtle">{skill.description}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
