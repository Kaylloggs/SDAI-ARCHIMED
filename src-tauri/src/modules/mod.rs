//! Registre des modules backend.
//! Une ligne `register!` par module — ajoutée par `pnpm new:module`.
//! `build.rs` vérifie la cohérence avec les dossiers `module.toml` et échoue sinon.

pub mod code;
pub mod skills;

macro_rules! register {
    ($builder:expr, $module:ident) => {
        $builder = $builder.plugin($module::plugin());
    };
}

pub fn register_all<R: tauri::Runtime>(
    mut builder: tauri::Builder<R>,
) -> tauri::Builder<R> {
    register!(builder, code);
    register!(builder, skills);
    builder
}
