import { useEffect, useState } from "react";
import { ProjectList } from "./components/ProjectList";
import { NewProjectWizard } from "./components/wizard/NewProjectWizard";
import { Workspace } from "./components/workspace/Workspace";
import { useMcStudioStore } from "./store";

export default function McStudioModule() {
  const [creating, setCreating] = useState(false);
  const openId = useMcStudioStore((s) => s.openId);
  const project = useMcStudioStore((s) => s.projects.find((p) => p.id === s.openId) ?? null);

  useEffect(() => {
    void useMcStudioStore.getState().refresh();
  }, []);

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
