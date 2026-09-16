import { codeApi, type ProjectInfo } from "../api";

/**
 * Service `code.project` exposé aux autres modules (guidelines.md §4.6).
 * Permet au chat de savoir si un dossier est un projet, sans importer ce module.
 */
export async function projectInfo(path: string): Promise<ProjectInfo> {
  return codeApi.projectInfo(path);
}

export type { ProjectInfo };
