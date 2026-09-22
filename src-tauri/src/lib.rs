const SERVICE: &str = "io.github.vanawaker.jevmagi";
const ACCOUNT: &str = "typesafe-api-key";

// Desktop keeps the key in the system keyring: Keychain, Credential Manager or Secret Service.
#[cfg(not(target_os = "android"))]
mod store {
    use super::{ACCOUNT, SERVICE};
    use keyring::{Entry, Error};

    fn entry() -> Result<Entry, String> {
        Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())
    }
    pub fn load(_: &tauri::AppHandle) -> Result<Option<String>, String> {
        match entry()?.get_password() {
            Ok(key) => Ok(Some(key)),
            Err(Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
    pub fn save(_: &tauri::AppHandle, key: &str) -> Result<(), String> {
        entry()?.set_password(key).map_err(|e| e.to_string())
    }
    pub fn clear(_: &tauri::AppHandle) -> Result<(), String> {
        match entry()?.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

// Android keeps the key in the app's private storage, which other apps cannot read.
#[cfg(target_os = "android")]
mod store {
    use super::ACCOUNT;
    use std::{fs, io::ErrorKind, path::PathBuf};
    use tauri::Manager;

    fn path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
        Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join(ACCOUNT))
    }
    pub fn load(app: &tauri::AppHandle) -> Result<Option<String>, String> {
        match fs::read_to_string(path(app)?) {
            Ok(key) => Ok(Some(key)),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
    pub fn save(app: &tauri::AppHandle, key: &str) -> Result<(), String> {
        let file = path(app)?;
        if let Some(dir) = file.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        fs::write(file, key).map_err(|e| e.to_string())
    }
    pub fn clear(app: &tauri::AppHandle) -> Result<(), String> {
        match fs::remove_file(path(app)?) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

#[tauri::command]
fn load_key(app: tauri::AppHandle) -> Result<Option<String>, String> {
    store::load(&app)
}

#[tauri::command]
fn save_key(app: tauri::AppHandle, key: String) -> Result<(), String> {
    store::save(&app, key.trim())
}

#[tauri::command]
fn clear_key(app: tauri::AppHandle) -> Result<(), String> {
    store::clear(&app)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![load_key, save_key, clear_key])
        .run(tauri::generate_context!())
        .expect("error while running Jev MAGI");
}
