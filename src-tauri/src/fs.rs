use std::path::Path;

use regex::Regex;
use serde::Serialize;

use crate::walk::{is_ignored_dir, walk_files};

#[derive(Serialize)]
pub struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
}

#[derive(Serialize)]
pub struct TypeLocation {
    name: String,
    path: String,
    line: usize,
}

const MAX_SEARCH_FILE_BYTES: u64 = 1_000_000;

#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let entries = std::fs::read_dir(&path).map_err(|e| format!("Can't read {path}: {e}"))?;
    let mut out: Vec<DirEntry> = entries
        .flatten()
        .filter_map(|entry| {
            let file_type = entry.file_type().ok()?;
            // A link to a folder opens like a folder.
            let is_dir = file_type.is_dir() || (file_type.is_symlink() && entry.path().is_dir());
            let name = entry.file_name().to_string_lossy().to_string();
            if is_dir && is_ignored_dir(&name) {
                return None;
            }
            Some(DirEntry { path: entry.path().to_string_lossy().to_string(), name, is_dir })
        })
        .collect();
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

#[tauri::command]
pub fn read_text(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("Can't open {path}: {e}"))?;
    // Strip a UTF-8 BOM so it doesn't show up as a stray character in the editor.
    let body = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes);
    String::from_utf8(body.to_vec()).map_err(|_| format!("{path} isn't a UTF-8 text file"))
}

#[tauri::command]
pub fn write_text(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Can't create {}: {e}", parent.display()))?;
    }
    std::fs::write(&path, content).map_err(|e| format!("Can't save {path}: {e}"))
}

#[tauri::command]
pub fn list_files(root: String) -> Vec<String> {
    let mut files = Vec::new();
    walk_files(Path::new(&root), 50_000, |p| files.push(p.to_string_lossy().to_string()));
    files
}

/// Finds where the named types are declared, by scanning source files for
/// `class Name`, `struct Name` and friends. Used when no language server is running.
#[tauri::command]
pub fn find_type_definitions(root: String, names: Vec<String>, extensions: Vec<String>) -> Result<Vec<TypeLocation>, String> {
    let names: Vec<String> = names.into_iter().filter(|n| n.chars().all(|c| c.is_alphanumeric() || c == '_')).collect();
    if names.is_empty() {
        return Ok(Vec::new());
    }
    let pattern = format!(
        r"\b(?:class|struct|interface|enum|record|trait|type)\s+({})\b",
        names.join("|")
    );
    let re = Regex::new(&pattern).map_err(|e| e.to_string())?;
    let mut found = Vec::new();
    walk_files(Path::new(&root), 100_000, |path| {
        let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
        if !extensions.iter().any(|e| *e == ext) {
            return;
        }
        if std::fs::metadata(path).map(|m| m.len() > MAX_SEARCH_FILE_BYTES).unwrap_or(true) {
            return;
        }
        let Ok(text) = std::fs::read_to_string(path) else { return };
        for (index, line) in text.lines().enumerate() {
            if let Some(caps) = re.captures(line) {
                found.push(TypeLocation {
                    name: caps[1].to_string(),
                    path: path.to_string_lossy().to_string(),
                    line: index + 1,
                });
            }
        }
    });
    Ok(found)
}

#[tauri::command]
pub fn create_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| format!("Can't create {path}: {e}"))
}

/// `missing`, `empty` (an empty folder), or `used` (a file, or a folder with something in it).
#[tauri::command]
pub fn path_state(path: String) -> &'static str {
    let p = Path::new(&path);
    if !p.exists() {
        "missing"
    } else if p.is_dir() && std::fs::read_dir(p).map(|mut d| d.next().is_none()).unwrap_or(false) {
        "empty"
    } else {
        "used"
    }
}
