# Module `code`

Éditeur de projet façon VS Code : arborescence de fichiers, onglets, lecture du code avec coloration syntaxique (CodeMirror 6, ~35 langages), et panneau de conversation à droite qui pilote la même CLI que le module Chat.

- **Backend** : plugin `code` (`src-tauri/src/modules/code/`).
- **Commandes** : `list_dir`, `read_file`, `project_info`, `search_files`.
- **Services consommés** : moteur core (`useChat`, `useAdapters`), composants `@/core/chat`.
- **Entrées** : dossier choisi par l'utilisateur, ou passé par un autre module via `useUiStore.openModule("code", { cwd })`.
- **Drag & drop** :
  - depuis l'arborescence vers le composer → le fichier devient une **cible** de modification (`FILE_DRAG_MIME`) ;
  - depuis l'explorateur Windows vers la fenêtre → les fichiers deviennent des **pièces jointes** (`useOsFileDrop`).
- **Conversation** : une par racine de projet (`cwd`), réutilisée d'une visite à l'autre et visible aussi dans le module Chat.
- **Lecture seule** pour l'instant : les modifications passent par l'IA, qui demande la permission via les cartes du moteur.
