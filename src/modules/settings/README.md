# Module `settings`

Réglages globaux. Liste tous les modules découverts, affiche les manifests invalides, et agrège les panneaux de réglages fournis par les autres modules (`manifest.settings`).

- **Navigation** (`index.tsx`) : liste des catégories à gauche (Application : Thème, Assistants IA, Économie de tokens ; Système : Modules, Mises à jour, Données ; puis les réglages des modules), redimensionnable ; un clic fait défiler jusqu'à la section, la section lue est surlignée. Un autre écran peut ouvrir une section : `openModule("settings", { section: "agents" })`.
- **Assistants IA** (`components/EngineSection.tsx`) : CLI détectées (PATH, emplacements connus, chemin forcé), version, **Installer** (Claude Code par le script officiel d'Anthropic, Codex par npm avec Node.js installé par winget si besoin ; `engine_install_cli`, avancement par `engine:install`), **Télécharger** (Antigravity, page officielle), **Se connecter** (terminal ouvert sur la CLI, `engine_open_cli_terminal` : ARCHIMED ne voit pas les identifiants), choisir l'exécutable, revenir à la détection automatique, ajouter une CLI par fichier TOML.

- **Modules** (`components/ModulesSection.tsx`) : interrupteur pour activer ou désactiver (tout est gardé), corbeille pour **supprimer** : confirmation dans la carte avec ce qui partira (taille des données, outils des agents, clés d'API), puis `removeModule` (`@/core/modules`) ; les modules supprimés se remettent depuis « Modules supprimés ». Voir architecture.md §5.2.bis.

- **Économie de tokens** (`components/TokenSaverSection.tsx`) : active le mode caveman embarqué (`@/core/engine/tokenSaver`, niveaux léger / standard / maximal), appliqué à tous les prompts envoyés aux CLI.

- **Backend** : aucun pour l'instant (persistance via zustand/localStorage ; migration vers `tauri-plugin-store` en Phase 2).
- **Obligatoire** : oui.
