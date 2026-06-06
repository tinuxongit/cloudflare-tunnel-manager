use axum::{
    extract::{Path, State},
    Json,
};
use serde::Deserialize;

use cf_tunnel_core::cloudflared::{api, d1, dns, pages, r2, workers};

use crate::error::ApiError;
use crate::events::StateEvent;
use crate::state::ConnectorState;

fn creds() -> Result<api::Credentials, ApiError> {
    Ok(api::resolve_credentials()?)
}

// ── Workers ────────────────────────────────────────────────────────────────

pub async fn list_workers() -> Result<Json<Vec<workers::Worker>>, ApiError> {
    let creds = creds()?;
    Ok(Json(workers::list_workers(&creds).await?))
}

pub async fn get_worker(
    Path(id): Path<String>,
) -> Result<Json<workers::WorkerScript>, ApiError> {
    let creds = creds()?;
    Ok(Json(workers::get_worker(&creds, &id).await?))
}

pub async fn delete_worker(
    State(state): State<ConnectorState>,
    Path(id): Path<String>,
) -> Result<Json<()>, ApiError> {
    let creds = creds()?;
    workers::delete_worker(&creds, &id).await?;
    state.events.publish(StateEvent::WorkersChanged);
    Ok(Json(()))
}

pub async fn list_worker_secrets(
    Path(id): Path<String>,
) -> Result<Json<Vec<workers::WorkerSecret>>, ApiError> {
    let creds = creds()?;
    Ok(Json(workers::list_secrets(&creds, &id).await?))
}

#[derive(Deserialize)]
pub struct PutSecretBody {
    pub name: String,
    pub value: String,
}

pub async fn put_worker_secret(
    State(state): State<ConnectorState>,
    Path(id): Path<String>,
    Json(body): Json<PutSecretBody>,
) -> Result<Json<()>, ApiError> {
    let creds = creds()?;
    workers::put_secret(&creds, &id, &body.name, &body.value).await?;
    state.events.publish(StateEvent::WorkersChanged);
    Ok(Json(()))
}

pub async fn delete_worker_secret(
    State(state): State<ConnectorState>,
    Path((id, name)): Path<(String, String)>,
) -> Result<Json<()>, ApiError> {
    let creds = creds()?;
    workers::delete_secret(&creds, &id, &name).await?;
    state.events.publish(StateEvent::WorkersChanged);
    Ok(Json(()))
}

// ── R2 ─────────────────────────────────────────────────────────────────────

pub async fn list_r2_buckets() -> Result<Json<Vec<r2::R2Bucket>>, ApiError> {
    let creds = creds()?;
    Ok(Json(r2::list_buckets(&creds).await?))
}

#[derive(Deserialize)]
pub struct BucketBody {
    pub name: String,
}

pub async fn create_r2_bucket(
    State(state): State<ConnectorState>,
    Json(body): Json<BucketBody>,
) -> Result<Json<()>, ApiError> {
    let creds = creds()?;
    r2::create_bucket(&creds, &body.name).await?;
    state.events.publish(StateEvent::R2Changed);
    Ok(Json(()))
}

pub async fn delete_r2_bucket(
    State(state): State<ConnectorState>,
    Path(name): Path<String>,
) -> Result<Json<()>, ApiError> {
    let creds = creds()?;
    r2::delete_bucket(&creds, &name).await?;
    state.events.publish(StateEvent::R2Changed);
    Ok(Json(()))
}

// ── D1 ─────────────────────────────────────────────────────────────────────

pub async fn list_d1_databases() -> Result<Json<Vec<d1::D1Database>>, ApiError> {
    let creds = creds()?;
    Ok(Json(d1::list_databases(&creds).await?))
}

#[derive(Deserialize)]
pub struct D1QueryBody {
    pub sql: String,
}

pub async fn exec_d1(
    State(state): State<ConnectorState>,
    Path(uuid): Path<String>,
    Json(body): Json<D1QueryBody>,
) -> Result<Json<d1::D1QueryResult>, ApiError> {
    let creds = creds()?;
    let r = d1::exec_sql(&creds, &uuid, &body.sql).await?;
    // SELECTs don't change schema, but DDL/DML do; we publish unconditionally
    // because the SQL console UI shouldn't have to inspect statement kinds.
    state.events.publish(StateEvent::D1Changed);
    Ok(Json(r))
}

pub async fn delete_d1_database(
    State(state): State<ConnectorState>,
    Path(uuid): Path<String>,
) -> Result<Json<()>, ApiError> {
    let creds = creds()?;
    d1::delete_database(&creds, &uuid).await?;
    state.events.publish(StateEvent::D1Changed);
    Ok(Json(()))
}

// ── DNS records ────────────────────────────────────────────────────────────

pub async fn list_dns_records(
    Path(zone_id): Path<String>,
) -> Result<Json<Vec<dns::DnsRecord>>, ApiError> {
    let creds = creds()?;
    Ok(Json(dns::list_records(&creds, &zone_id).await?))
}

pub async fn create_dns_record(
    State(state): State<ConnectorState>,
    Path(zone_id): Path<String>,
    Json(record): Json<dns::NewDnsRecord>,
) -> Result<Json<dns::DnsRecord>, ApiError> {
    let creds = creds()?;
    let r = dns::create_record(&creds, &zone_id, &record).await?;
    state.events.publish(StateEvent::DnsChanged);
    Ok(Json(r))
}

pub async fn delete_dns_record(
    State(state): State<ConnectorState>,
    Path((zone_id, record_id)): Path<(String, String)>,
) -> Result<Json<()>, ApiError> {
    let creds = creds()?;
    dns::delete_record(&creds, &zone_id, &record_id).await?;
    state.events.publish(StateEvent::DnsChanged);
    Ok(Json(()))
}

// ── Zone cache controls ────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct PurgeBody {
    #[serde(default)]
    pub files: Vec<String>,
}

pub async fn purge_cache(
    State(state): State<ConnectorState>,
    Path(zone_id): Path<String>,
    Json(body): Json<PurgeBody>,
) -> Result<Json<()>, ApiError> {
    let creds = creds()?;
    api::purge_cache(&creds, &zone_id, &body.files).await?;
    // Cache + dev-mode live under the DNS view in Studio; reuse DnsChanged
    // so the panel re-fetches the dev-mode status after the toggle.
    state.events.publish(StateEvent::DnsChanged);
    Ok(Json(()))
}

#[derive(Deserialize)]
pub struct DevModeBody {
    pub on: bool,
}

pub async fn set_dev_mode(
    State(state): State<ConnectorState>,
    Path(zone_id): Path<String>,
    Json(body): Json<DevModeBody>,
) -> Result<Json<()>, ApiError> {
    let creds = creds()?;
    api::set_development_mode(&creds, &zone_id, body.on).await?;
    state.events.publish(StateEvent::DnsChanged);
    Ok(Json(()))
}

pub async fn get_dev_mode(
    Path(zone_id): Path<String>,
) -> Result<Json<api::DevModeStatus>, ApiError> {
    let creds = creds()?;
    Ok(Json(api::get_development_mode(&creds, &zone_id).await?))
}

// ── Cloudflare Pages ───────────────────────────────────────────────────────

pub async fn list_pages_projects() -> Result<Json<Vec<pages::PagesProject>>, ApiError> {
    let creds = creds()?;
    Ok(Json(pages::list_projects(&creds).await?))
}

pub async fn list_pages_deployments(
    Path(project): Path<String>,
) -> Result<Json<Vec<pages::PagesDeployment>>, ApiError> {
    let creds = creds()?;
    Ok(Json(pages::list_deployments(&creds, &project).await?))
}
