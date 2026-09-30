# ADR 0018 — Game Studio : studio de jeu orchestré par systèmes

- **Date** : 2026-09-30
- **Statut** : accepté, livré (phases 1 à 6)

## Contexte

La personne veut qu'ARCHIMED l'aide à concevoir et faire avancer **n'importe quel jeu vidéo**,
dans le moteur de son choix, avec des agents IA. Trois écueils à éviter :

- un générateur qui produit un « jeu » par genre (template de FPS, template de RPG) : il se
  casse dès que l'idée sort du genre, et ne dit rien de l'architecture ;
- des capacités inventées : un bouton « Compiler pour PS5 » qui ne fait rien, un faux serveur
  MCP, une connexion moteur simulée ;
- un module qui écrit dans le projet sans trace ni retour arrière.

## Décision

1. **Un module `game-studio`**, front (`src/modules/game-studio/`) et plugin Rust
   (`src-tauri/src/modules/game_studio/`), sans import vers d'autres modules.
2. **Orchestrateur, pas générateur.** Game Studio analyse l'idée, en tire une architecture,
   crée un projet moteur minimal qui s'ouvre et se lance, puis suit le travail (systèmes,
   tâches, décisions, versions). Le contenu du jeu est écrit par la personne et ses agents.
3. **Systèmes d'abord, genres ensuite.** Un catalogue de 180 systèmes
   (`catalog/systems.toml` : catégorie, dépendances, compagnons, mots-clés, poids, risques) et
   des indices de genre (`catalog/genres.toml`). L'analyse (`analysis.rs`) repère les systèmes
   par mots-clés (accents repliés, pluriels tolérés, négations « sans », « pas de », « no »…),
   ferme les dépendances, puis déduit dimension, caméra, monde (streaming, LOD, découpage),
   réseau (topologie, réplication, prédiction, serveur dédié), plateformes, moteur conseillé,
   risques, questions critiques et feuille de route. Un genre ne fait que proposer des systèmes :
   « un Terraria en 3D » donne des voxels, pas une « catégorie Terraria ».
4. **Graphe de projet partagé.** `<projet>/.gamestudio/graph.json` : systèmes et dépendances
   (sans cycle, vérifié à chaque opération), décisions, hypothèses, tâches, problèmes,
   changements, versions, feuille de route, plan de monde et de réseau. Toute modification passe
   par une opération typée (`GameGraphOp`) qui incrémente la révision : l'interface, les agents
   et la voix écrivent par le même chemin.
5. **Adaptateurs moteur honnêtes.** Un trait `EngineAdapter` (Godot, Unity, Unreal) : détection
   des installations, création, capacités, et **commandes réelles** (`CommandSpec`) pour
   préparer, vérifier, tester, lancer et exporter. Une capacité non vérifiée sur la machine
   (modèles d'export absents, Visual Studio manquant) est déclarée « indisponible » avec la
   raison, jamais simulée. Godot est vérifié de bout en bout (test e2e ignoré par défaut,
   `GAMESTUDIO_GODOT`) ; `--import` ne signalant pas les erreurs de script par son code de
   sortie, un script de vérification (`.gamestudio/godot/check_scripts.gd`) le fait.
6. **Projet autonome.** Le dossier du jeu s'ouvre sans ARCHIMED ; l'état propre à Game Studio
   vit dans `.gamestudio/` (graphe, projet, journal, points de restauration), dont les journaux
   et builds sont ignorés par git.
7. **Modifications sûres.** Points de restauration git sous `refs/gamestudio/checkpoints/<id>`,
   pris avec un index temporaire : ni la branche, ni l'index, ni le dossier de travail de la
   personne ne bougent. Revenir à un point en prend d'abord un de l'état courant ; les fichiers
   ajoutés depuis partent à la Corbeille.
8. **Environnement et secrets.** Rapport de la machine (moteurs, Blender, git et LFS, Python,
   Node, .NET, Visual Studio, SDK Android) avec installation winget sur demande (auditée) ou
   exécutable désigné à la main. Les clés d'API éventuelles restent dans le coffre du système
   (`credentials` du manifeste) ; le journal (`journal.jsonl`) masque tout ce qui ressemble à un
   secret avant écriture.
9. **Commandes pour les agents.** `agent-actions.ts` couvre les gestes de l'interface (ADR
   0017) ; supprimer un système, une tâche, revenir à un point ou installer un outil est
   `destructive`.

10. **Exécution suivie, jamais simulée.** Les actions moteur passent par `runner.rs` : programme
    et arguments sans shell, une action à la fois par projet, sortie en flux, délai maximal, arrêt
    de tout l'arbre de processus, secrets masqués avant affichage et écriture. Le verdict ne se
    fie pas qu'au code de sortie : marqueur de réussite attendu, build réellement écrit, et mode
    strict pour Godot, qui finit à 0 après une erreur de script à l'exécution (vérifié sur 4.4.1).
    Un échec ouvre un problème du graphe (`source: run:<action>`), refermé par la réussite de la
    même action.

11. **MCP : pas de faux serveur, un vrai client.** Les commandes de Game Studio passent déjà par
    le serveur MCP d'ARCHIMED (`search_commands`, `run_action`, ADR 0017) : pas de second
    serveur. Game Studio découvre les serveurs MCP des outils de la personne et ne les dit prêts
    qu'après un échange réel (`initialize`, `tools/list`), lancé par elle. Les secrets restent
    dans leurs fichiers (jamais renvoyés, jamais recopiés) ; seuls les serveurs ajoutés dans Game
    Studio, sans secret, sont déclarés aux agents (`mcp/game-studio.json`, retiré avec le module).

12. **Les agents travaillent autour du graphe, avec les CLI déjà installées.** Pas de nouveau
    moteur d'IA ni de clé : les conversations passent par le moteur multi-CLI du core (origine
    `game-studio`, dossier du jeu). Le rôle (Directeur ou spécialiste) et le brief du projet
    (règles, moteur, systèmes, tâches, décisions, problèmes, commandes de Game Studio à utiliser)
    arrivent en instructions système, recalculés à chaque nouvelle conversation. Garde-fous : un
    point de restauration avant chaque message, l'autonomie du projet reportée sur le mode
    automatique de l'agent, le message toujours relu avant envoi, au plus 3 corrections
    d'affilée après un échec (remis à zéro au premier succès). Les documents (GDD, TDD) sont
    écrits sans IA à partir du graphe : ils ne disent que ce qui est enregistré, et un changement
    d'architecture se fait dans le graphe, pas dans le document.

13. **Ressources : constatées, tracées, converties par les vrais outils.** Le registre du graphe
    (`GameAsset`) dit d'où vient chaque fichier et où il en est ; « dans le moteur » se lit sur le
    disque (`.import`, `.meta`, `.uasset`), jamais supposé. Les images passent par `core::imaging`
    (clés du coffre, partagées sans copie) et gardent leur trace (fournisseur, modèle, consigne
    complète, réglages, coût annoncé) ; une nouvelle version ne remplace pas l'ancienne. Blender
    tourne sans fenêtre avec des scripts écrits par Game Studio (lecture, export GLB ou FBX) ou
    ceux du projet, par l'exécuteur des actions moteur (sortie, arrêt, délai, erreurs Python
    expliquées, problème ouvert). L'import par le moteur est une action comme les autres ; Godot
    resterait bloqué sur un `.blend` sans Blender configuré : les projets créés coupent cet import
    (Game Studio exporte en GLB) et un projet qui ne le coupe pas est refusé avec la marche à suivre.

## Phases

| Phase | Contenu |
|---|---|
| 1 | Analyse système d'abord, graphe, adaptateurs, création et import, points de restauration, environnement, interface (tableau de bord, conception, systèmes, tâches, historique, journal, outils, réglages) |
| 2 | Scanner de projet existant, exécution des commandes moteur en flux (annulation, délai), builds, analyse des erreurs (GDScript, C#, MSVC/UBT, journaux Unreal) |
| 3 | Client MCP (découverte, test réel, capacités via MCP, serveurs déclarés aux agents) |
| 4 | Agents par rôle autour du graphe (Directeur et spécialistes), boucle de débogage, documents (GDD, TDD) |
| 5 | Registre des ressources, images par `core::imaging`, Blender sans interface |
| 6 | Commandes pour la voix et les agents couvrant toute l'interface, tutoriel, documentation |

## Conséquences

- Ajouter un système au catalogue suffit pour qu'il soit détecté, relié et planifié ; les tests
  de `catalog.rs` vérifient les dépendances connues et l'absence de cycle.
- Un nouvel adaptateur moteur implémente `EngineAdapter` ; rien d'autre ne connaît les moteurs.
- Unity et Unreal n'ont pas pu être exécutés sur la machine de développement : leurs commandes
  suivent la documentation officielle et restent à confirmer sur Windows.
