# Changelog

Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versions en [SemVer](https://semver.org/lang/fr/).

## [Non publié]

### Ajouté
- **Modèles Claude par niveau d'effort** : chaque modèle est proposé en effort élevé, moyen ou faible dans la barre de saisie (`--effort`), en plus de l'entrée par défaut.
- **Réglages › Économie de tokens** étendus : effort de réflexion par défaut (Claude et Antigravity), désactivation des skills des CLI (`--disable-slash-commands`), contexte optimisé pour le cache (`--exclude-dynamic-system-prompt-sections`), compactage anticipé à 100 k (`--autocompact`), et relance automatique des réponses coupées désactivable.

### Modifié
- **Menu latéral** : défilement visible (barre fine, dégradés haut et bas) quand les modules dépassent la hauteur.

## [0.2.1] - 2026-09-17

### Ajouté
- **Économie de tokens (Réglages)** : mode caveman intégré au logiciel (skill embarqué), activable, 3 niveaux (léger, standard, maximal). Appliqué à chaque prompt dans Chat et Code, toutes CLI : règles complètes au premier message d'une conversation, rappel d'une ligne ensuite.

### Modifié
- **Tokens sous chaque réponse** : distinction entre tokens **générés** et **contexte** relu (instructions, outils, skills, historique) avec sa part en cache. L'ancien total unique laissait croire qu'un simple « coucou » coûtait 28 k tokens.

## [0.2.0] - 2026-09-17

### Ajouté — Phase 1 (fondations exécutables)
- Squelette Tauri 2 + React 19 + TypeScript strict + Tailwind v4, packagé par `build.ps1`.
- **Système de modules** : découverte automatique (`module.config.ts` + `import.meta.glob`), validation zod, activation/désactivation, points d'extension (slots, services, commandes, cartes).
- **Backend modulaire** : chaque module = plugin Tauri inline ; `build.rs` génère les permissions et refuse un module non enregistré.
- **Moteur multi-CLI** : `SessionManager`, sessions en tâches tokio, transport structuré NDJSON, `Channel<EngineEvent>` vers le frontend.
- **Adaptateur Claude Code** : protocole de permission `--permission-prompt-tool stdio` (`control_request`/`control_response`) → cartes cliquables.
- **Adaptateur Antigravity (`agy`)** : flux `stream-json`, modèles listés via `agy models`, refus de permission headless remonté explicitement.
- **Policy de risque + Mode Auto** (off / intelligent / complet) ; les actions critiques restent toujours confirmées.
- **Modules** : `home` (launchpad), `chat` (timeline, composer, cartes, terminal brut), `skills` (bibliothèque + jonctions vers les CLI), `settings`.
- **Design system** : tokens OKLCH, typographie Geist, primitives, presets de motion.
- Outillage : `pnpm new:module`, `pnpm check` (types + invariants de modularité), tests Vitest et `cargo test`.

### Ajouté — Conversations, thèmes et Codex
- **Chat multi-conversations** : liste latérale, création, sélection, suppression (double clic de confirmation), persistance locale de l'historique (`archimed.sessions`). Chaque conversation affiche sa date, son modèle et son dossier de travail.
- **Dossier de travail par conversation** : sélecteur dans le composer (dialogue natif), transmis comme `cwd` au processus CLI.
- **Pièces jointes** : ajout de fichiers (PDF, images, documents…) au prompt ; les chemins sont transmis à l'agent et affichés dans la timeline.
- **Adaptateur Codex** (expérimental, `codex exec --json`) : détecté automatiquement s'il est installé.
- **Réglages > Moteur** : état de détection de chaque CLI (version, chemin, modèles), possibilité de désigner l'exécutable d'une CLI hors PATH (persisté dans `engine.json`).
- **Réglages > Thème** : 6 presets (Archimède, Papier, Tokyo Néon, Nord, Terra, Encre) appliqués via `data-theme`.
- **Réglages > Données** : suppression de tout l'historique.
- `pnpm check` impose désormais que chaque module soit listé dans `README.md` et `architecture.md`.

### Ajouté — Module Code
- **Nouveau module `code`** : arborescence de projet (chargement paresseux, dossiers lourds grisés), onglets de fichiers, lecture avec coloration syntaxique via CodeMirror 6 (~35 langages), détection du type de projet.
- **Assistant intégré** au module Code : même moteur et mêmes conversations que le module Chat, panneau repliable.
- **Drag & drop** : un fichier glissé de l'arborescence devient une cible de modification ; des fichiers glissés depuis Windows deviennent des pièces jointes (`useOsFileDrop`).
- **Passage de relais Chat → Code** : quand le dossier de travail est un projet (détecté via le service `code.project`), le chat propose de l'ouvrir dans le module Code.
- **UI de conversation mutualisée** dans `@/core/chat` (`Composer`, `ConversationView`) et `@/core/engine/useChat`.
- **Primitive `Select`** : les menus déroulants suivent enfin le thème de l'application (les `<select>` natifs utilisaient le style du système).

### Corrigé
- **Positionnement du `Select`** : correction du menu déroulant qui flottait trop haut au-dessus du bouton lors de l'ouverture vers le haut (le calcul utilisait une hauteur arbitraire au lieu d'ancrer le bas de la liste au déclencheur via `bottom`).

### Corrigé — Module Code
- **Fond blanc illisible dans l'éditeur** : `@uiw/react-codemirror` appliquait son thème clair par défaut. L'éditeur utilise désormais un thème et une coloration syntaxique branchés sur les tokens (`--color-syntax-*`), qui suivent le preset choisi.
- **Conversations parasites dans le Chat** : ouvrir un dossier ou un fichier dans Code créait une conversation visible dans le module Chat. Les conversations ont maintenant une origine (`chat` | `code`), celles du module Code ne sont créées qu'au premier message et n'apparaissent que dans Code. Migration automatique : les conversations vides créées ainsi sont supprimées.
- **Thème Papier** : le fond restait sombre à cause d'une couleur figée dans `index.html` ; les couleurs sémantiques ont aussi été assombries pour le fond clair.

### Ajouté — Phase 2 (1/3)
- **Édition directe dans le module Code** : modification, indicateur « non enregistré », `Ctrl+S`, écriture atomique côté Rust (`write_file`), fermeture d'un onglet modifié confirmée par un second clic.
- **Palette de fichiers `Ctrl+P`** (branchée sur `search_files`).
- **Rechargement automatique** des fichiers ouverts après chaque outil exécuté par l'assistant.
- **Plusieurs conversations par projet** dans Code (sélecteur + « Nouvelle conversation »).
- **Journal d'audit** `logs/audit.jsonl` : décisions de permission (utilisateur, Mode Auto, policy) et écritures de fichiers, avec rotation à 5 Mo.
- Slot `code.editor.footer`.

### Ajouté — Identité et navigation
- **Logo** : spirale d'Archimède laiton ; icônes de l'application régénérées (`.ico`, `.icns`, PNG).
- **Refonte du cadre** inspirée de la maquette fournie : rail de navigation flottant en verre (logo, groupes, réglages épinglés, replier/déployer), barre de titre intégrée avec recherche et contrôles de fenêtre en pastille, panneau de contenu arrondi, fond ambiant.
- **Accueil en grille bento** : héros, conversations récentes (Chat et Code), tuiles de modules.
- Primitive `Tooltip` aux couleurs du thème ; prise en charge de « transparence réduite ».
- La barre d'état du bas est supprimée ; le slot `statusbar.items` s'affiche dans la barre de titre.

### Ajouté — Module Planner
- **Tableaux multiples** type Trello : colonnes, cartes (échéance, étiquettes, notes, sous-tâches), glisser-déposer, progression, renommage et suppression confirmée.
- **Lien avec un `roadmap.md`** : sections → colonnes, cases → cartes. Cocher une carte réécrit la case dans le fichier ; une modification du fichier (par une IA) resynchronise le tableau via un watcher `notify`. Notes et étiquettes conservées d'une synchronisation à l'autre.
- **Agenda** : « Ajouter à Google Agenda » (lien pré-rempli) et export `.ics` d'un tableau.
- **Suggestions contextuelles** : sous un message de l'IA contenant des tâches ou des dates (slot `chat.message.actions`), et bandeau « Roadmap détectée » dans le module Code (slot `code.editor.footer`).
- Nouvelle catégorie de navigation « Organisation » ; les slots peuvent recevoir un contexte typé (`SlotContext`).

### Ajouté — Phase 2 (2/3 et 3/3)
- **Reprise de contexte** : l'identifiant de conversation de la CLI est mémorisé et repassé au redémarrage (`--resume`, `--conversation`). Changement de modèle à chaud sans perte de contexte.
- **Conversations sur disque** (`sessions/conversations.json`, écriture atomique regroupée), migration automatique depuis le `localStorage`.
- **Transport PTY (ConPTY)** et **Parsing Intelligent à l'écran** : écran virtuel `vt100`, règles TOML génériques (`[Y/n]`, `(o/N)`, « Appuyez sur Entrée », écrasement), menus numérotés ou à curseur, questions ouvertes ; réponse aux requêtes de position du curseur de ConPTY. Vérifié de bout en bout sur un vrai `Read-Host` PowerShell.
- **Adaptateurs déclaratifs** : ajouter n'importe quelle CLI par un fichier TOML dans `%APPDATA%\com.sdai.archimeddapters\` (exemple fourni, bouton « Ajouter une CLI… » dans Réglages › Moteur), avec ses propres règles de questions.

### Corrigé — Antigravity
- **Antigravity ne répondait jamais** : deux erreurs dans l'adaptateur, reproduites puis corrigées sur la CLI réelle (agy 1.2.3).
  - `-p` attend une valeur : placé avant les autres options, il avalait `--input-format` comme prompt (« -p took "--input-format" as its prompt »). Lancement désormais `… --output-format stream-json -p=`.
  - Format des messages : `agy` exige `{"event":"user","message":{"role":"user","content":[{"type":"text","text":…}]}}` (« stream input message is missing the "event" field »).
  - Vérifié : réponse reçue, plusieurs messages enchaînés dans le même processus, même conversation.
- Mode Auto intelligent ou complet : `--mode accept-edits` (modifications de fichiers acceptées sans demande).

### Ajouté — Activité de l'agent et bilan de réponse
- Indicateur en direct façon application Claude : « Réflexion… », « Création de main.rs… », « Exécution de pnpm test… », avec chronomètre.
- Outils regroupés et résumés (« 2 fichiers créés · 2 commandes exécutées »), dépliables pour voir le détail.
- Sous chaque réponse : durée, tokens (entrée, cache, sortie, réflexion en infobulle) et coût estimé.
- Nouveaux événements moteur `Activity`, `TurnCompleted`, `RateLimit` ; registre de consommation `usage/ledger.jsonl` et `usage/limits.json`.

### Ajouté — Module Crédits
- **Limites d'abonnement Claude** : fenêtre de 5 h et semaine glissante (% restant, niveau d'alerte, réinitialisation), abonnement lu via `claude auth status`. Relevées à chaque réponse de Claude, ou à la demande (« Actualiser », message Haiku très court). Vérifié sur le compte réel.
- **Consommation mesurée** par CLI et par jour : réponses, tokens, coût estimé, temps de travail (période 24 h / 7 j / 30 j).
- Antigravity et les CLI TOML ne communiquent pas de quota : seule leur consommation est affichée, et c'est indiqué.

### Corrigé — Permissions Antigravity
- **Plus de refus silencieux** : quand `agy` refuse une action (commande, lecture, écriture), une carte **Autoriser / Toujours autoriser / Refuser** s'affiche, dans tous les Modes Auto (le Mode Auto intelligent ou complet répond seul selon la policy ; les actions critiques restent demandées).
- Autoriser écrit la règle exacte (`command(…)`, `read_file(…)`) dans les réglages d'agy, relance la CLI sur la même conversation et lui demande de reprendre l'action. « Autoriser » retire la règle à la fin du tour ; « Toujours autoriser » la conserve. Chaque règle est journalisée dans l'audit.
- Vérifié sur agy 1.2.3 : une règle ajoutée pendant qu'agy tourne est ignorée, d'où la relance.
- La conversation reste « en attente » si la CLI termine son tour avant la réponse de l'utilisateur.

### Ajouté — Planner : colonnes et calendrier
- Colonnes **renommables et supprimables** (avec leurs cartes, confirmation en deux temps).
- **Vue Calendrier** mensuelle : échéances par jour, glisser-déposer pour planifier ou déplanifier, création de carte datée, bascule Tableau / Calendrier dans l'en-tête.

### Ajouté — Liens de fichiers dans les réponses
- Les chemins cités par l'IA (code en ligne, liens `file://`) deviennent **cliquables** s'ils existent : chemins absolus, relatifs au dossier de travail, ou simples noms de fichiers résolus dans un dossier cité par le même message.
- **Clic** : ouvre le fichier dans le module Code (dossier du projet si le fichier en fait partie). **Clic droit** : menu aux couleurs du thème — ouvrir dans Code, avec l'application par défaut, afficher dans l'Explorateur, copier le chemin.
- Sécurité : un programme (`.exe`, `.bat`, `.ps1`…) n'est jamais lancé depuis un lien, seulement affiché dans l'Explorateur.
- Nouvelle primitive `ContextMenu`, commandes `engine_resolve_paths`, `engine_open_path`, `engine_reveal_path`, service `code.open`.

### Ajouté — Skills dans la barre de chat
- Bouton **Utiliser un skill** dans le composer (Chat et Code) : liste de la bibliothèque avec recherche et clavier, skills activés pour l'agent en premier.
- Claude reçoit la commande native `/nom` ; les autres CLI une consigne pointant le `SKILL.md` du skill.
- Le slot `chat.composer.actions` reçoit désormais `{ cwd, adapter, insertText }`.

### Ajouté — Module Mémoire
- **Journal automatique** : chaque réponse d'IA (Chat et Code) est résumée — demande, résultat, fichiers modifiés, commandes lancées.
- **Notes** globales ou par projet : ajout manuel, bouton « Mémoriser » sous une réponse, ou lignes `📌 Mémoire :` écrites par l'IA.
- **Rappel** : au premier message d'une conversation, les notes et derniers travaux du projet sont transmis à la CLI (3 000 caractères max). Aperçu exact dans le module.
- Réglages : rappel et journal désactivables ; tout est stocké localement.
- Nouveaux points d'extension : slot `app.background`, service `memory.context`.

### Modifié — Mémoire (v0.2)
- La mémoire contient uniquement **ce que vous saisissez** dans le module : informations globales ou par projet, chacune **activable** (transmise aux IA ou mise de côté), modifiables et supprimables. Interrupteur général et aperçu du bloc transmis.
- **Journal automatique retiré** (ainsi que « Mémoriser » sous les réponses et les lignes `📌 Mémoire :`) ; `journal.jsonl` est supprimé au démarrage.

### Corrigé
- **Dossier de travail ignoré par Antigravity** : les fichiers étaient créés ailleurs. agy n'utilise le dossier que s'il lui est passé par `--add-dir` (vérifié sur agy 1.2.3). Changer de dossier en cours de conversation relance aussi la CLI dans le nouveau dossier, contexte conservé.
- **Liens de fichiers menant à `http://tauri.localhost`** : react-markdown effaçait les URL `file:///…` produites par les IA. Elles sont conservées et ouvertes par le lien de fichier ; les liens web s'ouvrent dans le navigateur, jamais dans la fenêtre.
- **Menus trop transparents** (clic droit, palette `Ctrl+K`, listes) : couches flottantes quasi opaques.
- **Barre de saisie** : outils, Mode Auto et envoi alignés sur une seule ligne.

### Ajouté
- **Mémoire : import d'un fichier** (.txt, .md, .json) pour ajouter plusieurs informations d'un coup, avec aperçu, cases à cocher et choix de la portée.
- **Module Code : suppression d'une conversation** (corbeille dans l'en-tête du chat, confirmation par un second clic).
- **Réglages** : mention « Logiciel réalisé par SearaDesign - version - ARCHIMED ».

### Corrigé
- **Tokens Antigravity très surestimés** : agy renvoie en fin de tour un usage **cumulé depuis le début de la conversation**, qui était additionné à chaque réponse. La consommation est maintenant la somme des appels au modèle du tour (vérifié sur agy 1.2.3), et la durée celle du tour. L'historique déjà enregistré dans Crédits garde les anciennes valeurs.
- **Glisser-déposer interne inopérant** (fichier de l'arborescence vers le chat de Code, cartes du Planner) : sous Windows, WebView2 intercepte le drag & drop HTML5 quand le dépôt de fichiers de l'Explorateur est actif. Nouveau glisser-déposer au pointeur (`@/core/dnd`) ; le dépôt depuis l'Explorateur reste disponible.

### Publication
- Projet publié sous **licence MIT** sur GitHub (`Kaylloggs/SDAI-ARCHIMED`).
- `README.md` public en anglais : fonctionnalités, modules, étapes d'installation (prérequis, CLI, clonage, lancement, compilation du `.exe`).

### Ajouté — Aperçu, panneaux et contrôle des réponses
- **Aperçu web** : serveurs de test lancés par l'agent (URL locales citées, `pnpm dev`, `python -m http.server`…, ports sondés toutes les 4 s) et pages HTML créées. Colonne d'aperçu dans le module Code (bouton globe, pastille verte si un serveur répond) ; pastille discrète dans l'en-tête du Chat.
- **Module Code** : panneaux redimensionnables (arborescence, éditeur, aperçu, assistant) ; **arborescence, onglets et aperçu mis à jour automatiquement** quand des fichiers changent sur disque.
- **Bouton Arrêter** (ou `Échap`) pendant que l'agent réfléchit ou répond ; le message suivant reprend la même conversation.
- **Relance automatique** d'une réponse coupée (agent arrêté juste après une action, sans conclure), invisible, 3 fois de suite au plus.

### Corrigé
- **Antigravity s'arrêtait en pleine réponse** : `--print-timeout` d'agy (5 min par défaut) coupait le tour en annonçant un succès. Délai porté à 24 h.
- Texte sans espace (chemins, URL) qui débordait des bulles et des cartes de la conversation.

### Ajouté — Versions et releases
- **Version incrémentée automatiquement à chaque build de release** (`build.ps1`, `patch` par défaut ; `-Bump minor|major|none`) : `package.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`, et datation de la section du CHANGELOG. La version affichée dans Réglages suit.
- `build.ps1 -Publish` : commit de version, tag `vX.Y.Z`, push et release GitHub avec les installeurs (GitHub CLI).
- `pnpm version:bump` pour changer de version sans compiler.

### Connu / à faire (Phase 3)
- Génération des types TS depuis Rust (`ts-rs`) : seuls les codes d'erreur sont générés, les types du moteur sont encore recopiés à la main.
- Envoi natif des images aux CLI qui le supportent (aujourd'hui : chemins transmis à l'agent).
- Validation des flags Codex sur une machine où la CLI est installée ; reprise de contexte Codex (`codex exec resume`).
- Synchronisation bidirectionnelle avec l'API Google Calendar (nécessite un identifiant OAuth Google Cloud fourni par l'utilisateur).
