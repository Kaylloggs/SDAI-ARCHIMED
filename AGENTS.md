# AGENTS.md

Point d'entrée pour tout agent IA (Antigravity, Codex, etc.). Contenu identique à `CLAUDE.md` :

1. Lire `guidelines.md` (règles obligatoires), puis `architecture.md`, puis `design.md` pour l'UI.
2. Une fonctionnalité = un module auto-découvert (`src/modules/<id>/`, backend optionnel `src-tauri/src/modules/<id>/`).
3. Vérifier avant de terminer : `pnpm check`, `pnpm test`, `cargo clippy -- -D warnings`, `cargo test` (dans `src-tauri`).
4. Mettre à jour la documentation dans le même changement que le code.
