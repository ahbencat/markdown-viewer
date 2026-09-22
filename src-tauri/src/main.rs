// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Minimal Tauri 2 shell for md-view-win (MVP: preview + export PDF).
// File open goes through tauri-plugin-dialog + tauri-plugin-fs; PDF export
// is frontend window.print().

#[tauri::command]
fn get_launch_file() -> Option<String> {
    std::env::args_os()
        .skip(1)
        .filter_map(|arg| arg.into_string().ok())
        .find(|arg| !arg.starts_with('-'))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![get_launch_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
