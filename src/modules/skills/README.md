# Module `skills`

Gestionnaire de compétences : indexation de la bibliothèque locale, activation/désactivation (jonction NTFS vers le dossier de skills de chaque CLI), import depuis un dossier, ouverture du dossier pour import en masse.

- **Backend** : plugin `skills` (`src-tauri/src/modules/skills/`).
- **Commandes** : `list`, `set_enabled`, `import_from_path`, `open_folder`, `library_path` (+ commandes de l'atelier, ci-dessous).
- **Événements émis** : `skills.changed`.
- **Slot fourni** : `chat.composer.actions` (`slots/ComposerSkills.tsx`) — bouton « Utiliser un skill » dans la barre de chat (Chat et Code) : recherche, navigation clavier, skills activés pour l'agent en tête. Choisir un skill insère `/nom` pour Claude quand le skill lui est synchronisé, sinon une consigne désignant son `SKILL.md` (fonctionne avec toute CLI).
- **Bibliothèque** : `%APPDATA%\com.sdai.archimed\skills\`.

## Atelier (Skill Maker)

« Créer un skill » ouvre l'atelier (`components/maker/`) ; « Améliorer » en ouvre un sur une copie d'un skill existant. Décision : ADR 0012.

- **Brouillon** (`<données>/modules/skills/drafts/<id>/`) : `skill/` (le skill livré), `tests.json` (demandes de test, avis), `source/` (matière fournie, ex. `conversation.md`), `runs/<n>/` (dossiers d'essai). C'est le dossier de travail de la conversation de l'atelier (`origin: "skills"`) : la policy « smart » y laisse écrire l'IA sans demander.
- **Consignes de l'IA** : `lib/maker.ts` (`makerInstructions`, messages de départ, demandes de correction et de tests, conversation → Markdown). Fonctions pures, testées.
- **Vérification** : `check.rs` (en-tête, longueurs, liens cités, fichiers orphelins, secrets, commandes risquées, scripts), relancée à chaque fin de tour.
- **Essais** : `draft_prepare_run` crée `runs/<n>/` ; une conversation neuve y est lancée avec le chemin du `SKILL.md` en consigne (`testInstructions`).
- **Enregistrement** : `draft_save` refuse un skill avec erreurs ; un skill existant du même nom est copié dans `modules/skills/backups/<nom>-<date>/` avant d'être remplacé (le dossier est vidé, pas supprimé : les jonctions des CLI restent valides).
- **Commandes** : `draft_create`, `draft_list`, `draft_info`, `draft_delete` (Corbeille), `draft_files`, `draft_read`, `draft_write` (limitées à `skill/`, `tests.json`, `source/`), `draft_check`, `draft_changes`, `draft_prepare_run`, `draft_save`.
- **Accueil** : une conversation de l'atelier rouverte depuis l'accueil (`conversationId`) rouvre son brouillon.

## Commandes pour les agents
`agent-actions.ts` (base de commandes, ADR 0017 ; `open` ajoutée d'office). Bibliothèque (activer, importer) et atelier : écrire un skill directement, brouillons, vérification, enregistrement.

`list_skills`, `set_skill_enabled`, `import_skill`, `open_skills_folder`, `write_skill`, `list_drafts`, `open_maker`, `check_draft`, `save_draft`, `delete_draft`.
