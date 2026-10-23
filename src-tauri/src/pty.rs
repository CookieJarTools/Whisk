use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

use crate::system::find_program;

/// Terminals: each is a real pseudo-terminal (ConPTY on Windows) running a
/// shell or a program, streamed to xterm.js in the interface.
struct Pty {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Default)]
pub struct PtyState {
    next_id: AtomicU32,
    ptys: Arc<Mutex<HashMap<u32, Pty>>>,
}

#[derive(Clone, Serialize)]
struct PtyOutput {
    id: u32,
    data: String,
}

#[derive(Clone, Serialize)]
struct PtyExit {
    id: u32,
    code: Option<u32>,
}

/// PowerShell 7 if it's installed, else Windows PowerShell; $SHELL elsewhere.
fn default_shell() -> String {
    #[cfg(windows)]
    {
        if find_program("pwsh").is_some() {
            return "pwsh.exe".into();
        }
        "powershell.exe".into()
    }
    #[cfg(not(windows))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into())
    }
}

/// The longest prefix of `bytes` that is whole UTF-8; the rest waits for the next read.
fn split_utf8(bytes: &[u8]) -> usize {
    match std::str::from_utf8(bytes) {
        Ok(_) => bytes.len(),
        Err(e) if e.error_len().is_none() => e.valid_up_to(),
        Err(_) => bytes.len(),
    }
}

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    state: State<'_, PtyState>,
    cwd: String,
    program: Option<String>,
    args: Vec<String>,
    env: Option<HashMap<String, String>>,
    cols: u16,
    rows: u16,
) -> Result<u32, String> {
    let pair = native_pty_system()
        .openpty(PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let program = program.unwrap_or_else(default_shell);
    let resolved = find_program(&program).map(|p| p.to_string_lossy().into_owned()).unwrap_or(program.clone());
    let mut cmd = CommandBuilder::new(resolved);
    cmd.args(&args);
    cmd.cwd(&cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    for (k, v) in env.unwrap_or_default() {
        cmd.env(k, v);
    }
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| format!("Couldn't start {program}: {e}"))?;
    drop(pair.slave);

    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let killer = child.clone_killer();

    let out_app = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 16 * 1024];
        let mut pending: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);
                    let whole = split_utf8(&pending);
                    if whole == 0 {
                        continue;
                    }
                    let data = String::from_utf8_lossy(&pending[..whole]).into_owned();
                    pending.drain(..whole);
                    let _ = out_app.emit("pty-output", PtyOutput { id, data });
                }
            }
        }
    });

    // ConPTY doesn't end the output stream when the program exits, so wait on
    // the process itself, then drop the terminal to close everything.
    let ptys = state.ptys.clone();
    std::thread::spawn(move || {
        let code = child.wait().ok().map(|s| s.exit_code());
        // Give the reader a moment to pass on the last of the output.
        std::thread::sleep(std::time::Duration::from_millis(120));
        ptys.lock().unwrap().remove(&id);
        let _ = app.emit("pty-exit", PtyExit { id, code });
    });

    state.ptys.lock().unwrap().insert(id, Pty { master: pair.master, writer, killer });
    Ok(id)
}

#[tauri::command]
pub fn pty_write(state: State<'_, PtyState>, id: u32, data: String) -> Result<(), String> {
    let mut ptys = state.ptys.lock().unwrap();
    let pty = ptys.get_mut(&id).ok_or("That terminal has closed")?;
    pty.writer.write_all(data.as_bytes()).and_then(|_| pty.writer.flush()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(state: State<'_, PtyState>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let ptys = state.ptys.lock().unwrap();
    let pty = ptys.get(&id).ok_or("That terminal has closed")?;
    pty.master
        .resize(PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_kill(state: State<'_, PtyState>, id: u32) -> Result<(), String> {
    if let Some(mut pty) = state.ptys.lock().unwrap().remove(&id) {
        let _ = pty.killer.kill();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::split_utf8;

    #[test]
    fn keeps_a_split_character_for_the_next_read() {
        let pound = "£".as_bytes();
        let mut bytes = b"ab".to_vec();
        bytes.push(pound[0]);
        assert_eq!(split_utf8(&bytes), 2);
        bytes.push(pound[1]);
        assert_eq!(split_utf8(&bytes), 4);
    }
}
