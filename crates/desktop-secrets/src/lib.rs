use std::sync::Arc;

use keyring::Entry;

use wealthfolio_core::{
    errors::Error,
    secrets::{format_service_id, SecretStore, SERVICE_PREFIX},
    Result,
};

const SECRET_NAMESPACE_ENV: &str = "WF_SECRET_NAMESPACE";
const USERNAME: &str = "default";

#[derive(Debug, Default, Clone, Copy)]
pub struct KeyringSecretStore;

impl SecretStore for KeyringSecretStore {
    fn set_secret(&self, service: &str, secret: &str) -> Result<()> {
        let entry = entry_for(service)?;
        entry
            .set_password(secret)
            .map_err(|err| Error::Secret(err.to_string()))
    }

    fn get_secret(&self, service: &str) -> Result<Option<String>> {
        let entry = entry_for(service)?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(Error::Secret(err.to_string())),
        }
    }

    fn delete_secret(&self, service: &str) -> Result<()> {
        let entry = entry_for(service)?;
        match entry.delete_password() {
            Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(Error::Secret(err.to_string())),
        }
    }
}

fn entry_for(service: &str) -> Result<Entry> {
    let namespace = std::env::var(SECRET_NAMESPACE_ENV).ok();
    let service_id = format_desktop_service_id(service, namespace.as_deref());
    Entry::new(&service_id, USERNAME).map_err(|err| Error::Secret(err.to_string()))
}

fn format_desktop_service_id(service: &str, namespace: Option<&str>) -> String {
    let service_id = format_service_id(service);
    let Some(namespace) = namespace.and_then(normalize_secret_namespace) else {
        return service_id;
    };
    let service_suffix = service_id
        .strip_prefix(SERVICE_PREFIX)
        .unwrap_or(&service_id);
    format!("{SERVICE_PREFIX}{namespace}_{service_suffix}")
}

fn normalize_secret_namespace(namespace: &str) -> Option<String> {
    let normalized: String = namespace
        .trim()
        .chars()
        .filter_map(|char| {
            if char.is_ascii_alphanumeric() {
                Some(char.to_ascii_lowercase())
            } else if char == '-' || char == '_' {
                Some('_')
            } else {
                None
            }
        })
        .collect();
    (!normalized.is_empty()).then_some(normalized)
}

pub fn shared_secret_store() -> Arc<dyn SecretStore> {
    Arc::new(KeyringSecretStore)
}

#[cfg(test)]
mod tests {
    use super::format_desktop_service_id;

    #[test]
    fn preserves_existing_service_ids_without_namespace() {
        assert_eq!(
            format_desktop_service_id("OPENFIGI", None),
            "wealthfolio_openfigi"
        );
        assert_eq!(
            format_desktop_service_id("OPENFIGI", Some("")),
            "wealthfolio_openfigi"
        );
    }

    #[test]
    fn namespaces_development_service_ids() {
        assert_eq!(
            format_desktop_service_id("OPENFIGI", Some("dev")),
            "wealthfolio_dev_openfigi"
        );
        assert_eq!(
            format_desktop_service_id("OPENFIGI", Some("Dev-Test")),
            "wealthfolio_dev_test_openfigi"
        );
    }
}
