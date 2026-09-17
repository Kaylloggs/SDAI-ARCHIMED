# Module `memory`

Mémoire des IA : les informations que **l'utilisateur** saisit (préférences, conventions, contexte d'un projet) et qu'il choisit de transmettre aux IA. Rien n'est enregistré automatiquement.

- **Backend** : plugin `memory` (`src-tauri/src/modules/memory/`).
- **Commandes** : `list_notes`, `add_note`, `update_note` (texte, activation, portée), `delete_note`, `get_settings`, `set_settings`, `build_context`, `preview_context`.
- **Stockage** : `%APPDATA%\com.sdai.archimed\modules\memory\` — `notes.json`, `settings.json`.

## Fonctionnement
- Chaque information a une **portée** : partout, ou un dossier de projet (elle vaut aussi pour ses sous-dossiers).
- Chaque information a un **interrupteur** : active (transmise) ou mise de côté (conservée, non transmise).
- Un interrupteur général coupe toute transmission.
- **Transmission** (service `memory.context`, consommé par `useChat`) : au premier message d'une conversation (Chat ou Code), les informations actives qui s'appliquent au dossier de travail sont ajoutées avant le message, dans un bloc « Mémoire ARCHIMED » (4 000 caractères max).
- **Aperçu** : le bloc exact reçu par une IA, pour un projet donné.

## Historique
La v0.1 tenait un journal automatique des réponses : retiré à la demande de l'utilisateur. Le fichier `journal.jsonl` est supprimé au démarrage.

## Sans dépendance entre modules
Le core ne connaît que le nom du service `memory.context`. Module désactivé : aucune transmission.
