use std::time::{Duration, Instant};
use crate::health::ServiceHealth;

pub async fn check(url: &str) -> ServiceHealth {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build() {
            Ok(c) => c,
            Err(e) => return ServiceHealth {
                reachable: false, latency_ms: None, http_status: None,
                reason: Some(format!("client build: {e}")),
            },
        };
    let started = Instant::now();
    match client.get(url).send().await {
        Ok(resp) => ServiceHealth {
            reachable: true,
            latency_ms: Some(started.elapsed().as_millis() as u64),
            http_status: Some(resp.status().as_u16()),
            reason: None,
        },
        Err(e) => ServiceHealth {
            reachable: false,
            latency_ms: None,
            http_status: None,
            reason: Some(e.to_string()),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn reaches_mock_server() {
        let mut srv = mockito::Server::new_async().await;
        let _m = srv.mock("GET", "/").with_status(200).create_async().await;
        let url = srv.url();
        let res = check(&url).await;
        assert!(res.reachable);
        assert_eq!(res.http_status, Some(200));
    }

    #[tokio::test]
    async fn unreachable_returns_reason() {
        let res = check("http://127.0.0.1:1").await;
        assert!(!res.reachable);
        assert!(res.reason.is_some());
    }
}
