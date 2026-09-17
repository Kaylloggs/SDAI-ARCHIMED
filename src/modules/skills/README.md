# Module `skills`

Gestionnaire de compétences : indexation de la bibliothèque locale, activation/désactivation (jonction NTFS vers le dossier de skills de chaque CLI), import depuis un dossier, ouverture du dossier pour import en masse.

- **Backend** : plugin `skills` (`src-tauri/src/modules/skills/`).
- **Commandes** : `list`, `set_enabled`, `import_from_path`, `open_folder`, `library_path`.
- **Événements émis** : `skills.changed`.
- **Slot fourni** : `chat.composer.actions` (`slots/ComposerSkills.tsx`) — bouton « Utiliser un skill » dans la barre de chat (Chat et Code) : recherche, navigation clavier, skills activés pour l'agent en tête. Choisir un skill insère `/nom` pour Claude quand le skill lui est synchronisé, sinon une consigne désignant son `SKILL.md` (fonctionne avec toute CLI).
- **Bibliothèque** : `%APPDATA%\com.sdai.archimed\skills\`.
