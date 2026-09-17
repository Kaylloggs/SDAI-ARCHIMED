# Module `settings`

Réglages globaux. Liste tous les modules découverts (activation/désactivation), affiche les manifests invalides, et agrège les panneaux de réglages fournis par les autres modules (`manifest.settings`).

- **Économie de tokens** (`components/TokenSaverSection.tsx`) : active le mode caveman embarqué (`@/core/engine/tokenSaver`, niveaux léger / standard / maximal), appliqué à tous les prompts envoyés aux CLI.

- **Backend** : aucun pour l'instant (persistance via zustand/localStorage ; migration vers `tauri-plugin-store` en Phase 2).
- **Obligatoire** : oui.
