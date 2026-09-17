//! Construction des processus enfants.
//!
//! Dans l'exécutable compilé (sous-système « windows », sans console), chaque programme
//! console lancé sans `CREATE_NO_WINDOW` ouvre une fenêtre cmd visible.
//! **Tout lancement de processus passe par ces fonctions** (guidelines.md §10).

use std::ffi::OsStr;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// `std::process::Command` sans fenêtre de console.
pub fn command(program: impl AsRef<OsStr>) -> std::process::Command {
    #[allow(unused_mut)]
    let mut command = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// `tokio::process::Command` sans fenêtre de console.
pub fn async_command(program: impl AsRef<OsStr>) -> tokio::process::Command {
    #[allow(unused_mut)]
    let mut command = tokio::process::Command::new(program);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}
