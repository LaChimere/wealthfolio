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
use wealthfolio_mcp::pat;
use wealthfolio_mcp::{token_fingerprint, ActorKind, McpAuthContext};
use wealthfolio_storage_sqlite::agent::PatRepository;

/// Expected legacy local token plus its precomputed fingerprint.
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

/// Middleware state for the dual-auth bearer layer: the per-client PAT
/// store plus the legacy keyring token (read-only fallback).
#[derive(Clone)]
pub struct DualAuth {
    pat_repository: Arc<PatRepository>,
    legacy: BearerAuth,
}

impl DualAuth {
    pub fn new(pat_repository: Arc<PatRepository>, legacy: BearerAuth) -> Self {
        Self {
            pat_repository,
            legacy,
        }
    }
}

/// Authenticates `/mcp` requests against, in order:
///
/// 1. a per-client Personal Access Token (`wfp_`) — granted exactly its
///    persisted scopes; or
/// 2. the legacy keyring token (`wfl_`) — granted [`AgentScopeSet::read_only`]
///    only (READ-ONLY fallback).
///
/// Anything else is `401`. On success the matching [`McpAuthContext`] is
/// injected for the MCP handler.
pub async fn require_local_bearer(
    State(auth): State<DualAuth>,
    mut req: Request<Body>,
    next: Next,
) -> Response {
    let provided = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));

    let Some(token) = provided else {
        return StatusCode::UNAUTHORIZED.into_response();
    };

    // 1. Personal Access Token (full scope model).
    if let Some(authenticated) = pat::authenticate(&auth.pat_repository, token).await {
        req.extensions_mut().insert(McpAuthContext {
            actor_kind: ActorKind::Pat,
            actor_fingerprint: authenticated.fingerprint,
            granted_scopes: AgentScopeSet::from_strs(
                authenticated.scopes.iter().map(String::as_str),
            ),
        });
        return next.run(req).await;
    }

    // 2. Legacy keyring token (READ-ONLY fallback). Constant-time compare;
    // lengths are compared first (length is not secret).
    let expected = auth.legacy.expected.as_bytes();
    let received = token.as_bytes();
    let legacy_ok = received.len() == expected.len() && bool::from(received.ct_eq(expected));
    if legacy_ok {
        req.extensions_mut().insert(McpAuthContext {
            actor_kind: ActorKind::LocalToken,
            actor_fingerprint: auth.legacy.fingerprint.as_ref().clone(),
            granted_scopes: AgentScopeSet::read_only(),
        });
        return next.run(req).await;
    }

    StatusCode::UNAUTHORIZED.into_response()
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
