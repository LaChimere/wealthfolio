//! Local MCP bearer token management.
//!
//! The token lives in the OS keyring (via the shared [`SecretStore`])
//! under the `mcp.local` secret key. It is never written to disk or to
//! logs — only its fingerprint (`sha256:<hex>`) ever leaves this module
//! alongside the raw value returned to callers that explicitly need it.

use std::sync::Arc;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::rngs::OsRng;
use rand::RngCore;
use wealthfolio_core::secrets::SecretStore;
use wealthfolio_core::Result;

/// Secret-store key holding the local MCP token.
pub const MCP_TOKEN_SECRET_KEY: &str = "mcp.local";

/// Returns the existing local token, generating and storing one if absent.
pub fn load_or_generate(store: &Arc<dyn SecretStore>) -> Result<String> {
    if let Some(existing) = store.get_secret(MCP_TOKEN_SECRET_KEY)? {
        if !existing.is_empty() {
            return Ok(existing);
        }
    }
    rotate(store)
}

/// Generates a fresh token and overwrites the stored one.
pub fn rotate(store: &Arc<dyn SecretStore>) -> Result<String> {
    let token = generate();
    store.set_secret(MCP_TOKEN_SECRET_KEY, &token)?;
    Ok(token)
}

/// 32 bytes (256 bits) of OS entropy, base64url without padding, `wfl_` prefix.
fn generate() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    format!("wfl_{}", URL_SAFE_NO_PAD.encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;

    #[derive(Default)]
    struct MemorySecretStore {
        secrets: Mutex<HashMap<String, String>>,
    }

    impl SecretStore for MemorySecretStore {
        fn set_secret(&self, service: &str, secret: &str) -> Result<()> {
            self.secrets
                .lock()
                .unwrap()
                .insert(service.to_string(), secret.to_string());
            Ok(())
        }

        fn get_secret(&self, service: &str) -> Result<Option<String>> {
            Ok(self.secrets.lock().unwrap().get(service).cloned())
        }

        fn delete_secret(&self, service: &str) -> Result<()> {
            self.secrets.lock().unwrap().remove(service);
            Ok(())
        }
    }

    fn store() -> Arc<dyn SecretStore> {
        Arc::new(MemorySecretStore::default())
    }

    #[test]
    fn generates_prefixed_high_entropy_token() {
        let store = store();
        let token = load_or_generate(&store).unwrap();
        assert!(token.starts_with("wfl_"));
        // 32 bytes base64url no-pad = 43 chars + 4-char prefix.
        assert_eq!(token.len(), 47);
    }

    #[test]
    fn load_is_stable_until_rotated() {
        let store = store();
        let first = load_or_generate(&store).unwrap();
        let second = load_or_generate(&store).unwrap();
        assert_eq!(first, second);

        let rotated = rotate(&store).unwrap();
        assert_ne!(rotated, first);
        assert_eq!(load_or_generate(&store).unwrap(), rotated);
    }
}
