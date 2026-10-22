//! Project-wide text search (Find in Files) and a quick declaration index
//! (Go to type / Go to symbol). Both walk the folder on a worker thread.

use std::path::Path;
use std::sync::LazyLock;

use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};

use crate::walk::walk_files;

const MAX_FILE_BYTES: u64 = 2_000_000;
const MAX_LINE_CHARS: usize = 400;
const MAX_FILES: usize = 200_000;

/// Files the explorer hides by default; searched only when asked.
static NOISE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(\.meta|\.csproj|\.sln|\.dotsettings(\.user)?|\.lock)$|^replay_pid.*\.log$").unwrap());

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    root: String,
    query: String,
    case_sensitive: bool,
    whole_word: bool,
    regex: bool,
    /// Comma-separated globs on the file name, e.g. `*.cs, *.ts`. Empty means all files.
    file_mask: String,
    include_hidden: bool,
    max_results: usize,
}

#[derive(Serialize)]
pub struct SearchMatch {
    path: String,
    /// 1-based.
    line: usize,
    /// UTF-16 offset of the match in the line, to line up with the editor's positions.
    col: usize,
    len: usize,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    matches: Vec<SearchMatch>,
    files_with_matches: usize,
    truncated: bool,
}

fn mask_regex(mask: &str) -> Option<Regex> {
    let globs: Vec<String> = mask
        .split([',', ';'])
        .map(str::trim)
        .filter(|g| !g.is_empty())
        .map(|g| {
            let mut re = String::from("^");
            for ch in g.chars() {
                match ch {
                    '*' => re.push_str(".*"),
                    '?' => re.push('.'),
                    c => re.push_str(&regex::escape(&c.to_string())),
                }
            }
            re.push('$');
            re
        })
        .collect();
    if globs.is_empty() {
        return None;
    }
    RegexBuilder::new(&globs.join("|")).case_insensitive(true).build().ok()
}

fn read_text_file(path: &Path) -> Option<String> {
    if std::fs::metadata(path).map(|m| m.len() > MAX_FILE_BYTES).unwrap_or(true) {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    if bytes.iter().take(8000).any(|b| *b == 0) {
        return None;
    }
    String::from_utf8(bytes).ok()
}

fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

fn run_search(opts: SearchOptions) -> Result<SearchResult, String> {
    let mut pattern = if opts.regex { opts.query.clone() } else { regex::escape(&opts.query) };
    if opts.whole_word {
        pattern = format!(r"\b(?:{pattern})\b");
    }
    let re = RegexBuilder::new(&pattern)
        .case_insensitive(!opts.case_sensitive)
        .build()
        .map_err(|e| format!("Invalid pattern: {e}"))?;
    let mask = mask_regex(&opts.file_mask);

    let mut matches = Vec::new();
    let mut files_with_matches = 0;
    let mut truncated = false;
    walk_files(Path::new(&opts.root), MAX_FILES, |path| {
        if truncated {
            return;
        }
        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        if !opts.include_hidden && NOISE.is_match(&name) {
            return;
        }
        if let Some(mask) = &mask {
            if !mask.is_match(&name) {
                return;
            }
        }
        let Some(text) = read_text_file(path) else { return };
        let mut found_here = false;
        for (index, line) in text.lines().enumerate() {
            for m in re.find_iter(line) {
                if m.as_str().is_empty() {
                    continue;
                }
                found_here = true;
                matches.push(SearchMatch {
                    path: path.to_string_lossy().to_string(),
                    line: index + 1,
                    col: utf16_len(&line[..m.start()]),
                    len: utf16_len(m.as_str()),
                    text: line.chars().take(MAX_LINE_CHARS).collect(),
                });
                if matches.len() >= opts.max_results {
                    truncated = true;
                    break;
                }
            }
            if truncated {
                break;
            }
        }
        if found_here {
            files_with_matches += 1;
        }
    });
    Ok(SearchResult { matches, files_with_matches, truncated })
}

#[tauri::command]
pub async fn search_project(options: SearchOptions) -> Result<SearchResult, String> {
    tauri::async_runtime::spawn_blocking(move || run_search(options)).await.map_err(|e| e.to_string())?
}

#[derive(Serialize)]
pub struct IndexedSymbol {
    name: String,
    /// `type` or `function`.
    kind: &'static str,
    /// The declaring keyword, e.g. `class`, `struct`, `def`, or `method`.
    detail: String,
    path: String,
    line: usize,
}

const INDEXED_EXTENSIONS: &[&str] = &[
    "cs", "ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "kt", "swift", "dart", "cpp", "cc", "h", "hpp", "scala",
];

static TYPE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^\s*(?:(?:public|private|protected|internal|static|abstract|sealed|partial|readonly|export|default|declare|data|open|final|inline|unsafe|pub(?:\([^)]*\))?)\s+)*(class|struct|interface|enum|record|trait|type|object|protocol)\s+([A-Za-z_]\w*)",
    )
    .unwrap()
});
/// `def`, `fn`, `func`, `function` and `fun` declarations, Go receivers included.
static KEYWORD_FN_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^\s*(?:(?:pub(?:\([^)]*\))?|async|export|default|static|private|public|protected|override|open|suspend|inline|unsafe|const|extern)\s+)*(def|fn|func|function|fun)\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)",
    )
    .unwrap()
});
/// C#/Java/C++ methods: `[modifiers] Type Name(` on a line that isn't a statement.
static METHOD_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^\s+(?:(?:public|private|protected|internal|static|virtual|override|abstract|async|sealed|extern|unsafe|new|final|synchronized|inline)\s+)*(?:[A-Za-z_][\w.]*(?:<[^()]*>)?(?:\[\])?\??)\s+([A-Za-z_]\w*)\s*(?:<[^()]*>)?\s*\([^;]*$",
    )
    .unwrap()
});
const NOT_METHODS: &[&str] = &["if", "for", "foreach", "while", "switch", "catch", "using", "lock", "return", "else", "new", "await", "nameof", "typeof"];
const NOT_RETURN_TYPES: &[&str] = &["return", "new", "else", "await", "throw", "yield", "case", "goto", "using", "var"];

fn index_file(path: &Path, text: &str, out: &mut Vec<IndexedSymbol>) {
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let brace_methods = matches!(ext.as_str(), "cs" | "java" | "cpp" | "cc" | "h" | "hpp" | "dart");
    let file = path.to_string_lossy().to_string();
    for (index, line) in text.lines().enumerate() {
        if let Some(c) = TYPE_RE.captures(line) {
            out.push(IndexedSymbol { name: c[2].to_string(), kind: "type", detail: c[1].to_string(), path: file.clone(), line: index + 1 });
        } else if let Some(c) = KEYWORD_FN_RE.captures(line) {
            out.push(IndexedSymbol { name: c[2].to_string(), kind: "function", detail: c[1].to_string(), path: file.clone(), line: index + 1 });
        } else if brace_methods {
            let Some(c) = METHOD_RE.captures(line) else { continue };
            let first_word = line.trim_start().split_whitespace().next().unwrap_or("");
            if NOT_METHODS.contains(&&c[1]) || NOT_RETURN_TYPES.contains(&first_word) || line.contains('=') {
                continue;
            }
            out.push(IndexedSymbol { name: c[1].to_string(), kind: "function", detail: "method".into(), path: file.clone(), line: index + 1 });
        }
    }
}

fn run_index(root: String) -> Vec<IndexedSymbol> {
    let mut out = Vec::new();
    walk_files(Path::new(&root), MAX_FILES, |path| {
        let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
        if !INDEXED_EXTENSIONS.contains(&ext.as_str()) {
            return;
        }
        if let Some(text) = read_text_file(path) {
            index_file(path, &text, &mut out);
        }
    });
    out
}

#[tauri::command]
pub async fn index_symbols(root: String) -> Result<Vec<IndexedSymbol>, String> {
    tauri::async_runtime::spawn_blocking(move || run_index(root)).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn index(name: &str, src: &str) -> Vec<(String, &'static str, String)> {
        let mut out = Vec::new();
        index_file(Path::new(name), src, &mut out);
        out.into_iter().map(|s| (s.name, s.kind, s.detail)).collect()
    }

    #[test]
    fn indexes_csharp_types_and_methods() {
        let src = "namespace A\n{\n    public sealed class Player : MonoBehaviour\n    {\n        void Update()\n        {\n            var x = Foo(1);\n            return Bar();\n        }\n        public static Task<int> LoadAsync<T>(string path)\n        {\n        }\n    }\n    struct Cell { }\n}\n";
        let found = index("a.cs", src);
        assert_eq!(
            found,
            vec![
                ("Player".into(), "type", "class".into()),
                ("Update".into(), "function", "method".into()),
                ("LoadAsync".into(), "function", "method".into()),
                ("Cell".into(), "type", "struct".into()),
            ]
        );
    }

    #[test]
    fn indexes_keyword_languages() {
        assert_eq!(index("a.py", "class Ship(Base):\n    def move(self):\n        pass\n"), vec![
            ("Ship".into(), "type", "class".into()),
            ("move".into(), "function", "def".into()),
        ]);
        assert_eq!(index("a.rs", "pub struct Grid;\nimpl Grid {\n    pub fn new() -> Self {}\n}\n"), vec![
            ("Grid".into(), "type", "struct".into()),
            ("new".into(), "function", "fn".into()),
        ]);
        assert_eq!(index("a.go", "type Server struct {}\nfunc (s *Server) Start() {}\n"), vec![
            ("Server".into(), "type", "type".into()),
            ("Start".into(), "function", "func".into()),
        ]);
    }

    #[test]
    fn file_masks_match_names() {
        let re = mask_regex("*.cs, *.ts").unwrap();
        assert!(re.is_match("Player.cs"));
        assert!(re.is_match("app.TS"));
        assert!(!re.is_match("Player.cs.meta"));
        assert!(mask_regex("  ").is_none());
    }
}
