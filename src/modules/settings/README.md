# Module `settings`

Réglages globaux. Liste tous les modules découverts, affiche les manifests invalides, et agrège les panneaux de réglages fournis par les autres modules (`manifest.settings`).

- **Modules** (`components/ModulesSection.tsx`) : interrupteur pour activer ou désactiver (tout est gardé), corbeille pour **supprimer** : confirmation dans la carte avec ce qui partira (taille des données, outils des agents, clés d'API), puis `removeModule` (`@/core/modules`) ; les modules supprimés se remettent depuis « Modules supprimés ». Voir architecture.md §5.2.bis.

- **Économie de tokens** (`components/TokenSaverSection.tsx`) : active le mode caveman embarqué (`@/core/engine/tokenSaver`, niveaux léger / standard / maximal), appliqué à tous les prompts envoyés aux CLI.

- **Backend** : aucun pour l'instant (persistance via zustand/localStorage ; migration vers `tauri-plugin-store` en Phase 2).
- **Obligatoire** : oui.
