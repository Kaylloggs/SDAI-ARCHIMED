import type { CreateProjectRequest } from "@/core/ipc/bindings/CreateProjectRequest";
import type { License } from "@/core/ipc/bindings/License";
import type { LoaderId } from "@/core/ipc/bindings/LoaderId";
import type { ResolvedVersions } from "@/core/ipc/bindings/ResolvedVersions";
import {
  mainClassProblem,
  modIdProblem,
  nameProblem,
  packageProblem,
  suggestMainClass,
  suggestModId,
  suggestPackage,
} from "../../lib/naming";

/** Saisie de l'assistant, étape après étape. */
export type Draft = {
  name: string;
  author: string;
  description: string;
  modId: string;
  pkg: string;
  mainClass: string;
  /** Champs modifiés à la main : ils ne suivent plus le nom. */
  edited: { modId: boolean; pkg: boolean; mainClass: boolean };
  minecraft: string | null;
  loader: LoaderId | null;
  profileId: string | null;
  versions: ResolvedVersions | null;
  /** `null` = JDK choisi automatiquement à chaque compilation. */
  javaHome: string | null;
  withExample: boolean;
  parentDir: string;
  license: License;
};

export const emptyDraft: Draft = {
  name: "",
  author: "",
  description: "",
  modId: "",
  pkg: "",
  mainClass: "",
  edited: { modId: false, pkg: false, mainClass: false },
  minecraft: null,
  loader: null,
  profileId: null,
  versions: null,
  javaHome: null,
  withExample: true,
  parentDir: "",
  license: "none",
};

/** Recalcule les identifiants dérivés tant que la personne ne les a pas touchés. */
export function withDerived(draft: Draft): Draft {
  const modId = draft.edited.modId ? draft.modId : suggestModId(draft.name);
  return {
    ...draft,
    modId,
    pkg: draft.edited.pkg ? draft.pkg : suggestPackage(draft.author, modId),
    mainClass: draft.edited.mainClass ? draft.mainClass : suggestMainClass(draft.name),
  };
}

export const STEPS = ["Nom", "Identifiants", "Version", "Loader", "Java", "Contenu"] as const;

/** Raison qui bloque l'étape, ou `null`. */
export function stepProblem(step: number, draft: Draft): string | null {
  switch (step) {
    case 0:
      return nameProblem(draft.name);
    case 1:
      return modIdProblem(draft.modId) ?? packageProblem(draft.pkg) ?? mainClassProblem(draft.mainClass);
    case 2:
      return draft.minecraft ? null : "Choisissez une version de Minecraft.";
    case 3:
      if (!draft.loader || !draft.profileId) return "Choisissez un loader pris en charge.";
      return draft.versions ? null : "Les versions du loader ne sont pas encore résolues.";
    case 4:
      return null;
    default:
      return draft.parentDir.trim() ? null : "Choisissez où créer le projet.";
  }
}

export function toRequest(draft: Draft): CreateProjectRequest | null {
  if (!draft.versions) return null;
  return {
    name: draft.name.trim(),
    modId: draft.modId,
    package: draft.pkg,
    mainClass: draft.mainClass,
    author: draft.author.trim(),
    description: draft.description.trim(),
    parentDir: draft.parentDir.trim(),
    versions: draft.versions,
    license: draft.license,
    withExample: draft.withExample,
    javaHome: draft.javaHome,
  };
}
