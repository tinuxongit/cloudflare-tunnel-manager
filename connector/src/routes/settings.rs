use axum::{extract::State, Json};

use cf_tunnel_core::cloudflared::api;
use cf_tunnel_core::db::models::{Settings, SettingsPatch};
use cf_tunnel_core::db::queries;
use cf_tunnel_core::secrets;

use crate::error::ApiError;
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
    let g = state.core.db.lock();
    Ok(Json(queries::set_settings(&g, &patch)?))
}

// --- API token ---------------------------------------------------------------

use axum::http::StatusCode;
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub struct ExistsResponse {
    pub exists: bool,
}

pub async fn has_api_token() -> Result<Json<ExistsResponse>, ApiError> {
    Ok(Json(ExistsResponse {
        exists: secrets::has(secrets::CF_API_TOKEN),
    }))
}

#[derive(Serialize)]
pub struct TokenResponse {
    pub token: Option<String>,
}

pub async fn get_api_token() -> Result<Json<TokenResponse>, ApiError> {
    Ok(Json(TokenResponse {
        token: secrets::get(secrets::CF_API_TOKEN),
    }))
}

#[derive(Deserialize)]
pub struct SetTokenBody {
    pub token: String,
}

pub async fn set_api_token(
    Json(body): Json<SetTokenBody>,
) -> Result<Json<()>, ApiError> {
    use cf_tunnel_core::error::AppError;

    api::verify_token(&body.token).await?;
    secrets::set(secrets::CF_API_TOKEN, &body.token)
        .map_err(|e| AppError::Other { message: format!("keyring write: {e}") })?;
    match secrets::get(secrets::CF_API_TOKEN) {
        Some(stored) if stored == body.token => Ok(Json(())),
        Some(_) => Err(ApiError(AppError::Other {
            message: "keyring read-back returned a different value".into(),
        })),
        None => Err(ApiError(AppError::Other {
            message: "keyring write succeeded but read-back returned nothing".into(),
        })),
    }
}

pub async fn delete_api_token() -> Result<Json<()>, (StatusCode, String)> {
    let _ = secrets::delete(secrets::CF_API_TOKEN);
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

pub async fn has_global_key() -> Result<Json<ExistsResponse>, ApiError> {
    Ok(Json(ExistsResponse {
        exists: secrets::has(secrets::CF_GLOBAL_EMAIL) && secrets::has(secrets::CF_GLOBAL_KEY),
    }))
}

#[derive(Serialize)]
pub struct GlobalKeyResponse {
    pub email: Option<String>,
    pub key: Option<String>,
}

pub async fn get_global_key() -> Result<Json<GlobalKeyResponse>, ApiError> {
    let (email, key) = (
        secrets::get(secrets::CF_GLOBAL_EMAIL),
        secrets::get(secrets::CF_GLOBAL_KEY),
    );
    Ok(Json(GlobalKeyResponse { email, key }))
}

#[derive(Deserialize)]
pub struct SetGlobalKeyBody {
    pub email: String,
    pub key: String,
}

pub async fn set_global_key(
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
        (Some(e), Some(k)) if e == body.email && k == body.key => Ok(Json(())),
        _ => Err(ApiError(AppError::Other {
            message: "keyring read-back failed for global key".into(),
        })),
    }
}

pub async fn delete_global_key() -> Result<Json<()>, (StatusCode, String)> {
    let _ = secrets::delete(secrets::CF_GLOBAL_EMAIL);
    let _ = secrets::delete(secrets::CF_GLOBAL_KEY);
    Ok(Json(()))
}
