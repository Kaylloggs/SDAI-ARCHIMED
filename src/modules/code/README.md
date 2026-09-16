# Module `code`

Éditeur de projet façon VS Code : arborescence de fichiers, onglets, lecture du code avec coloration syntaxique (CodeMirror 6, ~35 langages), et panneau de conversation à droite qui pilote la même CLI que le module Chat.

- **Backend** : plugin `code` (`src-tauri/src/modules/code/`).
- **Commandes** : `list_dir`, `read_file`, `write_file` (atomique, auditée), `project_info`, `search_files`.
- **Services consommés** : moteur core (`useChat`, `useAdapters`), composants `@/core/chat`.
- **Entrées** : dossier choisi par l'utilisateur, ou passé par un autre module via `useUiStore.openModule("code", { cwd })`.
- **Drag & drop** :
  - depuis l'arborescence vers le composer → le fichier devient une **cible** de modification (`FILE_DRAG_MIME`) ;
  - depuis l'explorateur Windows vers la fenêtre → les fichiers deviennent des **pièces jointes** (`useOsFileDrop`).
- **Conversations** : `origin: "code"`, rattachées à la racine du projet. **Aucune n'est créée à l'ouverture** d'un dossier ou d'un fichier : la première est créée au premier message. Elles n'apparaissent pas dans le module Chat.
- **Édition** : modification directe, `Ctrl+S` pour enregistrer, palette `Ctrl+P`. Les fichiers ouverts non modifiés sont relus après chaque outil de l'assistant.
- **Slots exposés** : `code.editor.footer`.
