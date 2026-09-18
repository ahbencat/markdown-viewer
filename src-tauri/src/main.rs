// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Minimal Tauri 2 shell for md-view-win (MVP: preview + export PDF).
// File open goes through tauri-plugin-dialog + tauri-plugin-fs; PDF export
// is frontend window.print(). No custom commands yet — a GBK-fallback
// read_markdown_file command can be added later if needed.

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
