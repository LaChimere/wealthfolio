//! HTTP middleware guarding the embedded MCP endpoint.
//!
//! Two layers, applied outside the rmcp service (origin first, then
//! bearer). On success the bearer layer injects the [`McpAuthContext`]
//! the MCP handler requires — without it the handler fails closed.

use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use subtle::ConstantTimeEq;
use wealthfolio_agent_tools::AgentScopeSet;
use wealthfolio_mcp::{token_fingerprint, ActorKind, McpAuthContext};

/// Expected local token plus its precomputed fingerprint.
#[derive(Clone)]
pub struct BearerAuth {
    expected: Arc<String>,
    fingerprint: Arc<String>,
}

impl BearerAuth {
    pub fn new(token: String) -> Self {
        let fingerprint = token_fingerprint(&token);
        Self {
            expected: Arc::new(token),
            fingerprint: Arc::new(fingerprint),
        }
    }
}

/// Rejects requests whose bearer token does not match the local token.
///
/// Comparison is constant-time over the token bytes (lengths are compared
/// first; length is not secret). On success, inserts the read-only
/// [`McpAuthContext`] carrying the expected token's fingerprint.
pub async fn require_local_bearer(
    State(auth): State<BearerAuth>,
    mut req: Request<Body>,
    next: Next,
) -> Response {
    let provided = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));

    let authorized = match provided {
        Some(token) => {
            let expected = auth.expected.as_bytes();
            let received = token.as_bytes();
            received.len() == expected.len() && bool::from(received.ct_eq(expected))
        }
        None => false,
    };
    if !authorized {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    req.extensions_mut().insert(McpAuthContext {
        actor_kind: ActorKind::LocalToken,
        actor_fingerprint: auth.fingerprint.as_ref().clone(),
        granted_scopes: AgentScopeSet::read_only(),
    });
    next.run(req).await
}

/// Allows requests with no `Origin` header or exactly `Origin: null`
/// (non-browser MCP clients); everything else is rejected. No configured
/// allowlist in v1.
pub async fn validate_origin(req: Request<Body>, next: Next) -> Response {
    match req.headers().get(header::ORIGIN) {
        None => next.run(req).await,
        Some(value) if value.as_bytes() == b"null" => next.run(req).await,
        Some(_) => StatusCode::FORBIDDEN.into_response(),
    }
}
