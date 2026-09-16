# ADR 0002 — Un module backend = un plugin Tauri inline

- **Date** : 2026-09-16
- **Statut** : accepté

## Contexte

`tauri::generate_handler!` centralise toutes les commandes dans un unique appel : chaque nouveau module obligerait à modifier un fichier partagé, ce qui contredit l'objectif « supprimer un module ne casse rien ».

## Décision

Chaque module backend expose `pub fn plugin<R: Runtime>() -> TauriPlugin<R>` avec son propre `invoke_handler` et son propre état. Un `module.toml` déclare l'id et les commandes ; `build.rs` :

1. découvre les `module.toml`,
2. déclare les plugins inline (`tauri_build::InlinedPlugin`) pour le système de capabilities,
3. régénère `capabilities/modules.generated.json`,
4. **échoue** si un module n'est pas enregistré dans `src/modules/mod.rs`.

Le frontend appelle `invoke("plugin:<id>|<command>")` via `invokeModule`.

## Conséquences

- **Positif** : isolation des commandes, de l'état et des permissions par module ; ajout d'un module = un dossier + une ligne générée par le scaffolder.
- **Positif** : erreur de build explicite en cas d'oubli d'enregistrement.
- **Négatif** : les commandes utilisant `AppHandle` doivent être génériques sur `R: Runtime`.
