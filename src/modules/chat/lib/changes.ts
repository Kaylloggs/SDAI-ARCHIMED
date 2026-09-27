/** Libellés des états git (core/workspace.rs). */
export const STATUS_LABEL: Record<string, string> = {
  modified: "modifié",
  added: "ajouté",
  deleted: "supprimé",
  renamed: "renommé",
  untracked: "nouveau",
  conflicted: "conflit",
};

/** Demandes envoyées à l'agent depuis le panneau des modifications. */
export const ASK = {
  review:
    "Relis les modifications en cours (git diff, fichiers non suivis compris) : signale les bugs, les oublis, les risques et ce qui mérite d'être amélioré. Ne modifie rien.",
  commit:
    "Crée un commit git avec toutes les modifications en cours : vérifie d'abord le diff, puis écris un message de commit clair qui suit les conventions du dépôt. Ne pousse pas.",
  pr: "Ouvre une pull request pour ces modifications : si on est sur la branche principale, crée d'abord une branche au nom explicite ; committe ce qui ne l'est pas, pousse la branche, puis crée la pull request (gh pr create) avec un titre et une description qui résument le changement. Donne-moi le lien.",
  init: "Initialise un dépôt git dans ce dossier avec un .gitignore adapté au projet, puis fais un premier commit.",
} as const;

/** Chemin absolu d'un fichier du dépôt, avec le séparateur de la racine. */
export function joinPath(root: string, relative: string): string {
  const separator = root.includes("\\") ? "\\" : "/";
  const base = root.replace(/[\\/]+$/, "");
  return `${base}${separator}${relative.split("/").join(separator)}`;
}
