use serde::Serialize;
use std::io::Write;
use std::process::{Command, Stdio};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::system::find_program;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Serialize)]
pub struct GitOutput {
    code: i32,
    stdout: String,
    stderr: String,
}

/// Runs `git` with the given arguments in `cwd`. The interface parses the
/// output itself (see src/git/git.ts). `stdin` is fed to git when given, for
/// things like `blame --contents -` on unsaved text.
#[tauri::command]
pub async fn git(cwd: String, args: Vec<String>, stdin: Option<String>) -> Result<GitOutput, String> {
    tauri::async_runtime::spawn_blocking(move || run_git(&cwd, &args, stdin))
        .await
        .map_err(|e| e.to_string())?
}

fn run_git(cwd: &str, args: &[String], stdin: Option<String>) -> Result<GitOutput, String> {
    let program = find_program("git").ok_or("Git isn't installed, or isn't on PATH. Get it from https://git-scm.com")?;
    let mut cmd = Command::new(program);
    crate::system::user_env(&mut cmd)
        .args(args)
        .current_dir(cwd)
        // Never wait on a terminal prompt nobody can see; the credential manager still works.
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    if let Some(text) = stdin {
        if let Some(mut pipe) = child.stdin.take() {
            // Written on its own thread so a large file can't deadlock against git's output.
            std::thread::spawn(move || {
                let _ = pipe.write_all(text.as_bytes());
            });
        }
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    Ok(GitOutput {
        code: out.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::run_git;

    #[test]
    fn runs_git_and_feeds_it_stdin() {
        let dir = std::env::temp_dir().to_string_lossy().into_owned();
        let version = run_git(&dir, &["--version".into()], None).expect("git runs");
        assert_eq!(version.code, 0);
        assert!(version.stdout.starts_with("git version"));
        // hash-object reads the text from stdin.
        let hash = run_git(&dir, &["hash-object".into(), "--stdin".into()], Some("hello\n".into())).expect("git runs");
        assert_eq!(hash.stdout.trim(), "ce013625030ba8dba906f756967f9e9ca394464a");
    }
}
