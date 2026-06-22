//! Agent Access (embedded MCP server) commands.

use std::sync::Arc;

#[cfg(desktop)]
use log::debug;
use serde::Serialize;
use tauri::{AppHandle, State};
use wealthfolio_storage_sqlite::agent::McpAuditLogDB;

use crate::context::ServiceContext;
use crate::mcp::{self, McpServerState};
#[cfg(desktop)]
use crate::secret_store::shared_secret_store;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub enabled: bool,
    pub auto_start: bool,
    pub audit_enabled: bool,
    pub running: bool,
    pub port: Option<u16>,
    pub started_at: Option<String>,
    pub token_fingerprint: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRotatedToken {
    /// Full token — shown once, never persisted outside the keyring.
    pub token: String,
    pub status: McpStatus,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConnectionInfo {
    pub url: String,
    /// Full bearer token — the frontend composes client-specific configs.
    pub token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpAuditPage {
    pub items: Vec<McpAuditLogDB>,
    pub total_count: i64,
}

async fn build_status(state: &McpServerState, ctx: &ServiceContext) -> McpStatus {
    let (enabled, auto_start) = mcp::flags(ctx);
    let running = state.running_info().await;
    McpStatus {
        enabled,
        auto_start,
        audit_enabled: mcp::audit_enabled(ctx),
        running: running.is_some(),
        port: running.as_ref().map(|(port, _, _)| *port),
        started_at: running
            .as_ref()
            .map(|(_, started_at, _)| started_at.clone()),
        token_fingerprint: running.map(|(_, _, fingerprint)| fingerprint),
    }
}

#[tauri::command]
pub async fn mcp_get_status(
    state: State<'_, Arc<ServiceContext>>,
    mcp_state: State<'_, McpServerState>,
) -> Result<McpStatus, String> {
    #[cfg(desktop)]
    {
        Ok(build_status(&mcp_state, &state).await)
    }
    #[cfg(not(desktop))]
    {
        let _ = (&state, &mcp_state);
        Err("MCP server is not available on mobile".to_string())
    }
}

#[tauri::command]
pub async fn mcp_set_enabled(
    enabled: bool,
    auto_start: bool,
    state: State<'_, Arc<ServiceContext>>,
    mcp_state: State<'_, McpServerState>,
    handle: AppHandle,
) -> Result<McpStatus, String> {
    #[cfg(desktop)]
    {
        debug!(
            "Setting MCP server enabled={}, auto_start={}",
            enabled, auto_start
        );
        mcp::set_enabled(&handle, &state, enabled, auto_start).await?;
        Ok(build_status(&mcp_state, &state).await)
    }
    #[cfg(not(desktop))]
    {
        let _ = (enabled, auto_start, &state, &mcp_state, &handle);
        Err("MCP server is not available on mobile".to_string())
    }
}

#[tauri::command]
pub async fn mcp_rotate_token(
    state: State<'_, Arc<ServiceContext>>,
    mcp_state: State<'_, McpServerState>,
    handle: AppHandle,
) -> Result<McpRotatedToken, String> {
    #[cfg(desktop)]
    {
        debug!("Rotating MCP local token");
        let token = mcp::rotate_token(&handle, &state).await?;
        Ok(McpRotatedToken {
            token,
            status: build_status(&mcp_state, &state).await,
        })
    }
    #[cfg(not(desktop))]
    {
        let _ = (&state, &mcp_state, &handle);
        Err("MCP server is not available on mobile".to_string())
    }
}

#[tauri::command]
pub async fn mcp_get_connection_info(
    mcp_state: State<'_, McpServerState>,
) -> Result<McpConnectionInfo, String> {
    #[cfg(desktop)]
    {
        let (port, _, _) = mcp_state
            .running_info()
            .await
            .ok_or_else(|| "MCP server is not running".to_string())?;
        let token = crate::mcp::token::load_or_generate(&shared_secret_store())
            .map_err(|e| format!("Failed to load MCP token: {e}"))?;
        Ok(McpConnectionInfo {
            url: format!("http://127.0.0.1:{port}/mcp"),
            token,
        })
    }
    #[cfg(not(desktop))]
    {
        let _ = &mcp_state;
        Err("MCP server is not available on mobile".to_string())
    }
}

#[tauri::command]
pub async fn mcp_set_audit_enabled(
    enabled: bool,
    state: State<'_, Arc<ServiceContext>>,
    mcp_state: State<'_, McpServerState>,
    handle: AppHandle,
) -> Result<McpStatus, String> {
    #[cfg(desktop)]
    {
        debug!("Setting MCP audit logging enabled={}", enabled);
        mcp::set_audit_enabled(&handle, &state, enabled).await?;
        Ok(build_status(&mcp_state, &state).await)
    }
    #[cfg(not(desktop))]
    {
        let _ = (enabled, &state, &mcp_state, &handle);
        Err("MCP server is not available on mobile".to_string())
    }
}

#[tauri::command]
pub async fn mcp_list_audit_log(
    page: u32,
    page_size: u32,
    tool: Option<String>,
    state: State<'_, Arc<ServiceContext>>,
) -> Result<McpAuditPage, String> {
    #[cfg(desktop)]
    {
        let (items, total_count) = state
            .mcp_audit_repository()
            .list_paged(page as i64, page_size as i64, tool.as_deref())
            .map_err(|e| format!("Failed to list MCP audit log: {e}"))?;
        Ok(McpAuditPage { items, total_count })
    }
    #[cfg(not(desktop))]
    {
        let _ = (page, page_size, &tool, &state);
        Err("MCP server is not available on mobile".to_string())
    }
}

#[tauri::command]
pub async fn mcp_purge_audit_log(state: State<'_, Arc<ServiceContext>>) -> Result<u64, String> {
    #[cfg(desktop)]
    {
        debug!("Purging MCP audit log");
        state
            .mcp_audit_repository()
            .purge_all()
            .await
            .map_err(|e| format!("Failed to purge MCP audit log: {e}"))
    }
    #[cfg(not(desktop))]
    {
        let _ = &state;
        Err("MCP server is not available on mobile".to_string())
    }
}
