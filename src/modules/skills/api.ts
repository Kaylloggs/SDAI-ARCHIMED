import { invokeModule } from "@/core/ipc";

export type SkillSource = "library" | "external";

export type Skill = {
  id: string;
  name: string;
  description: string;
  path: string;
  source: SkillSource;
  enabled: boolean;
  targets: string[];
};

export const skillsApi = {
  list: () => invokeModule<Skill[]>("skills", "list"),
  setEnabled: (id: string, enabled: boolean) =>
    invokeModule<void>("skills", "set_enabled", { id, enabled }),
  openFolder: () => invokeModule<void>("skills", "open_folder"),
  importFromPath: (path: string) => invokeModule<Skill>("skills", "import_from_path", { path }),
  libraryPath: () => invokeModule<string>("skills", "library_path"),
};
