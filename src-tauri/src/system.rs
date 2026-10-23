use std::path::PathBuf;
use std::process::Command;

use tauri::{AppHandle, Manager};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Builds a `Command` for a program found on PATH. Windows `.cmd`/`.bat` shims
/// (how npm installs CLIs) can't be spawned directly, so they go through `cmd /c`.
pub fn resolve_command(program: &str, args: &[String]) -> Result<Command, String> {
    let path = find_program(program).ok_or_else(|| format!("{program} isn't installed or isn't on PATH"))?;
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let mut cmd = if ext == "cmd" || ext == "bat" {
        let mut c = Command::new("cmd");
        c.arg("/c").arg(&path);
        c
    } else {
        Command::new(&path)
    };
    cmd.args(args);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    Ok(cmd)
}

/// Where per-user tool installers put programs, in case they aren't on PATH yet.
fn tool_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        let home = PathBuf::from(home);
        for sub in ["go/bin", ".cargo/bin", ".dotnet/tools", ".local/bin", ".bun/bin"] {
            dirs.push(home.join(sub));
        }
    }
    if let Some(appdata) = std::env::var_os("APPDATA") {
        dirs.push(PathBuf::from(appdata).join("npm"));
    }
    dirs
}

/// Like `which`, but also looks in the usual per-user tool folders.
pub fn find_program(program: &str) -> Option<PathBuf> {
    if let Ok(path) = which::which(program) {
        return Some(path);
    }
    let path_var = std::env::var_os("PATH").unwrap_or_default();
    let mut paths: Vec<PathBuf> = tool_dirs();
    paths.extend(std::env::split_paths(&path_var));
    let joined = std::env::join_paths(paths).ok()?;
    let cwd = std::env::current_dir().ok()?;
    which::which_in(program, Some(joined), cwd).ok()
}

#[tauri::command]
pub fn which_program(program: String) -> Option<String> {
    find_program(&program).map(|p| p.to_string_lossy().to_string())
}

/// Re-reads PATH from the registry (user + machine), so tools an installer just
/// added are found without restarting Whisk. Child processes inherit it too.
#[tauri::command]
pub fn refresh_path() {
    #[cfg(windows)]
    {
        let read = |key: &str| -> Option<String> {
            let out = Command::new("reg").args(["query", key, "/v", "Path"]).creation_flags(CREATE_NO_WINDOW).output().ok()?;
            let text = String::from_utf8_lossy(&out.stdout).to_string();
            let line = text.lines().find(|l| l.trim_start().starts_with("Path"))?.to_string();
            let value = line.splitn(2, "REG_").nth(1)?.splitn(2, ' ').nth(1)?.trim().to_string();
            Some(expand_env(&value))
        };
        let machine = read(r"HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment");
        let user = read(r"HKCU\Environment");
        let current = std::env::var("PATH").unwrap_or_default();
        let mut seen = std::collections::HashSet::new();
        let merged: Vec<String> = [current, machine.unwrap_or_default(), user.unwrap_or_default()]
            .iter()
            .flat_map(|p| p.split(';').map(str::to_string).collect::<Vec<_>>())
            .filter(|p| !p.trim().is_empty() && seen.insert(p.to_lowercase()))
            .collect();
        // SAFETY: called from a command handler; nothing else mutates the environment concurrently.
        unsafe { std::env::set_var("PATH", merged.join(";")) };
    }
}

#[cfg(windows)]
fn expand_env(value: &str) -> String {
    let mut out = String::new();
    let mut rest = value;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) => {
                let name = &after[..end];
                out.push_str(&std::env::var(name).unwrap_or_else(|_| format!("%{name}%")));
                rest = &after[end + 1..];
            }
            None => {
                out.push_str(&rest[start..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(|e| e.to_string())
}

/// Opens a new terminal window in `cwd` running `args` (program first).
/// Prefers Windows Terminal, falling back to a plain console.
#[tauri::command]
pub fn open_in_terminal(cwd: String, args: Vec<String>) -> Result<(), String> {
    if args.is_empty() {
        return Err("Nothing to run".into());
    }
    #[cfg(windows)]
    {
        let mut cmd = if which::which("wt").is_ok() {
            let mut c = Command::new("wt");
            c.arg("-d").arg(&cwd).args(&args);
            c
        } else {
            let mut c = Command::new("cmd");
            c.args(["/c", "start", "", "/D"]).arg(&cwd).args(["cmd", "/k"]).args(&args);
            c
        };
        cmd.current_dir(&cwd).creation_flags(CREATE_NO_WINDOW);
        cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        Command::new(&args[0]).args(&args[1..]).current_dir(&cwd).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn write_temp(name: String, content: String) -> Result<String, String> {
    let safe: String = name.chars().map(|c| if c.is_alphanumeric() || c == '.' || c == '-' { c } else { '_' }).collect();
    let mut path: PathBuf = std::env::temp_dir().join("whisk");
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    path.push(safe);
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// Where user plugins live: `~/.whisk/plugins/<plugin>/plugin.js`. Created on first ask.
/// The home folder rather than AppData, because Windows redirects AppData for apps
/// launched from packaged (MSIX) apps, which leaves Explorer unable to open it.
#[tauri::command]
pub fn plugins_dir(app: AppHandle) -> Result<String, String> {
    let dir = app.path().home_dir().map_err(|e| e.to_string())?.join(".whisk").join("plugins");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

#[derive(serde::Serialize)]
pub struct StartupArgs {
    folder: Option<String>,
    files: Vec<String>,
}

/// `scope <folder> [file…]` opens the folder, then the files, like `code .` does.
#[tauri::command]
pub fn startup_args() -> StartupArgs {
    let mut folder = None;
    let mut files = Vec::new();
    for arg in std::env::args().skip(1) {
        let path = std::path::Path::new(&arg);
        let Ok(full) = std::fs::canonicalize(path) else { continue };
        // canonicalize() returns Windows long-path form (`\\?\F:\…`); editors and language servers want `F:\…`.
        let full = full.to_string_lossy().trim_start_matches(r"\\?\").to_string();
        if path.is_dir() && folder.is_none() {
            folder = Some(full);
        } else if path.is_file() {
            files.push(full);
        }
    }
    StartupArgs { folder, files }
}

#[derive(Clone, serde::Serialize)]
struct InstallOutput {
    id: u32,
    line: String,
}

#[derive(Clone, serde::Serialize)]
struct InstallExit {
    id: u32,
    code: Option<i32>,
}

/// Process ids of commands started by `run_command`, so they can be stopped.
static RUNNING: std::sync::Mutex<Option<std::collections::HashMap<u32, u32>>> = std::sync::Mutex::new(None);

/// Streams a pipe line by line, keeping lines that aren't valid UTF-8 (some
/// tools print in the console's code page) rather than stopping at them.
fn stream_lines(pipe: impl std::io::Read, mut on_line: impl FnMut(String)) {
    use std::io::BufRead;
    let mut reader = std::io::BufReader::new(pipe);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                let line = String::from_utf8_lossy(&buf);
                on_line(line.trim_end_matches(['\r', '\n']).to_string());
            }
        }
    }
}

/// Runs a command line (an install such as `npm install --global pyright`, a
/// project template such as `dotnet new console`, or a test run) through the
/// system shell in `cwd`, streaming its output as `install-output` events and
/// finishing with `install-exit`. Only ever called from something the user did.
#[tauri::command]
pub fn run_command(app: AppHandle, id: u32, command_line: String, cwd: Option<String>) -> Result<(), String> {
    use std::process::Stdio;
    use tauri::Emitter;

    #[cfg(windows)]
    let mut cmd = {
        let mut c = Command::new("cmd");
        // Verbatim: Rust's argument quoting escapes quotes as \", which cmd.exe doesn't understand.
        // With /s, cmd strips the outer quotes and runs the rest exactly as written.
        c.arg("/d").arg("/s").arg("/c").raw_arg(format!("\"{command_line}\"")).creation_flags(CREATE_NO_WINDOW);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = Command::new("sh");
        c.arg("-c").arg(&command_line);
        c
    };
    if let Some(dir) = &cwd {
        cmd.current_dir(dir);
    }
    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Couldn't run {command_line}: {e}"))?;
    RUNNING.lock().unwrap().get_or_insert_with(Default::default).insert(id, child.id());

    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;
    let err_app = app.clone();
    let err_thread = std::thread::spawn(move || {
        stream_lines(stderr, |line| {
            let _ = err_app.emit("install-output", InstallOutput { id, line });
        });
    });
    std::thread::spawn(move || {
        stream_lines(stdout, |line| {
            let _ = app.emit("install-output", InstallOutput { id, line });
        });
        let _ = err_thread.join();
        let code = child.wait().ok().and_then(|s| s.code());
        if let Some(map) = RUNNING.lock().unwrap().as_mut() {
            map.remove(&id);
        }
        let _ = app.emit("install-exit", InstallExit { id, code });
    });
    Ok(())
}

/// Stops a command started by `run_command`, with everything it started.
#[tauri::command]
pub fn kill_command(id: u32) -> Result<(), String> {
    let pid = RUNNING.lock().unwrap().as_ref().and_then(|m| m.get(&id).copied());
    let Some(pid) = pid else { return Ok(()) };
    #[cfg(windows)]
    {
        Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        Command::new("kill").arg(pid.to_string()).output().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn copy_text(app: AppHandle, text: String) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard().write_text(text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn paste_text(app: AppHandle) -> Result<String, String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard().read_text().map_err(|e| e.to_string())
}

const MAX_LOG_BYTES: u64 = 1_000_000;

/// Appends a line to `~/.whisk/logs/whisk.log`, starting afresh (keeping the
/// previous file as `whisk.old.log`) once it passes 1 MB.
#[tauri::command]
pub fn append_log(app: AppHandle, line: String) -> Result<(), String> {
    use std::io::Write;
    let dir = app.path().home_dir().map_err(|e| e.to_string())?.join(".whisk").join("logs");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("whisk.log");
    if std::fs::metadata(&path).map(|m| m.len() > MAX_LOG_BYTES).unwrap_or(false) {
        let _ = std::fs::rename(&path, dir.join("whisk.old.log"));
    }
    let mut file = std::fs::OpenOptions::new().create(true).append(true).open(&path).map_err(|e| e.to_string())?;
    writeln!(file, "{line}").map_err(|e| e.to_string())
}
