import { memoryApi } from "../api";

/**
 * Service `memory.context` consommé par `useChat` (contrat `PromptContextService`) :
 * bloc de mémoire ajouté au premier message d'une conversation.
 */
export async function buildContext(cwd: string | null): Promise<string | null> {
  return memoryApi.buildContext(cwd);
}
