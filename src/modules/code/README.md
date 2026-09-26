# Module `code`

Éditeur de projet façon VS Code : arborescence de fichiers, onglets, lecture du code avec coloration syntaxique (CodeMirror 6, ~35 langages), et panneau de conversation à droite qui pilote la même CLI que le module Chat.

- **Backend** : plugin `code` (`src-tauri/src/modules/code/`).
- **Commandes** : `list_dir`, `read_file`, `write_file` (atomique, auditée), `project_info`, `search_files`, `watch_root`, `unwatch_root`, `search_text`, `terminal_open` (auditée), `terminal_write`, `terminal_resize`, `terminal_close`.
- **Événement émis** : `code:fs-changed` — l'arborescence, les onglets non modifiés et l'aperçu se mettent à jour seuls quand une IA crée ou modifie des fichiers (dépendances et builds ignorés).
- **Éditeur et arborescence** : `@/core/editor` (`CodeEditor`, `FileTree`), partagés avec Mod Studio ; ce module fournit la lecture (`list_dir`), la surveillance et les états vide / binaire.
- **Panneaux redimensionnables** : arborescence, éditeur, aperçu et assistant (`ResizeHandle`, tailles mémorisées ; double clic = taille par défaut).
- **Aperçu** (bouton globe) : serveur de test lancé par l'agent (pastille verte quand il répond) ou page HTML ouverte / créée, dans une colonne dédiée (`@/core/preview`).
- **Services consommés** : moteur core (`useChat`, `useAdapters`), composants `@/core/chat`.
- **Entrées** : dossier choisi par l'utilisateur, ou passé par un autre module via `useUiStore.openModule("code", { cwd, file? })` (`file` : ouvert dans un onglet une fois le dossier chargé).
- **Services fournis** : `code.project` (détection de projet), `code.open` (ouvrir un fichier ou dossier cité dans une réponse d'IA).
- **Drag & drop** :
  - depuis l'arborescence vers le composer → le fichier devient une **cible** de modification (`FILE_DRAG_MIME`) ;
  - depuis l'explorateur Windows vers la fenêtre → les fichiers deviennent des **pièces jointes** (`useOsFileDrop`).
- **Conversations** : `origin: "code"`, rattachées à la racine du projet. **Aucune n'est créée à l'ouverture** d'un dossier ou d'un fichier : la première est créée au premier message. Elles n'apparaissent pas dans le module Chat.
- **Édition** : modification directe, `Ctrl+S` pour enregistrer, palette `Ctrl+P`. Les fichiers ouverts non modifiés sont relus après chaque outil de l'assistant.
- **Recherche dans le projet** (`Ctrl+Maj+F`, ou la loupe en tête de la colonne de gauche) : texte cherché dans tous les fichiers (`search.rs`), options casse / mot entier / expression régulière, filtres « inclure » et « exclure » (`*.ts`, `src/`, `**/generated/**`). Résultats groupés par fichier ; un clic ouvre le fichier et sélectionne la ligne, `↑` `↓` passent d'un résultat à l'autre. Dépendances, builds, dossiers cachés, fichiers binaires et de plus de 2 Mo sont sautés ; au-delà de 2 000 occurrences ou de 10 s, la liste est marquée tronquée. Une nouvelle recherche interrompt la précédente.
- **Terminal** (``Ctrl+` ``, ou le bouton terminal de la barre d'onglets) : PowerShell 7 (ou Windows PowerShell) ouvert dans le dossier du projet, sous l'éditeur, hauteur réglable, plusieurs onglets (`terminal.rs`, xterm.js, couleurs du preset actif). Ce qui s'y tape part directement au shell ; aucune IA n'y écrit. Les terminaux continuent de tourner quand on change de module ou qu'on masque le panneau ; ils s'arrêtent (avec ce qu'ils ont lancé) quand on les ferme ou qu'on ouvre un autre projet. `Ctrl+C` copie la sélection s'il y en a une, sinon interrompt la commande ; Entrée relance un shell terminé. Voir l'[ADR 0011](../../../docs/adr/0011-code-terminal-and-project-search.md).
- **Slots exposés** : `code.editor.footer`.
