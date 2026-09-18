//! Registre des modules backend — **généré** par `build.rs` à partir des dossiers présents.
//!
//! Ajouter un module = créer `src/modules/<id>/` avec son `module.toml` et son `plugin()`.
//! Le supprimer = supprimer le dossier. Aucun fichier partagé à modifier, donc aucun
//! module privé ne laisse de trace dans les fichiers versionnés.
include!(concat!(env!("OUT_DIR"), "/modules.rs"));
