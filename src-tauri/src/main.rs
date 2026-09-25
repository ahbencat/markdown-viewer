// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Minimal Tauri 2 shell for md-view-win (MVP: preview + export PDF).
// File open goes through tauri-plugin-dialog + tauri-plugin-fs; PDF export
// is frontend window.print().

use tauri::Manager;
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
///
/// Both the fs-plugin scope (for `readTextFile`) and the asset-protocol scope
/// (for `<img>` subresources, enabled via the `protocol-asset` feature) need
/// the path: they are separate scopes guarding separate channels.
fn allow_launch_file<R: tauri::Runtime>(app: &tauri::App<R>) {
    if let Some(path) = launch_file_arg() {
        let p = std::path::Path::new(&path);
        let fs_scope = app.fs_scope();
        if p.is_file() {
            let _ = fs_scope.allow_file(p);
        } else if let Some(parent) = p.parent() {
            let _ = fs_scope.allow_directory(parent, false);
        }
        // Asset protocol serves <img> without IPC: grant the containing dir
        // (non-recursive is enough — images sit next to the document).
        let asset_scope = app.asset_protocol_scope();
        if let Some(parent) = p.parent() {
            let _ = asset_scope.allow_directory(parent, false);
        }
    }
}

#[tauri::command]
fn get_launch_file() -> Option<String> {
    launch_file_arg()
}

/// Allow one local image path for the asset protocol. This keeps arbitrary
/// absolute image paths usable without granting the whole filesystem.
#[tauri::command]
fn allow_asset_file<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<(), String> {
    app.asset_protocol_scope()
        .allow_file(path)
        .map_err(|err| err.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![get_launch_file, allow_asset_file])
        .setup(|app| {
            allow_launch_file(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
