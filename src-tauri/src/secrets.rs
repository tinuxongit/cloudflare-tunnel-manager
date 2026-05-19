//! Secret storage. Uses the OS keyring (Windows Credential Manager on Win,
//! Keychain on macOS, libsecret on Linux). All operations are best-effort —
//! if the keyring is unavailable, the calls report no token rather than crashing.

const SERVICE: &str = "com.adminlord.cftunnelmanager";

fn entry(key: &str) -> Option<keyring::Entry> {
    keyring::Entry::new(SERVICE, key).ok()
}

pub fn set(key: &str, value: &str) -> Result<(), String> {
    let e = entry(key).ok_or_else(|| "keyring unavailable".to_string())?;
    e.set_password(value).map_err(|err| err.to_string())
}

pub fn get(key: &str) -> Option<String> {
    let e = entry(key)?;
    e.get_password().ok()
}

pub fn delete(key: &str) -> Result<(), String> {
    let e = entry(key).ok_or_else(|| "keyring unavailable".to_string())?;
    e.delete_credential().map_err(|err| err.to_string())
}

pub fn has(key: &str) -> bool {
    get(key).is_some()
}

pub const CF_API_TOKEN: &str = "cloudflare_api_token";
