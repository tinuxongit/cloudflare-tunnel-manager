//! Secret storage. Uses the OS keyring (Windows Credential Manager on Win,
//! Keychain on macOS, libsecret on Linux). Errors are surfaced verbatim so
//! the UI can show *why* something failed instead of silently swallowing.

use tracing::warn;

const SERVICE: &str = "com.adminlord.cftunnelmanager";

fn entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, key).map_err(|e| format!("entry({SERVICE}, {key}): {e}"))
}

pub fn set(key: &str, value: &str) -> Result<(), String> {
    let e = entry(key)?;
    e.set_password(value).map_err(|err| format!("set_password: {err}"))
}

pub fn get(key: &str) -> Option<String> {
    match entry(key) {
        Ok(e) => match e.get_password() {
            Ok(s) => Some(s),
            Err(err) => {
                warn!("keyring get({key}) failed: {err}");
                None
            }
        },
        Err(err) => {
            warn!("keyring entry({key}) failed: {err}");
            None
        }
    }
}

pub fn delete(key: &str) -> Result<(), String> {
    let e = entry(key)?;
    e.delete_credential().map_err(|err| format!("delete_credential: {err}"))
}

pub fn has(key: &str) -> bool {
    get(key).is_some()
}

pub const CF_API_TOKEN: &str = "cloudflare_api_token";
