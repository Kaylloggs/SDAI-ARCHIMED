# CLAUDE.md

Projet SDAI ARCHIMED. Avant toute modification, lire dans l'ordre :
1. `guidelines.md` — règles obligatoires (modularité, nommage, sécurité, Definition of Done)
2. `architecture.md` — IPC, moteur multi-CLI, Parsing Intelligent, système de modules
3. `design.md` — obligatoire pour tout travail UI (charger les skills `ui-ux-pro-max`, `apple-design`, `impeccable`)

Règle n°1 : une fonctionnalité = un module dans `src/modules/<id>/` (+ `src-tauri/src/modules/<id>/`). Le core n'importe jamais un module ; les modules ne s'importent pas entre eux.

Commandes : `pnpm tauri dev` · `pnpm check` · `pnpm test` · `pnpm new:module <id>` · `.\build.ps1`
