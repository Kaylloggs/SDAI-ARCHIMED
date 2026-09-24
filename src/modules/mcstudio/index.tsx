import { useEffect, useState } from "react";
import { useSessionStore } from "@/core/engine/session.store";
import { useUiStore } from "@/core/stores/ui.store";
import { ProjectList } from "./components/ProjectList";
import { NewProjectWizard } from "./components/wizard/NewProjectWizard";
import { Workspace } from "./components/workspace/Workspace";
import { useMcStudioStore } from "./store";

export default function McStudioModule() {
  const [creating, setCreating] = useState(false);
  const openId = useMcStudioStore((s) => s.openId);
  const project = useMcStudioStore((s) => s.projects.find((p) => p.id === s.openId) ?? null);

  const handoff = useUiStore((s) => s.moduleParams["mcstudio"]);

  useEffect(() => {
    void useMcStudioStore.getState().refresh();
  }, []);

  // Conversation rouverte depuis l'accueil : sa copie de travail (`…/work/<projet>`)
  // désigne le projet.
  useEffect(() => {
    const conversationId = handoff?.["conversationId"];
    if (typeof conversationId !== "string") return;
    useUiStore.getState().clearModuleParams("mcstudio");
    const conversation = useSessionStore.getState().sessions.find((s) => s.id === conversationId);
    const projectId = conversation?.cwd?.split(/[\\/]/).filter(Boolean).at(-1);
    if (!projectId) return;
    const store = useMcStudioStore.getState();
    store.setFocus({ projectId, conversationId });
    store.open(projectId);
  }, [handoff]);

  if (creating) {
    return (
      <div className="h-full overflow-y-auto">
        <NewProjectWizard onClose={() => setCreating(false)} />
      </div>
    );
  }
  if (openId && project) return <Workspace project={project} />;
  return (
    <div className="h-full overflow-y-auto">
      <ProjectList onCreate={() => setCreating(true)} />
    </div>
  );
}
