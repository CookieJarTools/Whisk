mod fs;
mod git;
mod lsp;
mod pty;
mod search;
mod system;
mod updates;
mod walk;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // A second launch (from Unity, or a file opened in Explorer) goes to the open window instead.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            use tauri::{Emitter, Manager};
            let args = system::parse_args(argv.into_iter().skip(1), std::path::Path::new(&cwd));
            let _ = app.emit("open-args", args);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            system::record_install_path(app.handle());
            Ok(())
        })
        .manage(updates::UpdateState::default())
        .manage(lsp::LspState::default())
        .manage(pty::PtyState::default())
        .invoke_handler(tauri::generate_handler![
            fs::list_dir,
            fs::read_text,
            fs::write_text,
            fs::create_dir,
            fs::path_state,
            fs::list_files,
            fs::find_type_definitions,
            search::search_project,
            search::index_symbols,
            lsp::lsp_start,
            lsp::lsp_send,
            lsp::lsp_stop,
            system::which_program,
            system::open_external,
            system::open_path,
            system::open_in_terminal,
            system::write_temp,
            system::plugins_dir,
            system::startup_args,
            updates::list_releases,
            updates::check_update,
            updates::download_update,
            updates::install_update,
            system::run_command,
            system::kill_command,
            system::refresh_path,
            system::copy_text,
            system::paste_text,
            system::debuggers_dir,
            system::bundled_path,
            system::copy_dir,
            system::remove_file,
            git::git,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            system::append_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Whisk");
}
