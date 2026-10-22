use std::path::{Path, PathBuf};

/// Folders that are build output, caches or tooling state: never worth showing or searching.
pub const IGNORED_DIRS: &[&str] = &[
    ".git", ".hg", ".svn", ".vs", ".idea", ".vscode", "node_modules", "bin", "obj", "target",
    "dist", "out", "Library", "Temp", "Logs", "UserSettings", ".next", ".gradle", "__pycache__",
];

pub fn is_ignored_dir(name: &str) -> bool {
    IGNORED_DIRS.contains(&name)
}

/// Depth-first walk over every file under `root`, skipping ignored folders.
/// Stops early once `limit` files have been visited.
pub fn walk_files(root: &Path, limit: usize, mut visit: impl FnMut(&Path)) {
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];
    let mut seen = 0usize;
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_dir() {
                let name = entry.file_name();
                if !is_ignored_dir(&name.to_string_lossy()) {
                    stack.push(path);
                }
                continue;
            }
            visit(&path);
            seen += 1;
            if seen >= limit {
                return;
            }
        }
    }
}
