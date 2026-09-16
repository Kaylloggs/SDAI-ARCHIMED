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

### Connu / à faire (Phase 2)
- Transport PTY (`portable-pty` + `vt100`) et règles de détection TOML pour les CLI sans protocole.
- Validation interactive des permissions Antigravity (aujourd'hui refus automatique en headless).
- Génération des types TS depuis Rust (`ts-rs`) branchée dans `pnpm gen:bindings`.
- Persistance des conversations côté Rust (`sessions/<id>.jsonl`) au lieu du `localStorage`, journal d'audit.
- Continuité de contexte au redémarrage d'un processus (`--resume` Claude, `--conversation` agy, `codex exec resume`).
- Envoi natif des images aux CLI qui le supportent (aujourd'hui : chemins transmis à l'agent).
- Validation des flags Codex sur une machine où la CLI est installée.
