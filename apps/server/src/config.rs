use std::{net::SocketAddr, time::Duration};

use crate::auth::{decode_secret_key, derive_keys, AuthConfig, CookieSecurePolicy};

pub struct Config {
    pub listen_addr: SocketAddr,
    pub db_path: String,
    pub cors_allow: Vec<String>,
    pub request_timeout: Duration,
    pub static_dir: String,
    pub addons_root: String,
    /// Raw master key (used only for secret-store migration from old raw key)
    pub raw_secret_key: Vec<u8>,
    /// HKDF-derived key for secrets encryption
    pub secrets_encryption_key: [u8; 32],
    pub auth: Option<AuthConfig>,
    pub sidecar: Option<SidecarConfig>,
}

pub struct SidecarConfig {
    pub token: String,
}

impl Config {
    pub fn from_env() -> Self {
        dotenvy::dotenv().ok();
        let listen_addr: SocketAddr = std::env::var("WF_LISTEN_ADDR")
            .unwrap_or_else(|_| "0.0.0.0:8088".to_string())
            .parse()
            .expect("Invalid WF_LISTEN_ADDR");
        let db_path = std::env::var("WF_DB_PATH").unwrap_or_else(|_| "./db/app.db".into());
        let cors_allow: Vec<String> = std::env::var("WF_CORS_ALLOW_ORIGINS")
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "*".into())
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        let timeout_ms: u64 = std::env::var("WF_REQUEST_TIMEOUT_MS")
            .unwrap_or_else(|_| "300000".into())
            .parse()
            .unwrap_or(300000);
        let static_dir = std::env::var("WF_STATIC_DIR").unwrap_or_else(|_| "dist".into());
        let secret_key = std::env::var("WF_SECRET_KEY")
            .unwrap_or_else(|_| panic!("WF_SECRET_KEY must be set and contain a 32-byte key"))
            .trim()
            .to_string();
        if secret_key.is_empty() {
            panic!("WF_SECRET_KEY must not be empty");
        }
        let raw_secret_key = decode_secret_key(&secret_key)
            .unwrap_or_else(|e| panic!("Failed to decode WF_SECRET_KEY: {e}"));
        let (jwt_key, secrets_encryption_key) = derive_keys(&raw_secret_key);
        let addons_root = std::env::var("WF_ADDONS_DIR").unwrap_or_else(|_| {
            std::path::Path::new(&db_path)
                .parent()
                .unwrap_or_else(|| std::path::Path::new("."))
                .to_string_lossy()
                .into_owned()
        });
        let auth = std::env::var("WF_AUTH_PASSWORD_HASH")
            .ok()
            .map(|hash| hash.trim().to_string())
            .filter(|hash| !hash.is_empty())
            .map(|password_hash| {
                let ttl_minutes = std::env::var("WF_AUTH_TOKEN_TTL_MINUTES")
                    .ok()
                    .and_then(|value| value.parse::<u64>().ok())
                    .filter(|value| *value > 0)
                    .unwrap_or(60);
                let cookie_secure_raw =
                    std::env::var("WF_COOKIE_SECURE").unwrap_or_else(|_| "auto".into());
                let cookie_secure = match cookie_secure_raw.trim().to_ascii_lowercase().as_str() {
                    "auto" => CookieSecurePolicy::Auto,
                    "true" | "1" | "yes" => CookieSecurePolicy::Always,
                    "false" | "0" | "no" => CookieSecurePolicy::Never,
                    other => panic!(
                        "Invalid WF_COOKIE_SECURE value: \"{other}\". \
                         Expected one of: auto, true, false"
                    ),
                };
                AuthConfig {
                    password_hash,
                    jwt_secret: jwt_key.to_vec(),
                    access_token_ttl: Duration::from_secs(ttl_minutes.saturating_mul(60)),
                    cookie_secure,
                }
            });
        // When auth is enabled, wildcard CORS is incompatible with credentials
        if auth.is_some() && cors_allow.iter().any(|o| o == "*") {
            panic!(
                "WF_CORS_ALLOW_ORIGINS cannot be \"*\" when authentication is enabled. \
                 Set explicit origins, e.g. WF_CORS_ALLOW_ORIGINS=https://my.domain.com"
            );
        }

        let sidecar = match std::env::var("WF_SIDECAR_TOKEN") {
            Ok(token) => {
                let token = token.trim().to_string();
                if token.is_empty() {
                    panic!("WF_SIDECAR_TOKEN must not be empty when set");
                }
                if !listen_addr.ip().is_loopback() {
                    panic!(
                        "WF_SIDECAR_TOKEN requires a loopback WF_LISTEN_ADDR; got {listen_addr}"
                    );
                }
                Some(SidecarConfig { token })
            }
            Err(_) => None,
        };

        // Fail-closed: refuse to start on non-loopback without auth,
        // unless explicitly opted out via WF_AUTH_REQUIRED=false.
        if auth.is_none() && !listen_addr.ip().is_loopback() {
            let auth_required = std::env::var("WF_AUTH_REQUIRED")
                .map(|v| !v.eq_ignore_ascii_case("false"))
                .unwrap_or(true);
            if auth_required {
                panic!(
                    "Refusing to start: listening on non-loopback address {listen_addr} without \
                     authentication.\n\
                     \n\
                     To fix this, do one of the following:\n\
                     \n\
                     1. Set WF_AUTH_PASSWORD_HASH to an Argon2id hash of your password.\n\
                        Generate one with: printf 'your-password' | argon2 yoursalt16chars! -id -e\n\
                        In app-loaded dotenv files, use the hash as-is.\n\
                        In Docker Compose .env/--env-file, single-quote it or double every $ sign.\n\
                        In Docker Compose YAML, double every $ sign: '$$argon2id$$v=19$$...'\n\
                     \n\
                     2. Set WF_AUTH_REQUIRED=false if a reverse proxy handles authentication."
                );
            }
        }

        Self {
            listen_addr,
            db_path,
            cors_allow,
            request_timeout: Duration::from_millis(timeout_ms),
            static_dir,
            addons_root,
            raw_secret_key,
            secrets_encryption_key,
            auth,
            sidecar,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());
    const TEST_SECRET_KEY: &str = "012345678901234567890123456789!!";

    fn with_env<T>(vars: &[(&str, Option<&str>)], run: impl FnOnce() -> T) -> T {
        let guard = ENV_LOCK.lock().expect("env lock poisoned");
        let previous = vars
            .iter()
            .map(|(key, _)| (*key, std::env::var(key).ok()))
            .collect::<Vec<_>>();

        for (key, value) in vars {
            match value {
                Some(value) => std::env::set_var(key, value),
                None => std::env::remove_var(key),
            }
        }

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(run));

        for (key, value) in previous {
            match value {
                Some(value) => std::env::set_var(key, value),
                None => std::env::remove_var(key),
            }
        }

        drop(guard);

        match result {
            Ok(value) => value,
            Err(payload) => std::panic::resume_unwind(payload),
        }
    }

    #[test]
    fn sidecar_profile_accepts_loopback_token() {
        let config = with_env(
            &[
                ("WF_LISTEN_ADDR", Some("127.0.0.1:0")),
                ("WF_SECRET_KEY", Some(TEST_SECRET_KEY)),
                ("WF_SIDECAR_TOKEN", Some("sidecar-token")),
                ("WF_AUTH_REQUIRED", Some("false")),
            ],
            Config::from_env,
        );

        assert_eq!(config.listen_addr.ip().to_string(), "127.0.0.1");
        assert_eq!(
            config
                .sidecar
                .as_ref()
                .map(|sidecar| sidecar.token.as_str()),
            Some("sidecar-token")
        );
    }

    #[test]
    #[should_panic(expected = "WF_SIDECAR_TOKEN must not be empty when set")]
    fn sidecar_profile_rejects_empty_token() {
        with_env(
            &[
                ("WF_LISTEN_ADDR", Some("127.0.0.1:0")),
                ("WF_SECRET_KEY", Some(TEST_SECRET_KEY)),
                ("WF_SIDECAR_TOKEN", Some("   ")),
                ("WF_AUTH_REQUIRED", Some("false")),
            ],
            Config::from_env,
        );
    }

    #[test]
    #[should_panic(expected = "WF_SIDECAR_TOKEN requires a loopback WF_LISTEN_ADDR")]
    fn sidecar_profile_rejects_non_loopback_listener() {
        with_env(
            &[
                ("WF_LISTEN_ADDR", Some("0.0.0.0:8088")),
                ("WF_SECRET_KEY", Some(TEST_SECRET_KEY)),
                ("WF_SIDECAR_TOKEN", Some("sidecar-token")),
                ("WF_AUTH_REQUIRED", Some("false")),
            ],
            Config::from_env,
        );
    }
}
