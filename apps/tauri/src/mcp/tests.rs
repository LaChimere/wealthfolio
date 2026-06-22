//! Router-level tests for the embedded MCP server: health, bearer auth,
//! Origin validation, and a stateful-mode MCP initialize round-trip.

use std::sync::Arc;

use tokio_util::sync::CancellationToken;
use wealthfolio_agent_tools::AgentEnvironment;
use wealthfolio_mcp::{AuditSink, McpAuditEntry};

use super::server::build_router;

const TEST_TOKEN: &str = "wfl_test";

struct StubEnv;

impl AgentEnvironment for StubEnv {
    fn base_currency(&self) -> String {
        "USD".to_string()
    }
    fn account_service(&self) -> Arc<dyn wealthfolio_core::accounts::AccountServiceTrait> {
        unimplemented!("StubEnv")
    }
    fn activity_service(&self) -> Arc<dyn wealthfolio_core::activities::ActivityServiceTrait> {
        unimplemented!("StubEnv")
    }
    fn holdings_service(
        &self,
    ) -> Arc<dyn wealthfolio_core::portfolio::holdings::HoldingsServiceTrait> {
        unimplemented!("StubEnv")
    }
    fn valuation_service(
        &self,
    ) -> Arc<dyn wealthfolio_core::portfolio::valuation::ValuationServiceTrait> {
        unimplemented!("StubEnv")
    }
    fn goal_service(&self) -> Arc<dyn wealthfolio_core::goals::GoalServiceTrait> {
        unimplemented!("StubEnv")
    }
    fn settings_service(&self) -> Arc<dyn wealthfolio_core::settings::SettingsServiceTrait> {
        unimplemented!("StubEnv")
    }
    fn quote_service(&self) -> Arc<dyn wealthfolio_core::quotes::QuoteServiceTrait> {
        unimplemented!("StubEnv")
    }
    fn asset_service(&self) -> Arc<dyn wealthfolio_core::assets::AssetServiceTrait> {
        unimplemented!("StubEnv")
    }
    fn allocation_service(
        &self,
    ) -> Arc<dyn wealthfolio_core::portfolio::allocation::AllocationServiceTrait> {
        unimplemented!("StubEnv")
    }
    fn performance_service(
        &self,
    ) -> Arc<dyn wealthfolio_core::portfolio::performance::PerformanceServiceTrait> {
        unimplemented!("StubEnv")
    }
    fn income_service(&self) -> Arc<dyn wealthfolio_core::portfolio::income::IncomeServiceTrait> {
        unimplemented!("StubEnv")
    }
    fn health_service(&self) -> Arc<dyn wealthfolio_core::health::HealthServiceTrait> {
        unimplemented!("StubEnv")
    }
    fn taxonomy_service(&self) -> Arc<dyn wealthfolio_core::taxonomies::TaxonomyServiceTrait> {
        unimplemented!("StubEnv")
    }
    fn cash_activity_service(
        &self,
    ) -> Arc<dyn wealthfolio_spending::cash_activities::CashActivityServiceTrait> {
        unimplemented!("StubEnv")
    }
    fn categorization_rules_service(
        &self,
    ) -> Arc<dyn wealthfolio_spending::categorization_rules::CategorizationRulesServiceTrait> {
        unimplemented!("StubEnv")
    }
}

struct NoopSink;

#[async_trait::async_trait]
impl AuditSink for NoopSink {
    async fn record(&self, _entry: McpAuditEntry) {}
}

/// Spawns the real router on a random loopback port; returns the base URL.
async fn spawn_server() -> String {
    let router = build_router(
        Arc::new(StubEnv),
        Some(Arc::new(NoopSink)),
        TEST_TOKEN.to_string(),
        CancellationToken::new(),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    format!("http://{addr}")
}

fn init_body() -> String {
    serde_json::json!({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": { "name": "test", "version": "1.0" }
        }
    })
    .to_string()
}

fn mcp_post(client: &reqwest::Client, base: &str) -> reqwest::RequestBuilder {
    client
        .post(format!("{base}/mcp"))
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .body(init_body())
}

/// Stateful mode answers over SSE — extract the first `data:` line that
/// carries a JSON payload (priming events have empty data).
fn parse_sse_data(body: &str) -> serde_json::Value {
    body.lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .find_map(|data| serde_json::from_str(data.trim()).ok())
        .unwrap_or_else(|| panic!("no SSE JSON data line in response: {body}"))
}

#[tokio::test]
async fn health_is_public() {
    let base = spawn_server().await;
    let response = reqwest::get(format!("{base}/health")).await.unwrap();
    assert_eq!(response.status(), 200);
    let body: serde_json::Value = response.json().await.unwrap();
    assert_eq!(body["status"], "ok");
    assert_eq!(body["server"], "wealthfolio-mcp");
    assert!(body["version"].is_string());
}

#[tokio::test]
async fn mcp_without_bearer_is_unauthorized() {
    let base = spawn_server().await;
    let client = reqwest::Client::new();
    let response = mcp_post(&client, &base).send().await.unwrap();
    assert_eq!(response.status(), 401);
}

#[tokio::test]
async fn mcp_with_wrong_bearer_is_unauthorized() {
    let base = spawn_server().await;
    let client = reqwest::Client::new();
    let response = mcp_post(&client, &base)
        .header("Authorization", "Bearer wfl_wrong")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 401);
}

#[tokio::test]
async fn mcp_with_disallowed_origin_is_forbidden() {
    let base = spawn_server().await;
    let client = reqwest::Client::new();
    let response = mcp_post(&client, &base)
        .header("Authorization", format!("Bearer {TEST_TOKEN}"))
        .header("Origin", "https://evil.example")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 403);
}

#[tokio::test]
async fn mcp_initialize_roundtrip_succeeds() {
    let base = spawn_server().await;
    let client = reqwest::Client::new();
    let response = mcp_post(&client, &base)
        .header("Authorization", format!("Bearer {TEST_TOKEN}"))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert!(
        response.headers().contains_key("mcp-session-id"),
        "stateful mode should assign a session id"
    );

    let body = response.text().await.unwrap();
    let parsed = parse_sse_data(&body);
    assert_eq!(parsed["jsonrpc"], "2.0");
    assert_eq!(parsed["id"], 1);
    assert_eq!(parsed["result"]["serverInfo"]["name"], "wealthfolio");
}

#[tokio::test]
async fn mcp_with_null_origin_passes() {
    let base = spawn_server().await;
    let client = reqwest::Client::new();
    let response = mcp_post(&client, &base)
        .header("Authorization", format!("Bearer {TEST_TOKEN}"))
        .header("Origin", "null")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);

    let body = response.text().await.unwrap();
    let parsed = parse_sse_data(&body);
    assert_eq!(parsed["result"]["serverInfo"]["name"], "wealthfolio");
}
