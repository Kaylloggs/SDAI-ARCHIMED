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

### Connu / à faire (Phase 2)
- Transport PTY (`portable-pty` + `vt100`) et règles de détection TOML pour les CLI sans protocole.
- Validation interactive des permissions Antigravity (aujourd'hui refus automatique en headless).
- Génération des types TS depuis Rust (`ts-rs`) branchée dans `pnpm gen:bindings`.
- Persistance des conversations côté Rust (`sessions/<id>.jsonl`) au lieu du `localStorage`.
- Continuité de contexte au redémarrage d'un processus (`--resume` Claude, `--conversation` agy, `codex exec resume`).
- Envoi natif des images aux CLI qui le supportent (aujourd'hui : chemins transmis à l'agent).
- Validation des flags Codex sur une machine où la CLI est installée.
