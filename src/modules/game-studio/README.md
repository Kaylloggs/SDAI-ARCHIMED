# Module `game-studio` — Game Studio

Conçoit et fait avancer des jeux vidéo dans **Godot, Unity ou Unreal**. Game Studio est un
**orchestrateur** : il tire d'une idée les systèmes du jeu et leur architecture, crée un projet
moteur minimal qui s'ouvre et se lance, puis suit le travail (graphe des systèmes, tâches,
décisions, points de restauration). Il ne génère pas de jeu par genre (ADR 0018).

- **Backend** : plugin `game-studio` (`src-tauri/src/modules/game_studio/`).
- **Slots, services, événements** : aucun. La page écoute `module.data.changed` (modifications
  faites par un agent ou la voix) et accepte `moduleParams` `{ projectId, section, create }`.
- **Commandes** (`agent-actions.ts`) : tout ce que fait l'interface, pour la voix et les agents
  (serveur MCP d'ARCHIMED : `search_commands`, `run_action`). Les gestes payants ou qui lancent du
  code (`generate_game_image`, `run_blender_script`, restauration) demandent confirmation ; aucune
  commande ne reçoit ni ne rend de clé d'API (les clés se saisissent dans l'interface).
- **Coffre** : `game-studio-openrouter`, `game-studio-gemini`, `game-studio-higgsfield` (clés des
  fournisseurs d'images, vérifiées puis rangées dans le coffre du système ; sans clé à lui, le
  module relit celle qu'Image Maker ou Mod Studio a déjà rangée, sans la recopier).
- **Tutoriel** : `tutorial.ts`, affiché dans le module Tutoriel (à tenir à jour avec l'interface).

## État des phases

| Phase | Contenu | État |
|---|---|---|
| 1 | Analyse d'idée, graphe, adaptateurs, création, import, points de restauration, environnement, interface | ✓ (Godot 4.4.1 vérifié de bout en bout ; Unity et Unreal à essayer sur Windows) |
| 2 | Exécution des commandes moteur en direct (arrêt, délai, silence signalé), erreurs expliquées, problèmes ouverts et refermés, carte d'un projet existant | ✓ (vérification, tests et erreurs Godot vérifiés de bout en bout) |
| 3 | Client MCP : serveurs des outils de la personne découverts, testés pour de vrai, capacités « via MCP », serveurs ajoutés transmis aux agents | ✓ (échanges stdio et HTTP testés ; `uvx blender-mcp` réel) |
| 4 | Agents par rôle (Directeur et spécialistes) avec le brief du projet, tâches confiées, boucle de débogage bornée, GDD et TDD tirés du graphe | ✓ (brief et documents testés ; conversations par les agents CLI d'ARCHIMED) |
| 5 | Registre des ressources, images générées avec leur trace, Blender sans interface (lire, exporter, script), import dans le moteur | ✓ (Blender 5.2 et Godot 4.4.1 vérifiés de bout en bout ; import Unity et Unreal à essayer sur Windows) |
| 6 | Toutes les actions de l'interface en commandes pour la voix et les agents (`agent-actions.ts`, 68 commandes), tutoriel, documentation | ✓ |

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
   tests, Ressources, Carte du projet, Historique (git, points de restauration,
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
9. **Ressources** (`AssetsSection`) : registre des images, modèles et sons du jeu, avec leur état
   (générée, ajoutée, convertie, dans le moteur). « Ajouter des fichiers » copie dans le dossier du
   moteur (`assets/` pour Godot, `Assets/Art/` pour Unity, `SourceArt/` pour Unreal ; concepts dans
   `docs/concepts`, ignoré par Godot) ; un `.gltf` emmène ses `.bin` et textures. Les fichiers du
   projet hors registre sont listés, à inscrire. « Dans le moteur » est constaté, jamais supposé :
   fichier `.import` (Godot), `.meta` (Unity) ou `.uasset` dans `Content/` (Unreal).
   « Importer dans <moteur> » lance Godot `--import`, Unity en mode batch, ou le script d'import
   Python de l'éditeur Unreal (écrit dans `.gamestudio/unreal/`), suivi comme une action moteur.
   **Images générées** : fournisseurs du core (OpenRouter, Gemini, Higgsfield par clé ou compte),
   modèle, nature (texture, sprite, interface, concept, effet, matériau), format et fond transparent
   selon le modèle ; la consigne envoyée (demande, usage dans le jeu, charte du projet) se relit
   avant l'envoi ; le prix par image est celui du fournisseur. Le fichier est écrit avec sa trace
   (`generations` : fournisseur, modèle, consigne, réglages, coût annoncé, graine) ; une nouvelle
   version s'écrit à côté (`-v2`), rien n'est écrasé. **Blender** (s'il est installé) : « Lire le
   fichier » (objets, triangles, matériaux, textures introuvables, animations, échelle non
   appliquée), « Exporter pour le jeu » (GLB pour Godot, FBX pour Unity et Unreal, inscrit avec sa
   source ; un nouvel export remplace le précédent en version suivante), scripts Python du projet
   (`run_blender_script`). Les projets Godot créés par Game Studio coupent l'import `.blend` natif
   (`import/blender/enabled=false`), qui bloque l'import sans fenêtre ; sur un projet qui ne le
   coupe pas, l'import est refusé avec la marche à suivre plutôt que de rester bloqué.

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
| `assets.rs`, `blender/*.py` | Registre des ressources, dossiers par moteur, trace d'import du moteur, copie (et fichiers d'un `.gltf`), consignes d'images, commandes Blender, script d'import Unreal ; scripts Blender de lecture et d'export |
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
`game_task_request`, `game_documents`, `write_game_documents`, `game_assets`, `import_game_assets`,
`register_game_asset`, `game_blend_info`, `run_asset_job`, `game_image_providers`,
`set_game_image_key`, `clear_game_image_key`, `game_image_login`, `game_image_models`,
`game_image_prompt`, `generate_game_image`, `cancel_game_image`.

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
  ressources (dossiers par moteur, trace d'import, copie d'un `.gltf`, chemins refusés, consignes,
  images générées et leurs versions, lecture d'un `.blend`), service de bout en bout.
- `GAMESTUDIO_BLENDER=<blender> GAMESTUDIO_GODOT=<godot> cargo test --lib game_studio -- --include-ignored` :
  avec les vrais outils, un script du projet fabrique un `.blend`, Blender le lit (triangles,
  échelle signalée), l'exporte en GLB (puis en version 2), Godot l'importe (ressource « dans le
  moteur ») ; sans le réglage `.blend`, l'import est refusé ; un script en erreur ouvre un
  problème, refermé par la réussite suivante.
- `GAMESTUDIO_GODOT=<chemin de Godot> cargo test --lib game_studio -- --include-ignored` : avec le
  vrai Godot, crée un projet, le prépare, le vérifie, casse un script (échec expliqué, problème
  ouvert), le répare (problème refermé), provoque une erreur à l'exécution (test de démarrage en
  échec malgré le code 0), puis coche la tâche de départ quand tout repasse.
- `pnpm test` : `__tests__/` (mise en page du graphe, sélection, tâches, noms de dossier, actions
  disponibles, systèmes repérés, formats, autonomie des agents, demande de correction, filtres et
  réglages des ressources).
