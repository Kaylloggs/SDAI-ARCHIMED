# Module `game-studio` — Game Studio

Conçoit et fait avancer des jeux vidéo dans **Godot, Unity ou Unreal**. Game Studio est un
**orchestrateur** : il tire d'une idée les systèmes du jeu et leur architecture, crée un projet
moteur minimal qui s'ouvre et se lance, puis suit le travail (graphe des systèmes, tâches,
décisions, points de restauration). Il ne génère pas de jeu par genre (ADR 0018).

- **Backend** : plugin `game-studio` (`src-tauri/src/modules/game_studio/`).
- **Slots, services, événements** : aucun. La page écoute `module.data.changed` (modifications
  faites par un agent ou la voix) et accepte `moduleParams` `{ projectId, section, create }`.
- **Coffre** : `game-studio-openrouter`, `game-studio-gemini`, `game-studio-higgsfield` (réservés
  aux phases de contenu ; aucune clé n'est lue ni écrite en phase 1).
- **Tutoriel** : `tutorial.ts`, affiché dans le module Tutoriel (à tenir à jour avec l'interface).

## État des phases

| Phase | Contenu | État |
|---|---|---|
| 1 | Analyse d'idée, graphe, adaptateurs, création, import, points de restauration, environnement, interface | ✓ (Godot 4.4.1 vérifié de bout en bout ; Unity et Unreal à essayer sur Windows) |
| 2 | Scanner de projet existant, exécution des commandes moteur en flux, builds, erreurs expliquées | à venir |
| 3 | Outils MCP de Game Studio, client MCP | à venir |
| 4 | Agents par rôle, boucle de débogage, GDD et TDD | à venir |
| 5 | Ressources, images IA, Blender sans interface | à venir |

Rien n'est simulé : un geste qui n'a pas encore de moteur n'a pas de bouton.

## Parcours

1. **Votre machine** (`EnvironmentPanel`) : moteurs trouvés (winget, Steam, Hub Unity, lanceur
   Epic, registre, dossiers usuels, PATH), Blender, git et LFS, Python, Node, .NET, Visual Studio,
   SDK Android. « Installer » passe par winget (audité) ; « Désigner l'exécutable » enregistre un
   chemin vérifié dans `tools.json`.
2. **Nouveau jeu** (`NewGameWizard`) : l'idée en texte libre → `analyze_idea` → systèmes
   détectés (avec la phrase qui les a déclenchés), dépendances ajoutées, questions critiques,
   hypothèses, décisions, plan de monde et de réseau, risques, feuille de route, besoins en
   contenu. À droite : moteur (score et raisons, installé ou non), mode (prototype, standard,
   avancé, production), autonomie, plateformes, dossier, git. « Créer le jeu » écrit le projet.
   Un jeu peut être créé **sans moteur** (conception seule) et en recevoir un plus tard.
3. **Espace du projet** (`workspace/`) : Tableau de bord, Conception, Systèmes (graphe en
   couches ou liste, fiche avec dépendances, consommateurs et impact d'un retrait), Tâches (prêtes,
   bloquées, en cours), Historique (git, points de restauration, différences), Journal, Outils,
   Réglages (moteur, plateformes, budget de performance).

## Backend

| Fichier | Rôle |
|---|---|
| `catalog/systems.toml`, `catalog/genres.toml` | 180 systèmes (catégorie, dépendances, compagnons, mots-clés FR/EN, risques) ; indices de genre |
| `catalog.rs` | Chargement, repli des accents, pluriels, négations (« sans », « pas de », « no »…) |
| `analysis.rs` | Idée → systèmes, dimension, caméra, monde, réseau, plateformes, moteur conseillé, questions, feuille de route |
| `engines/` | Trait `EngineAdapter` et `godot.rs`, `unity.rs`, `unreal.rs` : détection, création, capacités, commandes (`CommandSpec`) |
| `graph.rs` | Opérations typées sur le graphe (`GameGraphOp`), dépendances sans cycle, impact, tâches prêtes |
| `store.rs` | Liste des projets (`projects.json`), lecture et écriture atomique de `.gamestudio/` |
| `vcs.rs` | Points de restauration git sous `refs/gamestudio/checkpoints/` (index temporaire) |
| `journal.rs` | Journal JSONL par catégorie, secrets masqués, rotation à 5 Mo |
| `tools.rs` | Rapport d'environnement, installations winget, chemins désignés |
| `service.rs`, `commands.rs` | Façade et commandes Tauri |

Commandes : `game_environment`, `set_tool_path`, `install_tool`, `analyze_idea`,
`system_catalog`, `game_default_dir`, `create_game`, `import_game`, `list_games`, `game_state`,
`update_game`, `forget_game`, `set_game_engine`, `graph_op`, `read_journal`, `vcs_state`,
`vcs_init`, `create_checkpoint`, `checkpoint_changes`, `checkpoint_diff`, `restore_checkpoint`.

## Ce que contient un projet créé

- **Godot** : `project.godot`, scène principale 2D ou 3D, `scripts/main.gd`,
  `tests/smoke_test.gd`, `export_presets.cfg` (une entrée par plateforme cible), script de
  vérification des scripts (`.gamestudio/godot/check_scripts.gd`, `--import` ne signalant pas
  les erreurs par son code de sortie).
- **Unity** : `Assets/Editor/ArchimedGameStudio.cs` (préparation et builds par plateforme en
  `-batchmode`), `GameBootstrap.cs`, tests EditMode, `ProjectVersion.txt` si la version est connue.
- **Unreal** : `.uproject` (Python et Editor Scripting activés), `Config/`, `Content/Game`, module
  C++ facultatif (cibles, `Build.cs`).
- Toujours : `.gitignore`, `.gitattributes` (LFS pour les binaires), `.gamestudio/` (identité,
  graphe, journal, points ; journaux et builds ignorés par git).

## Tests

- `cargo test --lib game_studio` : catalogue (cohérence, cycles, négations), analyse (12 idées
  types), graphe, points de restauration, service de bout en bout.
- `GAMESTUDIO_GODOT=<chemin de Godot> cargo test --lib game_studio -- --include-ignored` : crée
  un vrai projet, le prépare (`--import`), vérifie ses scripts (une erreur de type les fait
  échouer) et lance le test de fumée dans Godot.
- `pnpm test` : `__tests__/` (mise en page du graphe, sélection, tâches, noms de dossier).
