//! Runs language servers as child processes and relays their JSON-RPC messages
//! to the frontend. The frontend sends bare JSON; this side adds and strips the
//! `Content-Length` framing LSP uses over stdio.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::system::resolve_command;

struct Server {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Default)]
pub struct LspState {
    servers: Mutex<HashMap<u32, Server>>,
    next_id: AtomicU32,
}

#[derive(Clone, Serialize)]
struct LspMessage {
    id: u32,
    message: String,
}

#[derive(Clone, Serialize)]
struct LspExit {
    id: u32,
}

#[tauri::command]
pub fn lsp_start(
    app: AppHandle,
    state: State<'_, LspState>,
    command: String,
    args: Vec<String>,
    root: String,
) -> Result<u32, String> {
    let mut cmd: Command = resolve_command(&command, &args)?;
    cmd.current_dir(&root).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("Couldn't start {command}: {e}"))?;

    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    let stdin = child.stdin.take().ok_or("No stdin on language server")?;
    let stdout = child.stdout.take().ok_or("No stdout on language server")?;
    let stderr = child.stderr.take().ok_or("No stderr on language server")?;

    let reader_app = app.clone();
    std::thread::spawn(move || {
        read_messages(stdout, |message| {
            let _ = reader_app.emit("lsp-message", LspMessage { id, message });
        });
        let _ = reader_app.emit("lsp-exit", LspExit { id });
    });
    // Servers log to stderr; it has to be drained or the pipe fills and the server stalls.
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            eprintln!("[lsp {id}] {line}");
        }
    });

    state.servers.lock().unwrap().insert(id, Server { child, stdin });
    Ok(id)
}

#[tauri::command]
pub fn lsp_send(state: State<'_, LspState>, id: u32, message: String) -> Result<(), String> {
    let mut servers = state.servers.lock().unwrap();
    let server = servers.get_mut(&id).ok_or("Language server isn't running")?;
    let framed = format!("Content-Length: {}\r\n\r\n{}", message.len(), message);
    server.stdin.write_all(framed.as_bytes()).and_then(|_| server.stdin.flush()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn lsp_stop(state: State<'_, LspState>, id: u32) {
    if let Some(mut server) = state.servers.lock().unwrap().remove(&id) {
        let _ = server.child.kill();
    }
}

fn read_messages(stdout: impl Read, mut emit: impl FnMut(String)) {
    let mut reader = BufReader::new(stdout);
    loop {
        let mut length: Option<usize> = None;
        loop {
            let mut header = String::new();
            match reader.read_line(&mut header) {
                Ok(0) | Err(_) => return,
                Ok(_) => {}
            }
            let header = header.trim();
            if header.is_empty() {
                break;
            }
            if let Some(value) = header.strip_prefix("Content-Length:") {
                length = value.trim().parse().ok();
            }
        }
        let Some(length) = length else { continue };
        let mut body = vec![0u8; length];
        if reader.read_exact(&mut body).is_err() {
            return;
        }
        emit(String::from_utf8_lossy(&body).to_string());
    }
}
