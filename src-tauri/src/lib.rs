mod fs;
mod lsp;
mod search;
mod system;
mod updates;
mod walk;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updates::UpdateState::default())
        .manage(lsp::LspState::default())
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
            system::refresh_path,
            system::copy_text,
            system::append_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Whisk");
}
