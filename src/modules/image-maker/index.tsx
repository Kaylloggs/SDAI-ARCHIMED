import { useCallback, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, CheckCircle2, Info, UploadCloud, X } from "lucide-react";
import { useOsFileDrop } from "@/core/chat";
import { cn } from "@/core/lib/cn";
import { enterUp } from "@/design-system/motion";
import { IMAGE_FILE, pasteFrom } from "./clipboard";
import { AccountDialog } from "./components/AccountDialog";
import { ConnectionsDialog } from "./components/ConnectionsDialog";
import { ExportDialog } from "./components/ExportDialog";
import { ProjectList } from "./components/ProjectList";
import { Studio } from "./components/Studio";
import { useImageMaker } from "./store";

export default function ImageMakerModule() {
  const project = useImageMaker((s) => s.project);
  const ready = useImageMaker((s) => s.ready);

  useEffect(() => {
    void useImageMaker.getState().init();
  }, []);

  // Glisser-déposer depuis l'Explorateur : import dans le projet ouvert (ou un nouveau).
  const onDrop = useCallback((paths: string[]) => {
    const images = paths.filter((p) => IMAGE_FILE.test(p));
    if (images.length === 0) {
      useImageMaker.getState().notify("warning", "Formats acceptés : PNG, JPEG, WebP, GIF, BMP, TIFF.");
      return;
    }
    void useImageMaker.getState().importPaths(images);
  }, []);
  const dragging = useOsFileDrop(onDrop);

  // Ctrl+V : une image copiée ailleurs devient une version (hors saisie de texte).
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if ((event.target as Element).closest?.("input, textarea, [contenteditable]")) return;
      void pasteFrom(event);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  return (
    <div className="relative h-full min-h-0">
      {project ? (
        <Studio />
      ) : (
        <div className="h-full overflow-y-auto" aria-busy={!ready}>
          <ProjectList />
        </div>
      )}
      <ConnectionsDialog />
      <AccountDialog />
      <ExportDialog />
      <NoticeToast />
      <AnimatePresence>
        {dragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-accent-soft"
          >
            <p className="glass flex items-center gap-2 rounded-full px-4 py-2 text-body text-text">
              <UploadCloud size={18} className="text-accent" />
              {project ? `Déposer dans « ${project.name} »` : "Déposer pour créer un projet"}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NoticeToast() {
  const notice = useImageMaker((s) => s.notice);
  const Icon = notice?.tone === "success" ? CheckCircle2 : notice?.tone === "info" ? Info : AlertTriangle;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-14 z-30 flex justify-center px-4" role="status" aria-live="polite">
      <AnimatePresence>
        {notice && (
          <motion.div
            key={notice.text}
            variants={enterUp}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="glass pointer-events-auto flex max-w-xl items-start gap-2 rounded-lg px-3 py-2 text-body-sm text-text"
          >
            <Icon
              size={16}
              className={cn(
                "mt-0.5 shrink-0",
                notice.tone === "success" && "text-success",
                notice.tone === "info" && "text-info",
                notice.tone === "warning" && "text-warning",
                notice.tone === "danger" && "text-danger",
              )}
            />
            <span className="min-w-0 flex-1">{notice.text}</span>
            <button
              type="button"
              aria-label="Fermer le message"
              onClick={() => useImageMaker.getState().set({ notice: null })}
              className="rounded-sm p-0.5 text-text-subtle hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
