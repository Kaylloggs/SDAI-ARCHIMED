# Changelog

Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versions en [SemVer](https://semver.org/lang/fr/).

## [Non publié]

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

### Connu / à faire (Phase 3)
- Génération des types TS depuis Rust (`ts-rs`) : seuls les codes d'erreur sont générés, les types du moteur sont encore recopiés à la main.
- Envoi natif des images aux CLI qui le supportent (aujourd'hui : chemins transmis à l'agent).
- Validation des flags Codex sur une machine où la CLI est installée ; reprise de contexte Codex (`codex exec resume`).
- Synchronisation bidirectionnelle avec l'API Google Calendar (nécessite un identifiant OAuth Google Cloud fourni par l'utilisateur).
