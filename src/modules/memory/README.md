# Module `memory`

Mémoire intégrée : ARCHIMED retient le travail fait avec les IA et le leur rappelle. Tout reste local.

- **Backend** : plugin `memory` (`src-tauri/src/modules/memory/`).
- **Commandes** : `list_notes`, `add_note`, `update_note`, `delete_note`, `journal`, `record_turn`, `clear_journal`, `get_settings`, `set_settings`, `build_context`, `preview_context`.
- **Stockage** : `%APPDATA%\com.sdai.archimed\modules\memory\` — `notes.json`, `journal.jsonl` (une ligne par réponse), `settings.json`.

## Fonctionnement
1. **Journal** (slot `app.background`, `slots/MemoryRecorder.tsx`) : à chaque événement `engine.turn.completed`, la demande, un résumé de la réponse, les fichiers modifiés et les commandes réussies sont ajoutés au journal (Chat et Code).
2. **Notes** : durables, globales ou rattachées à un dossier de projet (elles valent aussi pour ses sous-dossiers). Sources : ajout manuel, bouton « Mémoriser » sous une réponse (slot `chat.message.actions`), ou lignes `📌 Mémoire : …` écrites par l'IA.
3. **Rappel** (service `memory.context`, consommé par `useChat`) : au **premier message** d'une conversation, un bloc « Mémoire ARCHIMED » (notes du projet, notes globales, 5 derniers travaux, 3 000 caractères max) est ajouté avant le message. Il invite l'IA à signaler ce qui mérite d'être retenu par une ligne `📌 Mémoire :`.

## Réglages
- **Rappeler la mémoire aux IA** (`inject`) et **Tenir le journal** (`capture`), activés par défaut.
- Onglet « Ce que l'IA reçoit » : aperçu exact du bloc pour un projet.

## Sans dépendance entre modules
Le core ne connaît que le nom du service `memory.context` et l'événement de bus. Module désactivé : aucune injection, aucun journal.
