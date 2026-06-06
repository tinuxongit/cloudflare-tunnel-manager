//! Cloudflare Pages (static site hosting) REST API wrapper.
//! List projects + their deployment history. Deploying from a folder is left
//! to wrangler / git integration — this is for viewing + monitoring.

use serde::{Deserialize, Serialize};
use crate::error::{AppError, AppResult};
use super::api::{Credentials, CfEnvelope, http_client, account_id, CF_API_BASE};

#[derive(Debug, Clone, Serialize)]
pub struct PagesProject {
    pub name: String,
    pub subdomain: Option<String>,
    pub production_branch: Option<String>,
    pub domains: Option<Vec<String>>,
    pub created_on: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PagesDeployment {
    pub id: String,
    pub environment: String,
    pub url: Option<String>,
    pub created_on: String,
    pub deployment_trigger: Option<String>,
}

#[derive(Deserialize)]
struct RawProject {
    name: String,
    subdomain: Option<String>,
    production_branch: Option<String>,
    domains: Option<Vec<String>>,
    created_on: String,
}

#[derive(Deserialize)]
struct RawDeployment {
    id: String,
    environment: String,
    url: Option<String>,
    created_on: String,
    deployment_trigger: Option<RawTrigger>,
}

#[derive(Deserialize)]
struct RawTrigger {
    #[serde(rename = "type")]
    type_: Option<String>,
}

pub async fn list_projects(creds: &Credentials) -> AppResult<Vec<PagesProject>> {
    let acct = account_id(creds).await?;
    let client = http_client()?;
    let url = format!("{CF_API_BASE}/accounts/{acct}/pages/projects");
    let resp = creds.apply(client.get(&url)).send().await
        .map_err(|e| AppError::Other { message: format!("pages list: {e}") })?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::Other { message: format!("pages list HTTP {status}: {body}") });
    }
    let env: CfEnvelope<Vec<RawProject>> = serde_json::from_str(&body)
        .map_err(|e| AppError::Other { message: format!("pages parse: {e} — body: {body}") })?;
    let raw = env.into_result("pages list")?;
    Ok(raw.into_iter().map(|r| PagesProject {
        name: r.name, subdomain: r.subdomain, production_branch: r.production_branch,
        domains: r.domains, created_on: r.created_on,
    }).collect())
}

pub async fn list_deployments(
    creds: &Credentials, project: &str,
) -> AppResult<Vec<PagesDeployment>> {
    let acct = account_id(creds).await?;
    let client = http_client()?;
    let url = format!("{CF_API_BASE}/accounts/{acct}/pages/projects/{project}/deployments?per_page=25");
    let resp = creds.apply(client.get(&url)).send().await
        .map_err(|e| AppError::Other { message: format!("pages deployments: {e}") })?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::Other { message: format!("pages deployments HTTP {status}: {body}") });
    }
    let env: CfEnvelope<Vec<RawDeployment>> = serde_json::from_str(&body)
        .map_err(|e| AppError::Other { message: format!("pages deployments parse: {e} — body: {body}") })?;
    let raw = env.into_result("pages deployments")?;
    Ok(raw.into_iter().map(|r| PagesDeployment {
        id: r.id, environment: r.environment, url: r.url, created_on: r.created_on,
        deployment_trigger: r.deployment_trigger.and_then(|t| t.type_),
    }).collect())
}
