# Module `game-studio` — Game Studio

Conçoit et fait avancer des jeux vidéo dans **Godot, Unity ou Unreal**. Game Studio est un
**orchestrateur** : il tire d'une idée les systèmes du jeu et leur architecture, crée un projet
moteur minimal qui s'ouvre et se lance, puis suit le travail (graphe des systèmes, tâches,
décisions, points de restauration). Il ne génère pas de jeu par genre (ADR 0018).

- **Backend** : plugin `game-studio` (`src-tauri/src/modules/game_studio/`).
- **Slots, services, événements** : aucun. La page écoute `module.data.changed` (modifications
  faites par un agent ou la voix) et accepte `moduleParams` `{ projectId, section, create }`.
- **Coffre** : `game-studio-openrouter`, `game-studio-gemini`, `game-studio-higgsfield` (réservés
  aux phases de contenu ; aucune clé n'est lue ni écrite pour l'instant).
- **Tutoriel** : `tutorial.ts`, affiché dans le module Tutoriel (à tenir à jour avec l'interface).

## État des phases

| Phase | Contenu | État |
|---|---|---|
| 1 | Analyse d'idée, graphe, adaptateurs, création, import, points de restauration, environnement, interface | ✓ (Godot 4.4.1 vérifié de bout en bout ; Unity et Unreal à essayer sur Windows) |
| 2 | Exécution des commandes moteur en direct (arrêt, délai, silence signalé), erreurs expliquées, problèmes ouverts et refermés, carte d'un projet existant | ✓ (vérification, tests et erreurs Godot vérifiés de bout en bout) |
| 3 | Client MCP : serveurs des outils de la personne découverts, testés pour de vrai, capacités « via MCP », serveurs ajoutés transmis aux agents | ✓ (échanges stdio et HTTP testés ; `uvx blender-mcp` réel) |
| 4 | Agents par rôle (Directeur et spécialistes) avec le brief du projet, tâches confiées, boucle de débogage bornée, GDD et TDD tirés du graphe | ✓ (brief et documents testés ; conversations par les agents CLI d'ARCHIMED) |
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
   bloquées, en cours ; « Confier à l'agent » prépare la demande), Agents, Documents, Build et
   tests, Carte du projet, Historique (git, points de restauration,
   différences), Journal, Outils, Réglages (moteur, plateformes, budget de performance).
4. **Build et tests** (`BuildSection`) : Vérifier le code, Lancer les tests, Lancer le jeu,
   Préparer le projet, Ouvrir l'éditeur, Exporter le build (plateforme, publication ou
   développement). Chaque bouton vient d'une capacité de l'adaptateur ; indisponible, il dit
   pourquoi (moteur absent, modèles d'export manquants). Sortie en direct (filtre erreurs et
   avertissements), arrêt de tout l'arbre de processus, délai maximal, message quand l'outil ne dit
   plus rien depuis 2 min. À la fin : verdict, erreurs avec fichier, ligne, cause probable, piste de
   correction et systèmes concernés, journal complet, build produit. Un échec ouvre un problème
   du projet (tableau de bord) ; la même action réussie le referme. Vérification et test de
   démarrage réussis cochent la tâche de départ.
5. **Carte du projet** (`MapSection`) : fichiers par nature et par langage, dossiers principaux,
   systèmes déjà codés (reconnus dans les noms de fichiers, de classes et de fonctions, avec
   « Ajouter au graphe » : fichiers rattachés, statut « en cours »), risques (pas de Git, gros
   fichiers hors LFS, dossiers générés non ignorés, scène de démarrage absente, version du moteur
   différente, aucun test, scripts très longs). Analyse incrémentale ; lancée d'office à l'import
   d'un projet existant, sans rien modifier dans ses fichiers.
6. **Intégrations** (`IntegrationsSection`) : serveurs MCP déclarés dans Claude Code
   (`~/.claude.json`, portée utilisateur et locale), `.mcp.json` du projet, Claude Desktop,
   Cursor, Codex (`~/.codex/config.toml`), Gemini CLI et Antigravity ; outil piloté deviné
   (Godot, Unity, Unreal, Blender) ; agents qui les reçoivent. « Tester » lance ou contacte le
   serveur (`initialize`, `tools/list`) et liste ses outils ; un serveur du moteur testé devient
   une capacité « via MCP » du projet. Les valeurs des variables et en-têtes ne quittent jamais
   leur fichier ; arguments et adresses secrets sont masqués. Les serveurs ajoutés ici (commande
   ou adresse, sans secret) sont déclarés dans `<données>/mcp/game-studio.json`, donc proposés
   à Claude Code et Antigravity lancés par ARCHIMED. Les commandes de Game Studio elles-mêmes
   passent déjà par le serveur MCP d'ARCHIMED (`search_commands`, `run_action`).
7. **Agents** (`AssistantSection`) : conversations avec Claude Code, Codex ou Antigravity
   (moteur de conversation du core, origine `game-studio`), dans le dossier du jeu. Chaque
   conversation reçoit en instructions système le brief du projet (`game_agent_instructions` :
   règles de Game Studio, moteur et ses règles, commandes à utiliser pour vérifier et mettre à
   jour le graphe, systèmes, tâches ouvertes, décisions, problèmes) et le rôle choisi (Directeur,
   gameplay, IA, réseau, UI, audio, rendu, build, tests, débogage…). Le mode d'autonomie suit
   celui du projet (manuel → rien sans accord, assisté → prudent, autonome → tout). Un point de
   restauration git est pris avant chaque message (réutilisé si l'arbre n'a pas changé). Une
   tâche confiée passe « en cours » avec la conversation. Après un échec (vérifier, tester…),
   « Corriger avec l'agent » prépare pour l'agent de débogage les erreurs expliquées et lui
   demande de relancer la vérification ; au plus 3 corrections d'affilée, compteur remis à zéro
   au premier succès. Le message est toujours relu avant envoi.
8. **Documents** (`DocumentsSection`) : GDD (vision, systèmes par catégorie et critères de
   vérification, monde, réseau, hypothèses, questions, feuille de route) et TDD (moteur,
   plateformes, ordre de construction des systèmes, dépendances, décisions, budget de
   performance, risques, tâches) écrits sans IA à partir du graphe. « Écrire dans docs/ » crée
   ou remplace `docs/GDD.md` et `docs/TDD.md` après un point de restauration ; rien n'est écrit
   si le contenu n'a pas changé.

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
| `runner.rs` | Exécution des commandes (une action par projet, sortie en flux par `Channel<GameJobEvent>`, délai, arrêt de l'arbre de processus, silence signalé, secrets masqués) |
| `diagnostics.rs` | Erreurs lues dans la sortie : GDScript et Godot, C# (Unity, MSBuild), C++ (MSVC, clang, éditeur de liens), Unreal et UAT, Python, résultats NUnit ; causes et pistes ; systèmes concernés d'après les fichiers rattachés |
| `scanner.rs` | Carte d'un projet (`.gamestudio/cache/`), incrémentale |
| `agents.rs` | Brief d'un agent (règles, rôle, moteur, graphe résumé) et demande préparée pour une tâche |
| `docs.rs` | GDD et TDD en Markdown, déterministes, tirés du graphe |
| `mcp_client.rs` | Serveurs MCP de la machine : découverte, masquage des secrets, test réel stdio et HTTP (JSON ou SSE), serveurs ajoutés et leur déclaration |
| `builds.rs` | Historique des exécutions (`.gamestudio/builds/history.json`, journal complet par exécution) |
| `service.rs`, `commands.rs` | Façade et commandes Tauri |

Commandes : `game_environment`, `set_tool_path`, `install_tool`, `analyze_idea`,
`system_catalog`, `game_default_dir`, `create_game`, `import_game`, `list_games`, `game_state`,
`update_game`, `forget_game`, `set_game_engine`, `graph_op`, `read_journal`, `vcs_state`,
`vcs_init`, `create_checkpoint`, `checkpoint_changes`, `checkpoint_diff`, `restore_checkpoint`,
`run_game_action`, `cancel_game_action`, `current_game_action`, `open_game_editor`,
`list_game_runs`, `read_game_run_log`, `scan_game`, `game_map`, `list_mcp_servers`,
`check_mcp_server`, `add_mcp_server`, `remove_mcp_server`, `game_agent_instructions`,
`game_task_request`, `game_documents`, `write_game_documents`.

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
  types), graphe, points de restauration, exécuteur (flux, code de sortie, arrêt de l'arbre de
  processus, délai, programme absent), lecture des erreurs (sorties réelles de Godot 4.4.1 et
  formats C#, MSVC, clang, Unreal, Unity, Python, NUnit), carte d'un projet (incrémentale),
  brief des agents et demandes de tâche, GDD et TDD (écrits une fois, rien au second appel),
  service de bout en bout.
- `GAMESTUDIO_GODOT=<chemin de Godot> cargo test --lib game_studio -- --include-ignored` : avec le
  vrai Godot, crée un projet, le prépare, le vérifie, casse un script (échec expliqué, problème
  ouvert), le répare (problème refermé), provoque une erreur à l'exécution (test de démarrage en
  échec malgré le code 0), puis coche la tâche de départ quand tout repasse.
- `pnpm test` : `__tests__/` (mise en page du graphe, sélection, tâches, noms de dossier, actions
  disponibles, systèmes repérés, formats, autonomie des agents, demande de correction).
