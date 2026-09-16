# Module `skills`

Gestionnaire de compétences : indexation de la bibliothèque locale, activation/désactivation (jonction NTFS vers le dossier de skills de chaque CLI), import depuis un dossier, ouverture du dossier pour import en masse.

- **Backend** : plugin `skills` (`src-tauri/src/modules/skills/`).
- **Commandes** : `list`, `set_enabled`, `import_from_path`, `open_folder`, `library_path`.
- **Événements émis** : `skills.changed`.
- **Bibliothèque** : `%APPDATA%\com.sdai.archimed\skills\`.
