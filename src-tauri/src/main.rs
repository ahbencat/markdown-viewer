// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Minimal Tauri 2 shell for md-view-win (MVP: preview + export PDF).
// File open goes through tauri-plugin-dialog + tauri-plugin-fs; PDF export
// is frontend window.print().

use tauri_plugin_fs::FsExt;

/// Path passed by Windows when the app was launched by file association.
/// Kept in sync with the frontend `getLaunchFile()` invoke below.
fn launch_file_arg() -> Option<String> {
    std::env::args_os()
        .skip(1)
        .filter_map(|arg| arg.into_string().ok())
        .find(|arg| !arg.starts_with('-'))
}

/// The capability fs:scope can only cover fixed directories; a double-clicked
/// file may live anywhere (another drive, a project folder). Allow-list the
/// launch path at startup, mirroring what the fs plugin does for drag-drop.
fn allow_launch_file<R: tauri::Runtime>(app: &tauri::App<R>) {
    if let Some(path) = launch_file_arg() {
        let scope = app.fs_scope();
        let p = std::path::Path::new(&path);
        if p.is_file() {
            let _ = scope.allow_file(p);
        } else if let Some(parent) = p.parent() {
            let _ = scope.allow_directory(parent, false);
        }
    }
}

#[tauri::command]
fn get_launch_file() -> Option<String> {
    launch_file_arg()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![get_launch_file])
        .setup(|app| {
            allow_launch_file(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
