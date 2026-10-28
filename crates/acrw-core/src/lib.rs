//! ACRW core: Git changesets, scanner orchestration and local persistence.
//! Read-only with respect to the repositories it reviews.

pub mod db;
pub mod engine;
pub mod git;
pub mod model;
pub mod scan;

pub use model::*;

/// A process builder that does not flash a console window on Windows.
pub(crate) fn command(program: impl AsRef<std::ffi::OsStr>) -> std::process::Command {
    #[allow(unused_mut)]
    let mut c = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}
pub use anyhow;
pub use rusqlite::Connection;
