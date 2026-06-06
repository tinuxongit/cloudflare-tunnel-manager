use axum::{extract::State, Json};

use cf_tunnel_core::cloudflared::api;
use cf_tunnel_core::db::models::{Settings, SettingsPatch};
use cf_tunnel_core::db::queries;
use cf_tunnel_core::secrets;

use crate::error::ApiError;
use crate::events::StateEvent;
use crate::state::ConnectorState;

pub async fn get_settings(
    State(state): State<ConnectorState>,
) -> Result<Json<Settings>, ApiError> {
    let g = state.core.db.lock();
    Ok(Json(queries::get_settings(&g)?))
}

pub async fn set_settings(
    State(state): State<ConnectorState>,
    Json(patch): Json<SettingsPatch>,
) -> Result<Json<Settings>, ApiError> {
    let next = {
        let g = state.core.db.lock();
        queries::set_settings(&g, &patch)?
    };
    if patch.cloudflared_path.is_some() {
        let path = next.cloudflared_path
            .clone()
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| cf_tunnel_core::cloudflared::cli::CloudflaredCli::discover()
                .map(|c| c.path)
                .unwrap_or_else(|_| std::path::PathBuf::from("cloudflared")));
        state.core.supervisor.set_cloudflared_path(path);
    }
    state.events.publish(StateEvent::SettingsChanged);
    Ok(Json(next))
}

// --- API token ---------------------------------------------------------------

use axum::http::StatusCode;
use serde::Deserialize;

pub async fn has_api_token() -> Result<Json<bool>, ApiError> {
    Ok(Json(secrets::has(secrets::CF_API_TOKEN)))
}

pub async fn get_api_token() -> Result<Json<Option<String>>, ApiError> {
    Ok(Json(secrets::get(secrets::CF_API_TOKEN)))
}

#[derive(Deserialize)]
pub struct SetTokenBody {
    pub token: String,
}

pub async fn set_api_token(
    State(state): State<ConnectorState>,
    Json(body): Json<SetTokenBody>,
) -> Result<Json<()>, ApiError> {
    use cf_tunnel_core::error::AppError;

    api::verify_token(&body.token).await?;
    secrets::set(secrets::CF_API_TOKEN, &body.token)
        .map_err(|e| AppError::Other { message: format!("keyring write: {e}") })?;
    match secrets::get(secrets::CF_API_TOKEN) {
        Some(stored) if stored == body.token => {
            state.events.publish(StateEvent::SecretsChanged);
            Ok(Json(()))
        }
        Some(_) => Err(ApiError(AppError::Other {
            message: "keyring read-back returned a different value".into(),
        })),
        None => Err(ApiError(AppError::Other {
            message: "keyring write succeeded but read-back returned nothing".into(),
        })),
    }
}

pub async fn delete_api_token(
    State(state): State<ConnectorState>,
) -> Result<Json<()>, (StatusCode, String)> {
    let _ = secrets::delete(secrets::CF_API_TOKEN);
    state.events.publish(StateEvent::SecretsChanged);
    Ok(Json(()))
}

pub async fn verify_api_token() -> Result<Json<()>, ApiError> {
    use cf_tunnel_core::error::AppError;

    let Some(token) = secrets::get(secrets::CF_API_TOKEN) else {
        return Err(ApiError(AppError::Other {
            message: "no token saved".into(),
        }));
    };
    api::verify_token(&token).await?;
    Ok(Json(()))
}

// --- Global API Key ----------------------------------------------------------

pub async fn has_global_key() -> Result<Json<bool>, ApiError> {
    Ok(Json(
        secrets::has(secrets::CF_GLOBAL_EMAIL) && secrets::has(secrets::CF_GLOBAL_KEY),
    ))
}

pub async fn get_global_key() -> Result<Json<Option<(String, String)>>, ApiError> {
    let pair = match (
        secrets::get(secrets::CF_GLOBAL_EMAIL),
        secrets::get(secrets::CF_GLOBAL_KEY),
    ) {
        (Some(e), Some(k)) => Some((e, k)),
        _ => None,
    };
    Ok(Json(pair))
}

#[derive(Deserialize)]
pub struct SetGlobalKeyBody {
    pub email: String,
    pub key: String,
}

pub async fn set_global_key(
    State(state): State<ConnectorState>,
    Json(body): Json<SetGlobalKeyBody>,
) -> Result<Json<()>, ApiError> {
    use cf_tunnel_core::error::AppError;

    let creds = api::Credentials::GlobalKey {
        email: body.email.clone(),
        key: body.key.clone(),
    };
    api::verify(&creds).await?;
    secrets::set(secrets::CF_GLOBAL_EMAIL, &body.email)
        .map_err(|e| AppError::Other { message: format!("keyring write (email): {e}") })?;
    secrets::set(secrets::CF_GLOBAL_KEY, &body.key)
        .map_err(|e| AppError::Other { message: format!("keyring write (key): {e}") })?;
    match (
        secrets::get(secrets::CF_GLOBAL_EMAIL),
        secrets::get(secrets::CF_GLOBAL_KEY),
    ) {
        (Some(e), Some(k)) if e == body.email && k == body.key => {
            state.events.publish(StateEvent::SecretsChanged);
            Ok(Json(()))
        }
        _ => Err(ApiError(AppError::Other {
            message: "keyring read-back failed for global key".into(),
        })),
    }
}

pub async fn delete_global_key(
    State(state): State<ConnectorState>,
) -> Result<Json<()>, (StatusCode, String)> {
    let _ = secrets::delete(secrets::CF_GLOBAL_EMAIL);
    let _ = secrets::delete(secrets::CF_GLOBAL_KEY);
    state.events.publish(StateEvent::SecretsChanged);
    Ok(Json(()))
}

// --- Credentials sync (manager pushes its saved CF credentials post-pair) --

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialsSyncBody {
    /// Cloudflare API token. Either this or globalKey may be set.
    pub api_token: Option<String>,
    pub global_email: Option<String>,
    pub global_key: Option<String>,
}

/// Accept Cloudflare credentials from the manager and store them in the OS
/// keyring on this host. Called once right after pairing so the user does
/// not have to re-enter their token on the remote machine.
pub async fn sync_credentials(
    State(state): State<ConnectorState>,
    Json(body): Json<CredentialsSyncBody>,
) -> Result<Json<()>, ApiError> {
    use cf_tunnel_core::error::AppError;

    if let Some(tok) = body.api_token.as_deref().filter(|s| !s.is_empty()) {
        api::verify_token(tok).await?;
        secrets::set(secrets::CF_API_TOKEN, tok)
            .map_err(|e| AppError::Other { message: format!("keyring write api token: {e}") })?;
    }
    if let (Some(email), Some(key)) = (
        body.global_email.as_deref().filter(|s| !s.is_empty()),
        body.global_key.as_deref().filter(|s| !s.is_empty()),
    ) {
        let creds = api::Credentials::GlobalKey {
            email: email.into(),
            key: key.into(),
        };
        api::verify(&creds).await?;
        secrets::set(secrets::CF_GLOBAL_EMAIL, email)
            .map_err(|e| AppError::Other { message: format!("keyring write email: {e}") })?;
        secrets::set(secrets::CF_GLOBAL_KEY, key)
            .map_err(|e| AppError::Other { message: format!("keyring write global key: {e}") })?;
    }
    state.events.publish(StateEvent::SecretsChanged);
    Ok(Json(()))
}
