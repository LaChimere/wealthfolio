import { ELECTRON_COMMANDS, type ElectronCommand } from "../shared/ipc";
import { sanitizeSidecarError, type SidecarHandle } from "./sidecar";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface InvokeSidecarCommandOptions {
  command: ElectronCommand;
  payload?: Record<string, unknown>;
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  fetchImpl?: FetchLike;
}

interface ResolvedSidecarCommandOptions {
  payload?: Record<string, unknown>;
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  fetchImpl: FetchLike;
}

export async function invokeSidecarCommand<T>({
  command,
  payload,
  sidecar,
  fetchImpl = fetch,
}: InvokeSidecarCommandOptions): Promise<T> {
  switch (command) {
    case "get_accounts":
      return await invokeGetAccounts<T>({ payload, sidecar, fetchImpl });
    case "create_account":
      return await invokeCreateAccount<T>({ payload, sidecar, fetchImpl });
    case "update_account":
      return await invokeUpdateAccount<T>({ payload, sidecar, fetchImpl });
    case "delete_account":
      return await invokeDeleteAccount<T>({ payload, sidecar, fetchImpl });
    case "get_settings":
    case "is_auto_update_check_enabled":
      return await invokeSimpleGet<T>({ command, sidecar, fetchImpl });
    case "update_settings":
      return await invokeUpdateSettings<T>({ payload, sidecar, fetchImpl });
    case "set_secret":
      return await invokePostJson<T>({
        command,
        body: {
          secretKey: requireString(payload?.secretKey, "secretKey", command),
          secret: requireStringValue(payload?.secret, "secret", command),
        },
        sidecar,
        fetchImpl,
      });
    case "get_secret":
    case "delete_secret":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [["secretKey", requireString(payload?.secretKey, "secretKey", command)]],
      });
    case "sync_generate_root_key":
    case "sync_generate_pairing_code":
    case "sync_generate_device_id":
      return await invokeSyncCryptoString<T>({ command, sidecar, fetchImpl });
    case "sync_derive_dek":
      return await invokeSyncCryptoString<T>({
        command,
        sidecar,
        fetchImpl,
        body: {
          rootKey: requireString(payload?.rootKey, "rootKey", command),
          version: requireUnsignedInteger(payload?.version, "version", command),
        },
      });
    case "sync_generate_keypair":
      return await invokeSyncCrypto<T>({ command, sidecar, fetchImpl });
    case "sync_compute_shared_secret":
      return await invokeSyncCryptoString<T>({
        command,
        sidecar,
        fetchImpl,
        body: {
          ourSecret: requireString(payload?.ourSecret, "ourSecret", command),
          theirPublic: requireString(payload?.theirPublic, "theirPublic", command),
        },
      });
    case "sync_derive_session_key":
      return await invokeSyncCryptoString<T>({
        command,
        sidecar,
        fetchImpl,
        body: {
          sharedSecret: requireString(payload?.sharedSecret, "sharedSecret", command),
          context: requireString(payload?.context, "context", command),
        },
      });
    case "sync_encrypt":
      return await invokeSyncCryptoString<T>({
        command,
        sidecar,
        fetchImpl,
        body: {
          key: requireString(payload?.key, "key", command),
          plaintext: requireStringValue(payload?.plaintext, "plaintext", command),
        },
      });
    case "sync_decrypt":
      return await invokeSyncCryptoString<T>({
        command,
        sidecar,
        fetchImpl,
        body: {
          key: requireString(payload?.key, "key", command),
          ciphertext: requireString(payload?.ciphertext, "ciphertext", command),
        },
      });
    case "sync_hash_pairing_code":
      return await invokeSyncCryptoString<T>({
        command,
        sidecar,
        fetchImpl,
        body: { code: requireString(payload?.code, "code", command) },
      });
    case "sync_hmac_sha256":
      return await invokeSyncCryptoString<T>({
        command,
        sidecar,
        fetchImpl,
        body: {
          key: requireString(payload?.key, "key", command),
          data: requireStringValue(payload?.data, "data", command),
        },
      });
    case "sync_compute_sas":
      return await invokeSyncCryptoString<T>({
        command,
        sidecar,
        fetchImpl,
        body: { sharedSecret: requireString(payload?.sharedSecret, "sharedSecret", command) },
      });
    case "store_sync_session":
      return await invokeVoidJson<T>({
        command,
        body: { refreshToken: requireString(payload?.refreshToken, "refreshToken", command) },
        sidecar,
        fetchImpl,
      });
    case "clear_sync_session":
      return await invokeVoidJson<T>({ command, sidecar, fetchImpl });
    case "get_sync_session_status":
    case "restore_sync_session":
    case "list_broker_connections":
    case "list_broker_accounts":
    case "get_subscription_plans":
    case "get_subscription_plans_public":
    case "get_user_info":
    case "get_synced_accounts":
    case "get_platforms":
    case "get_broker_sync_states":
    case "get_broker_ingest_states":
      return await invokeSimpleGet<T>({ command, sidecar, fetchImpl });
    case "sync_broker_data":
    case "broker_ingest_run":
    case "sync_broker_connections":
    case "sync_broker_accounts":
    case "sync_broker_activities":
      return await invokeRequestWithoutBody<T>({ command, sidecar, fetchImpl });
    case "get_import_runs":
    case "get_data_import_runs":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [
          ["runType", optionalStringField(payload?.runType, "runType", command)],
          ["limit", optionalQueryNumber(payload?.limit, "limit", command)],
          ["offset", optionalQueryNumber(payload?.offset, "offset", command)],
        ],
      });
    case "get_broker_sync_profile":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [
          ["accountId", requireString(payload?.accountId, "accountId", command)],
          ["sourceSystem", requireString(payload?.sourceSystem, "sourceSystem", command)],
        ],
      });
    case "save_broker_sync_profile_rules":
      return await invokePostJson<T>({
        command,
        body: requireRecord(payload?.request, "request", command),
        sidecar,
        fetchImpl,
      });
    case "update_portfolio":
    case "recalculate_portfolio":
      return await invokePostOptionalJson<T>({ command, payload, sidecar, fetchImpl });
    case "get_holdings":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [["accountId", optionalString(payload?.accountId)]],
      });
    case "get_holding":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [
          ["accountId", optionalString(payload?.accountId)],
          ["assetId", optionalString(payload?.assetId)],
        ],
      });
    case "get_asset_holdings":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [["assetId", optionalString(payload?.assetId)]],
      });
    case "get_historical_valuations":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [
          ["accountId", optionalString(payload?.accountId)],
          ["startDate", optionalString(payload?.startDate)],
          ["endDate", optionalString(payload?.endDate)],
        ],
      });
    case "get_latest_valuations":
      return await invokeGetWithRepeatedQuery<T>({
        command,
        sidecar,
        fetchImpl,
        repeatedKey: "accountIds[]",
        values: optionalStringArray(payload?.accountIds),
      });
    case "get_portfolio_allocations":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [["accountId", optionalString(payload?.accountId)]],
      });
    case "get_holdings_by_allocation":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [
          ["accountId", optionalString(payload?.accountId)],
          ["taxonomyId", optionalString(payload?.taxonomyId)],
          ["categoryId", optionalString(payload?.categoryId)],
        ],
      });
    case "calculate_accounts_simple_performance":
    case "calculate_performance_history":
    case "calculate_performance_summary":
      return await invokePostJson<T>({ command, body: payload ?? {}, sidecar, fetchImpl });
    case "get_income_summary":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [["accountId", optionalString(payload?.accountId)]],
      });
    case "get_snapshots":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [
          ["accountId", optionalString(payload?.accountId)],
          ["dateFrom", optionalString(payload?.dateFrom)],
          ["dateTo", optionalString(payload?.dateTo)],
        ],
      });
    case "get_snapshot_by_date":
    case "delete_snapshot":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [
          ["accountId", optionalString(payload?.accountId)],
          ["date", optionalString(payload?.date)],
        ],
      });
    case "save_manual_holdings":
      return await invokePostJson<T>({
        command,
        body: {
          accountId: requireString(payload?.accountId, "accountId", command),
          holdings: requireArray(payload?.holdings, "holdings", command),
          cashBalances: requireRecord(payload?.cashBalances, "cashBalances", command),
          snapshotDate: optionalString(payload?.snapshotDate),
        },
        sidecar,
        fetchImpl,
      });
    case "import_holdings_csv":
    case "check_holdings_import":
      return await invokePostJson<T>({
        command,
        body: {
          accountId: requireString(payload?.accountId, "accountId", command),
          snapshots: requireArray(payload?.snapshots, "snapshots", command),
        },
        sidecar,
        fetchImpl,
      });
    case "search_activities":
    case "check_activities_import":
    case "preview_import_assets":
    case "import_activities":
      return await invokePostJson<T>({ command, body: payload ?? {}, sidecar, fetchImpl });
    case "create_activity":
    case "update_activity":
      return await invokePostJson<T>({
        command,
        body: requireRecord(payload?.activity, "activity", command),
        sidecar,
        fetchImpl,
      });
    case "save_activities":
      return await invokePostJson<T>({
        command,
        body: requireRecord(payload?.request, "request", command),
        sidecar,
        fetchImpl,
      });
    case "delete_activity":
      return await invokeActivityDelete<T>({ payload, sidecar, fetchImpl });
    case "link_transfer_activities":
    case "unlink_transfer_activities":
      return await invokePostJson<T>({
        command,
        body: {
          activityAId: requireString(payload?.activityAId, "activityAId", command),
          activityBId: requireString(payload?.activityBId, "activityBId", command),
        },
        sidecar,
        fetchImpl,
      });
    case "get_account_import_mapping":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [
          ["accountId", optionalString(payload?.accountId)],
          ["contextKind", optionalString(payload?.contextKind)],
        ],
      });
    case "save_account_import_mapping":
      return await invokePostJson<T>({
        command,
        body: { mapping: requireRecord(payload?.mapping, "mapping", command) },
        sidecar,
        fetchImpl,
      });
    case "list_import_templates":
      return await invokeSimpleGet<T>({ command, sidecar, fetchImpl });
    case "get_import_template":
    case "delete_import_template":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [["id", optionalString(payload?.id)]],
      });
    case "save_import_template":
      return await invokePostJson<T>({
        command,
        body: { template: requireRecord(payload?.template, "template", command) },
        sidecar,
        fetchImpl,
      });
    case "link_account_template":
      return await invokePostJson<T>({
        command,
        body: {
          accountId: requireString(payload?.accountId, "accountId", command),
          templateId: requireString(payload?.templateId, "templateId", command),
          contextKind: optionalString(payload?.contextKind),
        },
        sidecar,
        fetchImpl,
      });
    case "get_latest_exchange_rates":
      return await invokeSimpleGet<T>({ command, sidecar, fetchImpl });
    case "update_exchange_rate":
      return await invokePostJson<T>({
        command,
        body: requireRecord(payload?.rate, "rate", command),
        sidecar,
        fetchImpl,
      });
    case "add_exchange_rate":
      return await invokePostJson<T>({
        command,
        body: requireRecord(payload?.newRate, "newRate", command),
        sidecar,
        fetchImpl,
      });
    case "delete_exchange_rate":
      return await invokeExchangeRateDelete<T>({ payload, sidecar, fetchImpl });
    case "get_exchanges":
    case "get_market_data_providers":
    case "get_market_data_providers_settings":
    case "get_custom_providers":
      return await invokeSimpleGet<T>({ command, sidecar, fetchImpl });
    case "update_market_data_provider_settings":
      return await invokePostJson<T>({ command, body: payload ?? {}, sidecar, fetchImpl });
    case "create_custom_provider":
    case "test_custom_provider_source":
      return await invokePostJson<T>({
        command,
        body: requireRecord(payload?.payload, "payload", command),
        sidecar,
        fetchImpl,
      });
    case "update_custom_provider":
      return await invokeCustomProviderUpdate<T>({ payload, sidecar, fetchImpl });
    case "delete_custom_provider":
      return await invokeCustomProviderDelete<T>({ payload, sidecar, fetchImpl });
    case "get_contribution_limits":
      return await invokeSimpleGet<T>({ command, sidecar, fetchImpl });
    case "create_contribution_limit":
      return await invokePostJson<T>({
        command,
        body: requireRecord(payload?.newLimit, "newLimit", command),
        sidecar,
        fetchImpl,
      });
    case "update_contribution_limit":
      return await invokeContributionLimitUpdate<T>({ payload, sidecar, fetchImpl });
    case "delete_contribution_limit":
      return await invokeContributionLimitDelete<T>({ payload, sidecar, fetchImpl });
    case "calculate_deposits_for_contribution_limit":
      return await invokeContributionLimitDeposits<T>({ payload, sidecar, fetchImpl });
    case "get_assets":
      return await invokeSimpleGet<T>({ command, sidecar, fetchImpl });
    case "create_asset":
      return await invokePostJson<T>({
        command,
        body: requireRecord(payload?.payload, "payload", command),
        sidecar,
        fetchImpl,
      });
    case "delete_asset":
      return await invokeAssetDelete<T>({ payload, sidecar, fetchImpl });
    case "get_asset_profile":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [["assetId", requireString(payload?.assetId, "assetId", command)]],
      });
    case "update_asset_profile":
      return await invokeAssetProfileUpdate<T>({ payload, sidecar, fetchImpl });
    case "update_quote_mode":
      return await invokeQuoteModeUpdate<T>({ payload, sidecar, fetchImpl });
    case "search_symbol":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [["query", requireString(payload?.query, "query", command)]],
      });
    case "resolve_symbol_quote":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [
          ["symbol", requireString(payload?.symbol, "symbol", command)],
          ["exchangeMic", optionalString(payload?.exchangeMic)],
          ["instrumentType", optionalString(payload?.instrumentType)],
          ["providerId", optionalString(payload?.providerId)],
          ["quoteCcy", optionalString(payload?.quoteCcy)],
        ],
      });
    case "get_quote_history":
    case "fetch_yahoo_dividends":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [["symbol", requireString(payload?.symbol, "symbol", command)]],
      });
    case "get_latest_quotes":
      return await invokePostJson<T>({
        command,
        body: { assetIds: requireStringArray(payload?.assetIds, "assetIds", command) },
        sidecar,
        fetchImpl,
      });
    case "update_quote":
      return await invokeQuoteUpdate<T>({ payload, sidecar, fetchImpl });
    case "delete_quote":
      return await invokeQuoteDelete<T>({ payload, sidecar, fetchImpl });
    case "check_quotes_import":
      return await invokePostJson<T>({
        command,
        body: {
          content: requireArray(payload?.content, "content", command),
          hasHeaderRow: requireBoolean(payload?.hasHeaderRow, "hasHeaderRow", command),
        },
        sidecar,
        fetchImpl,
      });
    case "import_quotes_csv":
      return await invokePostJson<T>({
        command,
        body: {
          quotes: requireArray(payload?.quotes, "quotes", command),
          overwriteExisting: requireBoolean(
            payload?.overwriteExisting,
            "overwriteExisting",
            command,
          ),
        },
        sidecar,
        fetchImpl,
      });
    case "synch_quotes":
      return await invokePostOptionalJson<T>({ command, sidecar, fetchImpl });
    case "sync_market_data":
      return await invokePostJson<T>({
        command,
        body: {
          assetIds: optionalStringArray(payload?.assetIds),
          refetchAll: requireBoolean(payload?.refetchAll, "refetchAll", command),
          refetchRecentDays: optionalNumber(payload?.refetchRecentDays),
        },
        sidecar,
        fetchImpl,
      });
    case "get_taxonomies":
    case "get_migration_status":
      return await invokeSimpleGet<T>({ command, sidecar, fetchImpl });
    case "get_taxonomy":
    case "delete_taxonomy":
      return await invokeTaxonomyById<T>({ command, payload, sidecar, fetchImpl });
    case "create_taxonomy":
    case "update_taxonomy":
      return await invokePostJson<T>({
        command,
        body: requireRecord(payload?.taxonomy, "taxonomy", command),
        sidecar,
        fetchImpl,
      });
    case "create_category":
    case "update_category":
      return await invokePostJson<T>({
        command,
        body: requireRecord(payload?.category, "category", command),
        sidecar,
        fetchImpl,
      });
    case "delete_category":
      return await invokeCategoryDelete<T>({ payload, sidecar, fetchImpl });
    case "move_category":
      return await invokePostJson<T>({
        command,
        body: {
          taxonomyId: requireString(payload?.taxonomyId, "taxonomyId", command),
          categoryId: requireString(payload?.categoryId, "categoryId", command),
          newParentId: nullableString(payload?.newParentId),
          position: requireNumber(payload?.position, "position", command),
        },
        sidecar,
        fetchImpl,
      });
    case "import_taxonomy_json":
      return await invokePostJson<T>({
        command,
        body: { jsonStr: requireString(payload?.jsonStr, "jsonStr", command) },
        sidecar,
        fetchImpl,
      });
    case "export_taxonomy_json":
      return await invokeTaxonomyExport<T>({ payload, sidecar, fetchImpl });
    case "get_asset_taxonomy_assignments":
      return await invokeAssetTaxonomyAssignments<T>({ payload, sidecar, fetchImpl });
    case "assign_asset_to_category":
      return await invokePostJson<T>({
        command,
        body: requireRecord(payload?.assignment, "assignment", command),
        sidecar,
        fetchImpl,
      });
    case "remove_asset_taxonomy_assignment":
      return await invokeTaxonomyAssignmentDelete<T>({ payload, sidecar, fetchImpl });
    case "migrate_legacy_classifications":
      return await invokePostOptionalJson<T>({ command, sidecar, fetchImpl });
    case "get_health_status":
    case "run_health_checks":
      return await invokeHealthStatus<T>({ command, payload, sidecar, fetchImpl });
    case "get_dismissed_health_issues":
    case "get_health_config":
      return await invokeSimpleGet<T>({ command, sidecar, fetchImpl });
    case "dismiss_health_issue":
      return await invokePostJson<T>({
        command,
        body: {
          issueId: requireString(payload?.issueId, "issueId", command),
          dataHash: requireString(payload?.dataHash, "dataHash", command),
        },
        sidecar,
        fetchImpl,
      });
    case "restore_health_issue":
      return await invokePostJson<T>({
        command,
        body: { issueId: requireString(payload?.issueId, "issueId", command) },
        sidecar,
        fetchImpl,
      });
    case "execute_health_fix":
      return await invokePostJson<T>({
        command,
        body: requireRecord(payload?.action, "action", command),
        sidecar,
        fetchImpl,
      });
    case "update_health_config":
      return await invokePostJson<T>({
        command,
        body: requireRecord(payload?.config, "config", command),
        sidecar,
        fetchImpl,
      });
    case "list_installed_addons":
    case "get_enabled_addons_on_startup":
    case "fetch_addon_store_listings":
      return await invokeSimpleGet<T>({ command, sidecar, fetchImpl });
    case "install_addon_zip":
      return await invokeAddonZip<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        includeEnableAfterInstall: true,
      });
    case "extract_addon_zip":
      return await invokeAddonZip<T>({ command, payload, sidecar, fetchImpl });
    case "toggle_addon":
      return await invokePostJson<T>({
        command,
        body: {
          addonId: requireString(payload?.addonId, "addonId", command),
          enabled: requireBoolean(payload?.enabled, "enabled", command),
        },
        sidecar,
        fetchImpl,
      });
    case "uninstall_addon":
    case "load_addon_for_runtime":
      return await invokeAddonByIdPath<T>({ command, payload, sidecar, fetchImpl });
    case "check_addon_update":
    case "update_addon_from_store_by_id":
    case "download_addon_to_staging":
      return await invokeAddonIdBody<T>({ command, payload, sidecar, fetchImpl });
    case "check_all_addon_updates":
      return await invokeRequestWithoutBody<T>({ command, sidecar, fetchImpl });
    case "install_addon_from_staging":
      return await invokePostJson<T>({
        command,
        body: {
          addonId: requireString(payload?.addonId, "addonId", command),
          enableAfterInstall: optionalBoolean(
            payload?.enableAfterInstall,
            "enableAfterInstall",
            command,
          ),
        },
        sidecar,
        fetchImpl,
      });
    case "clear_addon_staging":
      return await invokeClearAddonStaging<T>({ payload, sidecar, fetchImpl });
    case "get_addon_ratings":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [["addonId", requireString(payload?.addonId, "addonId", command)]],
      });
    case "submit_addon_rating":
      return await invokePostJson<T>({
        command,
        body: {
          addonId: requireString(payload?.addonId, "addonId", command),
          rating: requireRating(payload?.rating, "rating", command),
          review: optionalStringField(payload?.review, "review", command),
        },
        sidecar,
        fetchImpl,
      });
    case "get_net_worth":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [["date", optionalString(payload?.date)]],
      });
    case "get_net_worth_history":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [
          ["startDate", requireString(payload?.startDate, "startDate", command)],
          ["endDate", requireString(payload?.endDate, "endDate", command)],
        ],
      });
    case "get_ai_providers":
      return await invokeSimpleGet<T>({ command, sidecar, fetchImpl });
    case "update_ai_provider_settings": {
      const request = requireRecord(payload?.request, "request", command);
      requireString(request.providerId, "request.providerId", command);
      return await invokePostJson<T>({ command, body: request, sidecar, fetchImpl });
    }
    case "set_default_ai_provider":
      return await invokePostJson<T>({
        command,
        body: requireRecord(payload?.request, "request", command),
        sidecar,
        fetchImpl,
      });
    case "list_ai_models":
      return await invokeAiProviderModels<T>({ payload, sidecar, fetchImpl });
    case "list_ai_threads":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [
          ["cursor", optionalString(payload?.cursor)],
          ["limit", optionalQueryNumber(payload?.limit, "limit", command)],
          ["search", optionalString(payload?.search)],
        ],
      });
    case "get_ai_thread":
    case "delete_ai_thread":
      return await invokeAiThreadById<T>({ command, payload, sidecar, fetchImpl });
    case "get_ai_thread_messages":
      return await invokeAiThreadNested<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        suffix: "messages",
      });
    case "get_ai_thread_tags":
      return await invokeAiThreadNested<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        suffix: "tags",
      });
    case "update_ai_thread":
      return await invokeUpdateAiThread<T>({ payload, sidecar, fetchImpl });
    case "add_ai_thread_tag":
      return await invokeAiThreadAddTag<T>({ payload, sidecar, fetchImpl });
    case "remove_ai_thread_tag":
      return await invokeAiThreadRemoveTag<T>({ payload, sidecar, fetchImpl });
    case "update_tool_result":
      return await invokeUpdateToolResult<T>({ payload, sidecar, fetchImpl });
    case "create_alternative_asset":
      return await invokePostJson<T>({
        command,
        body: requireRecord(payload?.request, "request", command),
        sidecar,
        fetchImpl,
      });
    case "update_alternative_asset_valuation":
      return await invokeAlternativeAssetNested<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        idField: "assetId",
        suffix: "valuation",
        body: requireRecord(payload?.request, "request", command),
      });
    case "delete_alternative_asset":
      return await invokeAlternativeAssetDelete<T>({ payload, sidecar, fetchImpl });
    case "link_liability":
      return await invokeAlternativeAssetNested<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        idField: "liabilityId",
        suffix: "link-liability",
        body: requireRecord(payload?.request, "request", command),
      });
    case "unlink_liability":
      return await invokeAlternativeAssetNested<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        idField: "liabilityId",
        suffix: "link-liability",
      });
    case "update_alternative_asset_metadata":
      return await invokeAlternativeAssetNested<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        idField: "assetId",
        suffix: "metadata",
        body: {
          metadata: requireStringRecord(payload?.metadata, "metadata", command),
          name: optionalString(payload?.name),
          notes: payload?.notes === null ? null : optionalString(payload?.notes),
        },
      });
    case "get_alternative_holdings":
      return await invokeSimpleGet<T>({ command, sidecar, fetchImpl });
    case "get_goals":
      return await invokeSimpleGet<T>({ command, sidecar, fetchImpl });
    case "get_goal":
    case "delete_goal":
      return await invokeGoalById<T>({ command, payload, sidecar, fetchImpl });
    case "create_goal":
    case "update_goal":
      return await invokePostJson<T>({
        command,
        body: requireRecord(payload?.goal, "goal", command),
        sidecar,
        fetchImpl,
      });
    case "get_goal_funding":
      return await invokeGoalNested<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        suffix: "funding",
      });
    case "save_goal_funding":
      return await invokeGoalNested<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        suffix: "funding",
        body: requireArray(payload?.rules, "rules", command),
      });
    case "get_goal_plan":
    case "delete_goal_plan":
      return await invokeGoalNested<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        suffix: "plan",
      });
    case "save_goal_plan":
      return await invokePostJson<T>({
        command,
        body: requireRecord(payload?.plan, "plan", command),
        sidecar,
        fetchImpl,
      });
    case "refresh_goal_summary":
      return await invokeGoalNested<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        suffix: "refresh-summary",
      });
    case "refresh_all_goal_summaries":
      return await invokePostOptionalJson<T>({ command, sidecar, fetchImpl });
    case "get_retirement_overview":
      return await invokeGoalNested<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        suffix: "retirement/overview",
      });
    case "get_save_up_overview":
      return await invokeGoalNested<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        suffix: "save-up/overview",
      });
    case "preview_save_up_overview":
      return await invokePostJson<T>({
        command,
        body: requireRecord(payload?.input, "input", command),
        sidecar,
        fetchImpl,
      });
    case "calculate_retirement_projection":
    case "run_retirement_monte_carlo":
    case "run_retirement_stress_tests":
    case "run_retirement_scenario_analysis":
    case "run_retirement_decision_sensitivity_map":
    case "run_retirement_sorr":
      return await invokePostJson<T>({ command, body: payload ?? {}, sidecar, fetchImpl });
  }

  const unimplementedCommand: never = command;
  throw new Error(
    `Electron command "${unimplementedCommand}" passed validation but has no implementation.`,
  );
}

async function invokeGetAccounts<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const url = new URL(ELECTRON_COMMANDS.get_accounts.path, sidecar.baseUrl);
  if (payload?.includeArchived === true) {
    url.searchParams.set("includeArchived", "true");
  }

  return await fetchSidecarJson<T>({
    command: "get_accounts",
    fetchImpl,
    sidecar,
    url,
    init: { method: ELECTRON_COMMANDS.get_accounts.method },
  });
}

async function invokeCreateAccount<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const account = requireRecord(payload?.account, "account", "create_account");
  return await fetchSidecarJson<T>({
    command: "create_account",
    fetchImpl,
    sidecar,
    url: new URL(ELECTRON_COMMANDS.create_account.path, sidecar.baseUrl),
    init: {
      method: ELECTRON_COMMANDS.create_account.method,
      body: JSON.stringify(account),
    },
  });
}

async function invokeUpdateAccount<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const accountUpdate = requireRecord(payload?.accountUpdate, "accountUpdate", "update_account");
  const accountId = requireString(accountUpdate.id, "accountUpdate.id", "update_account");
  return await fetchSidecarJson<T>({
    command: "update_account",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.update_account.path}/${encodeURIComponent(accountId)}`,
      sidecar.baseUrl,
    ),
    init: {
      method: ELECTRON_COMMANDS.update_account.method,
      body: JSON.stringify(accountUpdate),
    },
  });
}

async function invokeDeleteAccount<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const accountId = requireString(payload?.accountId, "accountId", "delete_account");
  return await fetchSidecarJson<T>({
    command: "delete_account",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.delete_account.path}/${encodeURIComponent(accountId)}`,
      sidecar.baseUrl,
    ),
    init: { method: ELECTRON_COMMANDS.delete_account.method },
  });
}

async function invokeGetWithQuery<T>({
  command,
  sidecar,
  fetchImpl,
  params,
}: {
  command: ElectronCommand;
  payload?: Record<string, unknown>;
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  fetchImpl: FetchLike;
  params: Array<[string, string | undefined]>;
}): Promise<T> {
  const url = new URL(ELECTRON_COMMANDS[command].path, sidecar.baseUrl);
  for (const [key, value] of params) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }
  return await fetchSidecarJson<T>({
    command,
    fetchImpl,
    sidecar,
    url,
    init: { method: ELECTRON_COMMANDS[command].method },
  });
}

async function invokeGetWithRepeatedQuery<T>({
  command,
  sidecar,
  fetchImpl,
  repeatedKey,
  values,
}: {
  command: ElectronCommand;
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  fetchImpl: FetchLike;
  repeatedKey: string;
  values: string[] | undefined;
}): Promise<T> {
  const url = new URL(ELECTRON_COMMANDS[command].path, sidecar.baseUrl);
  for (const value of values ?? []) {
    url.searchParams.append(repeatedKey, value);
  }
  return await fetchSidecarJson<T>({
    command,
    fetchImpl,
    sidecar,
    url,
    init: { method: ELECTRON_COMMANDS[command].method },
  });
}

async function invokePostOptionalJson<T>({
  command,
  payload,
  sidecar,
  fetchImpl,
}: {
  command: Extract<
    ElectronCommand,
    | "update_portfolio"
    | "recalculate_portfolio"
    | "refresh_all_goal_summaries"
    | "synch_quotes"
    | "migrate_legacy_classifications"
  >;
  payload?: Record<string, unknown>;
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  fetchImpl: FetchLike;
}): Promise<T> {
  return await fetchSidecarJson<T>({
    command,
    fetchImpl,
    sidecar,
    url: new URL(ELECTRON_COMMANDS[command].path, sidecar.baseUrl),
    init: {
      method: ELECTRON_COMMANDS[command].method,
      body: payload ? JSON.stringify(payload) : undefined,
    },
  });
}

async function invokePostJson<T>({
  command,
  body,
  sidecar,
  fetchImpl,
}: {
  command: ElectronCommand;
  body: unknown;
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  fetchImpl: FetchLike;
}): Promise<T> {
  return await fetchSidecarJson<T>({
    command,
    fetchImpl,
    sidecar,
    url: new URL(ELECTRON_COMMANDS[command].path, sidecar.baseUrl),
    init: {
      method: ELECTRON_COMMANDS[command].method,
      body: JSON.stringify(body),
    },
  });
}

async function invokeSyncCryptoString<T>({
  command,
  sidecar,
  fetchImpl,
  body,
}: {
  command: Extract<
    ElectronCommand,
    | "sync_generate_root_key"
    | "sync_derive_dek"
    | "sync_compute_shared_secret"
    | "sync_derive_session_key"
    | "sync_encrypt"
    | "sync_decrypt"
    | "sync_generate_pairing_code"
    | "sync_hash_pairing_code"
    | "sync_hmac_sha256"
    | "sync_compute_sas"
    | "sync_generate_device_id"
  >;
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  fetchImpl: FetchLike;
  body?: Record<string, unknown>;
}): Promise<T> {
  const response = await invokeSyncCrypto<{ value?: unknown }>({
    command,
    sidecar,
    fetchImpl,
    body,
  });
  if (typeof response.value !== "string") {
    throw new Error(`Electron sync crypto command "${command}" returned an invalid value.`);
  }
  return response.value as T;
}

async function invokeSyncCrypto<T>({
  command,
  sidecar,
  fetchImpl,
  body,
}: {
  command: Extract<
    ElectronCommand,
    | "sync_generate_root_key"
    | "sync_derive_dek"
    | "sync_generate_keypair"
    | "sync_compute_shared_secret"
    | "sync_derive_session_key"
    | "sync_encrypt"
    | "sync_decrypt"
    | "sync_generate_pairing_code"
    | "sync_hash_pairing_code"
    | "sync_hmac_sha256"
    | "sync_compute_sas"
    | "sync_generate_device_id"
  >;
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  fetchImpl: FetchLike;
  body?: Record<string, unknown>;
}): Promise<T> {
  return await fetchSidecarJson<T>({
    command,
    fetchImpl,
    sidecar,
    url: new URL(ELECTRON_COMMANDS[command].path, sidecar.baseUrl),
    init: {
      method: ELECTRON_COMMANDS[command].method,
      body: body ? JSON.stringify(body) : undefined,
    },
  });
}

async function invokeVoidJson<T>({
  command,
  sidecar,
  fetchImpl,
  body,
}: {
  command: Extract<ElectronCommand, "store_sync_session" | "clear_sync_session">;
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  fetchImpl: FetchLike;
  body?: Record<string, unknown>;
}): Promise<T> {
  await fetchSidecarJson<unknown>({
    command,
    fetchImpl,
    sidecar,
    url: new URL(ELECTRON_COMMANDS[command].path, sidecar.baseUrl),
    init: {
      method: ELECTRON_COMMANDS[command].method,
      body: body ? JSON.stringify(body) : undefined,
    },
  });
  return undefined as T;
}

async function invokeActivityDelete<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const activityId = requireString(payload?.activityId, "activityId", "delete_activity");
  return await fetchSidecarJson<T>({
    command: "delete_activity",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.delete_activity.path}/${encodeURIComponent(activityId)}`,
      sidecar.baseUrl,
    ),
    init: { method: ELECTRON_COMMANDS.delete_activity.method },
  });
}

async function invokeExchangeRateDelete<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const rateId = requireString(payload?.rateId, "rateId", "delete_exchange_rate");
  return await fetchSidecarJson<T>({
    command: "delete_exchange_rate",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.delete_exchange_rate.path}/${encodeURIComponent(rateId)}`,
      sidecar.baseUrl,
    ),
    init: { method: ELECTRON_COMMANDS.delete_exchange_rate.method },
  });
}

async function invokeCustomProviderUpdate<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const providerId = requireString(payload?.providerId, "providerId", "update_custom_provider");
  const providerPayload = requireRecord(payload?.payload, "payload", "update_custom_provider");
  return await fetchSidecarJson<T>({
    command: "update_custom_provider",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.update_custom_provider.path}/${encodeURIComponent(providerId)}`,
      sidecar.baseUrl,
    ),
    init: {
      method: ELECTRON_COMMANDS.update_custom_provider.method,
      body: JSON.stringify(providerPayload),
    },
  });
}

async function invokeCustomProviderDelete<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const providerId = requireString(payload?.providerId, "providerId", "delete_custom_provider");
  return await fetchSidecarJson<T>({
    command: "delete_custom_provider",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.delete_custom_provider.path}/${encodeURIComponent(providerId)}`,
      sidecar.baseUrl,
    ),
    init: { method: ELECTRON_COMMANDS.delete_custom_provider.method },
  });
}

async function invokeContributionLimitUpdate<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const id = requireString(payload?.id, "id", "update_contribution_limit");
  const updatedLimit = requireRecord(
    payload?.updatedLimit,
    "updatedLimit",
    "update_contribution_limit",
  );
  return await fetchSidecarJson<T>({
    command: "update_contribution_limit",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.update_contribution_limit.path}/${encodeURIComponent(id)}`,
      sidecar.baseUrl,
    ),
    init: {
      method: ELECTRON_COMMANDS.update_contribution_limit.method,
      body: JSON.stringify(updatedLimit),
    },
  });
}

async function invokeContributionLimitDelete<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const id = requireString(payload?.id, "id", "delete_contribution_limit");
  return await fetchSidecarJson<T>({
    command: "delete_contribution_limit",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.delete_contribution_limit.path}/${encodeURIComponent(id)}`,
      sidecar.baseUrl,
    ),
    init: { method: ELECTRON_COMMANDS.delete_contribution_limit.method },
  });
}

async function invokeContributionLimitDeposits<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const limitId = requireString(
    payload?.limitId,
    "limitId",
    "calculate_deposits_for_contribution_limit",
  );
  return await fetchSidecarJson<T>({
    command: "calculate_deposits_for_contribution_limit",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.calculate_deposits_for_contribution_limit.path}/${encodeURIComponent(
        limitId,
      )}/deposits`,
      sidecar.baseUrl,
    ),
    init: { method: ELECTRON_COMMANDS.calculate_deposits_for_contribution_limit.method },
  });
}

async function invokeAssetDelete<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const id = requireString(payload?.id, "id", "delete_asset");
  return await fetchSidecarJson<T>({
    command: "delete_asset",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.delete_asset.path}/${encodeURIComponent(id)}`,
      sidecar.baseUrl,
    ),
    init: { method: ELECTRON_COMMANDS.delete_asset.method },
  });
}

async function invokeAssetProfileUpdate<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const id = requireString(payload?.id, "id", "update_asset_profile");
  const assetPayload = requireRecord(payload?.payload, "payload", "update_asset_profile");
  return await fetchSidecarJson<T>({
    command: "update_asset_profile",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.update_asset_profile.path}/${encodeURIComponent(id)}`,
      sidecar.baseUrl,
    ),
    init: {
      method: ELECTRON_COMMANDS.update_asset_profile.method,
      body: JSON.stringify(assetPayload),
    },
  });
}

async function invokeQuoteModeUpdate<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const id = requireString(payload?.id, "id", "update_quote_mode");
  const quoteMode = requireString(payload?.quoteMode, "quoteMode", "update_quote_mode");
  return await fetchSidecarJson<T>({
    command: "update_quote_mode",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.update_quote_mode.path}/${encodeURIComponent(id)}`,
      sidecar.baseUrl,
    ),
    init: {
      method: ELECTRON_COMMANDS.update_quote_mode.method,
      body: JSON.stringify({ quoteMode }),
    },
  });
}

async function invokeQuoteUpdate<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const symbol = requireString(payload?.symbol, "symbol", "update_quote");
  const quote = requireRecord(payload?.quote, "quote", "update_quote");
  return await fetchSidecarJson<T>({
    command: "update_quote",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.update_quote.path}/${encodeURIComponent(symbol)}`,
      sidecar.baseUrl,
    ),
    init: {
      method: ELECTRON_COMMANDS.update_quote.method,
      body: JSON.stringify(quote),
    },
  });
}

async function invokeQuoteDelete<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const id = requireString(payload?.id, "id", "delete_quote");
  return await fetchSidecarJson<T>({
    command: "delete_quote",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.delete_quote.path}/${encodeURIComponent(id)}`,
      sidecar.baseUrl,
    ),
    init: { method: ELECTRON_COMMANDS.delete_quote.method },
  });
}

async function invokeTaxonomyById<T>({
  command,
  payload,
  sidecar,
  fetchImpl,
}: {
  command: Extract<ElectronCommand, "get_taxonomy" | "delete_taxonomy">;
  payload?: Record<string, unknown>;
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  fetchImpl: FetchLike;
}): Promise<T> {
  const id = requireString(payload?.id, "id", command);
  return await fetchSidecarJson<T>({
    command,
    fetchImpl,
    sidecar,
    url: new URL(`${ELECTRON_COMMANDS[command].path}/${encodeURIComponent(id)}`, sidecar.baseUrl),
    init: { method: ELECTRON_COMMANDS[command].method },
  });
}

async function invokeCategoryDelete<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const taxonomyId = requireString(payload?.taxonomyId, "taxonomyId", "delete_category");
  const categoryId = requireString(payload?.categoryId, "categoryId", "delete_category");
  return await fetchSidecarJson<T>({
    command: "delete_category",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.delete_category.path}/${encodeURIComponent(
        taxonomyId,
      )}/categories/${encodeURIComponent(categoryId)}`,
      sidecar.baseUrl,
    ),
    init: { method: ELECTRON_COMMANDS.delete_category.method },
  });
}

async function invokeTaxonomyExport<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const id = requireString(payload?.id, "id", "export_taxonomy_json");
  return await fetchSidecarJson<T>({
    command: "export_taxonomy_json",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.export_taxonomy_json.path}/${encodeURIComponent(id)}/export`,
      sidecar.baseUrl,
    ),
    init: { method: ELECTRON_COMMANDS.export_taxonomy_json.method },
  });
}

async function invokeAssetTaxonomyAssignments<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const assetId = requireString(payload?.assetId, "assetId", "get_asset_taxonomy_assignments");
  return await fetchSidecarJson<T>({
    command: "get_asset_taxonomy_assignments",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.get_asset_taxonomy_assignments.path}/${encodeURIComponent(assetId)}`,
      sidecar.baseUrl,
    ),
    init: { method: ELECTRON_COMMANDS.get_asset_taxonomy_assignments.method },
  });
}

async function invokeTaxonomyAssignmentDelete<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const id = requireString(payload?.id, "id", "remove_asset_taxonomy_assignment");
  return await fetchSidecarJson<T>({
    command: "remove_asset_taxonomy_assignment",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.remove_asset_taxonomy_assignment.path}/${encodeURIComponent(id)}`,
      sidecar.baseUrl,
    ),
    init: { method: ELECTRON_COMMANDS.remove_asset_taxonomy_assignment.method },
  });
}

async function invokeHealthStatus<T>({
  command,
  payload,
  sidecar,
  fetchImpl,
}: {
  command: Extract<ElectronCommand, "get_health_status" | "run_health_checks">;
  payload?: Record<string, unknown>;
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  fetchImpl: FetchLike;
}): Promise<T> {
  const clientTimezone = resolveClientTimezone(payload);
  return await fetchSidecarJson<T>({
    command,
    fetchImpl,
    sidecar,
    url: new URL(ELECTRON_COMMANDS[command].path, sidecar.baseUrl),
    init: {
      method: ELECTRON_COMMANDS[command].method,
      headers: clientTimezone ? { "X-Client-Timezone": clientTimezone } : undefined,
    },
  });
}

async function invokeAlternativeAssetNested<T>({
  command,
  payload,
  sidecar,
  fetchImpl,
  idField,
  suffix,
  body,
}: {
  command: Extract<
    ElectronCommand,
    | "update_alternative_asset_valuation"
    | "link_liability"
    | "unlink_liability"
    | "update_alternative_asset_metadata"
  >;
  payload?: Record<string, unknown>;
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  fetchImpl: FetchLike;
  idField: "assetId" | "liabilityId";
  suffix: "valuation" | "link-liability" | "metadata";
  body?: unknown;
}): Promise<T> {
  const id = requireString(payload?.[idField], idField, command);
  return await fetchSidecarJson<T>({
    command,
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS[command].path}/${encodeURIComponent(id)}/${suffix}`,
      sidecar.baseUrl,
    ),
    init: {
      method: ELECTRON_COMMANDS[command].method,
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  });
}

async function invokeAlternativeAssetDelete<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const assetId = requireString(payload?.assetId, "assetId", "delete_alternative_asset");
  return await fetchSidecarJson<T>({
    command: "delete_alternative_asset",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.delete_alternative_asset.path}/${encodeURIComponent(assetId)}`,
      sidecar.baseUrl,
    ),
    init: { method: ELECTRON_COMMANDS.delete_alternative_asset.method },
  });
}

async function invokeGoalById<T>({
  command,
  payload,
  sidecar,
  fetchImpl,
}: {
  command: Extract<ElectronCommand, "get_goal" | "delete_goal">;
  payload?: Record<string, unknown>;
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  fetchImpl: FetchLike;
}): Promise<T> {
  const goalId = requireString(payload?.goalId, "goalId", command);
  return await fetchSidecarJson<T>({
    command,
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS[command].path}/${encodeURIComponent(goalId)}`,
      sidecar.baseUrl,
    ),
    init: { method: ELECTRON_COMMANDS[command].method },
  });
}

async function invokeGoalNested<T>({
  command,
  payload,
  sidecar,
  fetchImpl,
  suffix,
  body,
}: {
  command: Extract<
    ElectronCommand,
    | "get_goal_funding"
    | "save_goal_funding"
    | "get_goal_plan"
    | "delete_goal_plan"
    | "refresh_goal_summary"
    | "get_retirement_overview"
    | "get_save_up_overview"
  >;
  payload?: Record<string, unknown>;
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  fetchImpl: FetchLike;
  suffix: string;
  body?: unknown;
}): Promise<T> {
  const goalId = requireString(payload?.goalId, "goalId", command);
  return await fetchSidecarJson<T>({
    command,
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS[command].path}/${encodeURIComponent(goalId)}/${suffix}`,
      sidecar.baseUrl,
    ),
    init: {
      method: ELECTRON_COMMANDS[command].method,
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  });
}

async function invokeSimpleGet<T>({
  command,
  sidecar,
  fetchImpl,
}: {
  command: Extract<
    ElectronCommand,
    | "get_settings"
    | "is_auto_update_check_enabled"
    | "get_goals"
    | "list_import_templates"
    | "get_latest_exchange_rates"
    | "get_exchanges"
    | "get_market_data_providers"
    | "get_market_data_providers_settings"
    | "get_custom_providers"
    | "get_contribution_limits"
    | "get_assets"
    | "get_taxonomies"
    | "get_migration_status"
    | "get_dismissed_health_issues"
    | "get_health_config"
    | "get_alternative_holdings"
    | "get_ai_providers"
    | "list_installed_addons"
    | "get_enabled_addons_on_startup"
    | "fetch_addon_store_listings"
    | "get_sync_session_status"
    | "restore_sync_session"
    | "list_broker_connections"
    | "list_broker_accounts"
    | "get_subscription_plans"
    | "get_subscription_plans_public"
    | "get_user_info"
    | "get_synced_accounts"
    | "get_platforms"
    | "get_broker_sync_states"
    | "get_broker_ingest_states"
  >;
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  fetchImpl: FetchLike;
}): Promise<T> {
  return await fetchSidecarJson<T>({
    command,
    fetchImpl,
    sidecar,
    url: new URL(ELECTRON_COMMANDS[command].path, sidecar.baseUrl),
    init: { method: ELECTRON_COMMANDS[command].method },
  });
}

async function invokeRequestWithoutBody<T>({
  command,
  sidecar,
  fetchImpl,
}: {
  command: Extract<
    ElectronCommand,
    | "check_all_addon_updates"
    | "sync_broker_data"
    | "broker_ingest_run"
    | "sync_broker_connections"
    | "sync_broker_accounts"
    | "sync_broker_activities"
  >;
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  fetchImpl: FetchLike;
}): Promise<T> {
  return await fetchSidecarJson<T>({
    command,
    fetchImpl,
    sidecar,
    url: new URL(ELECTRON_COMMANDS[command].path, sidecar.baseUrl),
    init: { method: ELECTRON_COMMANDS[command].method },
  });
}

async function invokeAddonZip<T>({
  command,
  payload,
  sidecar,
  fetchImpl,
  includeEnableAfterInstall = false,
}: {
  command: Extract<ElectronCommand, "install_addon_zip" | "extract_addon_zip">;
  payload?: Record<string, unknown>;
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  fetchImpl: FetchLike;
  includeEnableAfterInstall?: boolean;
}): Promise<T> {
  const zipBytes = requireByteArray(payload?.zipData, "zipData", command);
  return await invokePostJson<T>({
    command,
    body: {
      zipDataB64: Buffer.from(Uint8Array.from(zipBytes)).toString("base64"),
      ...(includeEnableAfterInstall
        ? {
            enableAfterInstall: optionalBoolean(
              payload?.enableAfterInstall,
              "enableAfterInstall",
              command,
            ),
          }
        : {}),
    },
    sidecar,
    fetchImpl,
  });
}

async function invokeAddonByIdPath<T>({
  command,
  payload,
  sidecar,
  fetchImpl,
}: {
  command: Extract<ElectronCommand, "uninstall_addon" | "load_addon_for_runtime">;
  payload?: Record<string, unknown>;
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  fetchImpl: FetchLike;
}): Promise<T> {
  const addonId = requireString(payload?.addonId, "addonId", command);
  return await fetchSidecarJson<T>({
    command,
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS[command].path}/${encodeURIComponent(addonId)}`,
      sidecar.baseUrl,
    ),
    init: { method: ELECTRON_COMMANDS[command].method },
  });
}

async function invokeAddonIdBody<T>({
  command,
  payload,
  sidecar,
  fetchImpl,
}: {
  command: Extract<
    ElectronCommand,
    "check_addon_update" | "update_addon_from_store_by_id" | "download_addon_to_staging"
  >;
  payload?: Record<string, unknown>;
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  fetchImpl: FetchLike;
}): Promise<T> {
  return await invokePostJson<T>({
    command,
    body: { addonId: requireString(payload?.addonId, "addonId", command) },
    sidecar,
    fetchImpl,
  });
}

async function invokeClearAddonStaging<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const url = new URL(ELECTRON_COMMANDS.clear_addon_staging.path, sidecar.baseUrl);
  const addonId = optionalStringField(payload?.addonId, "addonId", "clear_addon_staging");
  if (addonId) {
    url.searchParams.set("addonId", addonId);
  }
  return await fetchSidecarJson<T>({
    command: "clear_addon_staging",
    fetchImpl,
    sidecar,
    url,
    init: { method: ELECTRON_COMMANDS.clear_addon_staging.method },
  });
}

async function invokeAiProviderModels<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const providerId = requireString(payload?.providerId, "providerId", "list_ai_models");
  return await fetchSidecarJson<T>({
    command: "list_ai_models",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.list_ai_models.path}/${encodeURIComponent(providerId)}/models`,
      sidecar.baseUrl,
    ),
    init: { method: ELECTRON_COMMANDS.list_ai_models.method },
  });
}

async function invokeAiThreadById<T>({
  command,
  payload,
  sidecar,
  fetchImpl,
}: {
  command: Extract<ElectronCommand, "get_ai_thread" | "delete_ai_thread">;
  payload?: Record<string, unknown>;
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  fetchImpl: FetchLike;
}): Promise<T> {
  const threadId = requireString(payload?.threadId, "threadId", command);
  return await fetchSidecarJson<T>({
    command,
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS[command].path}/${encodeURIComponent(threadId)}`,
      sidecar.baseUrl,
    ),
    init: { method: ELECTRON_COMMANDS[command].method },
  });
}

async function invokeAiThreadNested<T>({
  command,
  payload,
  sidecar,
  fetchImpl,
  suffix,
}: {
  command: Extract<ElectronCommand, "get_ai_thread_messages" | "get_ai_thread_tags">;
  payload?: Record<string, unknown>;
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  fetchImpl: FetchLike;
  suffix: "messages" | "tags";
}): Promise<T> {
  const threadId = requireString(payload?.threadId, "threadId", command);
  return await fetchSidecarJson<T>({
    command,
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS[command].path}/${encodeURIComponent(threadId)}/${suffix}`,
      sidecar.baseUrl,
    ),
    init: { method: ELECTRON_COMMANDS[command].method },
  });
}

async function invokeUpdateAiThread<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const request = requireRecord(payload?.request, "request", "update_ai_thread");
  const threadId = requireString(request.id, "request.id", "update_ai_thread");
  return await fetchSidecarJson<T>({
    command: "update_ai_thread",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.update_ai_thread.path}/${encodeURIComponent(threadId)}`,
      sidecar.baseUrl,
    ),
    init: {
      method: ELECTRON_COMMANDS.update_ai_thread.method,
      body: JSON.stringify({ title: request.title, isPinned: request.isPinned }),
    },
  });
}

async function invokeAiThreadAddTag<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const threadId = requireString(payload?.threadId, "threadId", "add_ai_thread_tag");
  const tag = requireString(payload?.tag, "tag", "add_ai_thread_tag");
  return await fetchSidecarJson<T>({
    command: "add_ai_thread_tag",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.add_ai_thread_tag.path}/${encodeURIComponent(threadId)}/tags`,
      sidecar.baseUrl,
    ),
    init: {
      method: ELECTRON_COMMANDS.add_ai_thread_tag.method,
      body: JSON.stringify({ tag }),
    },
  });
}

async function invokeAiThreadRemoveTag<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const threadId = requireString(payload?.threadId, "threadId", "remove_ai_thread_tag");
  const tag = requireString(payload?.tag, "tag", "remove_ai_thread_tag");
  return await fetchSidecarJson<T>({
    command: "remove_ai_thread_tag",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.remove_ai_thread_tag.path}/${encodeURIComponent(
        threadId,
      )}/tags/${encodeURIComponent(tag)}`,
      sidecar.baseUrl,
    ),
    init: { method: ELECTRON_COMMANDS.remove_ai_thread_tag.method },
  });
}

async function invokeUpdateToolResult<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const request = requireRecord(payload?.request, "request", "update_tool_result");
  return await invokePostJson<T>({
    command: "update_tool_result",
    body: {
      threadId: requireString(request.threadId, "request.threadId", "update_tool_result"),
      toolCallId: requireString(request.toolCallId, "request.toolCallId", "update_tool_result"),
      resultPatch: requireRecord(request.resultPatch, "request.resultPatch", "update_tool_result"),
    },
    sidecar,
    fetchImpl,
  });
}

async function invokeUpdateSettings<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const settingsUpdate = requireRecord(
    payload?.settingsUpdate,
    "settingsUpdate",
    "update_settings",
  );
  return await fetchSidecarJson<T>({
    command: "update_settings",
    fetchImpl,
    sidecar,
    url: new URL(ELECTRON_COMMANDS.update_settings.path, sidecar.baseUrl),
    init: {
      method: ELECTRON_COMMANDS.update_settings.method,
      body: JSON.stringify(settingsUpdate),
    },
  });
}

async function fetchSidecarJson<T>({
  command,
  fetchImpl,
  sidecar,
  url,
  init,
}: {
  command: ElectronCommand;
  fetchImpl: FetchLike;
  sidecar: Pick<SidecarHandle, "token">;
  url: URL;
  init: RequestInit;
}): Promise<T> {
  let response: Response;
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${sidecar.token}`,
  };
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  try {
    response = await fetchImpl(url, {
      ...init,
      headers: {
        ...headers,
        ...init.headers,
      },
    });
  } catch (error) {
    throw new Error(
      `Electron sidecar command "${command}" failed: ${sanitizeCommandError(formatError(error), sidecar)}`,
    );
  }

  if (!response.ok) {
    const message = sanitizeCommandError(await readErrorMessage(response), sidecar);
    throw new Error(
      `Electron sidecar command "${command}" failed with HTTP ${response.status}: ${message}`,
    );
  }

  if (response.status === 204 || response.status === 202) {
    return undefined as T;
  }

  const text = await response.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

function sanitizeCommandError(error: string, sidecar: Pick<SidecarHandle, "token">): string {
  const sanitized = sanitizeSidecarError(error);
  return sidecar.token ? sanitized.replaceAll(sidecar.token, "[redacted]") : sanitized;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireRecord(
  value: unknown,
  field: string,
  command: ElectronCommand,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Electron command "${command}" requires object payload field "${field}".`);
  }
  return value as Record<string, unknown>;
}

function requireStringRecord(
  value: unknown,
  field: string,
  command: ElectronCommand,
): Record<string, string> {
  const record = requireRecord(value, field, command);
  if (Object.values(record).some((item) => typeof item !== "string")) {
    throw new Error(
      `Electron command "${command}" requires string record payload field "${field}".`,
    );
  }
  return record as Record<string, string>;
}

function requireArray(value: unknown, field: string, command: ElectronCommand): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Electron command "${command}" requires array payload field "${field}".`);
  }
  return value;
}

function requireByteArray(value: unknown, field: string, command: ElectronCommand): number[] {
  const items = requireArray(value, field, command);
  if (
    items.length === 0 ||
    items.some(
      (item) => typeof item !== "number" || !Number.isInteger(item) || item < 0 || item > 255,
    )
  ) {
    throw new Error(`Electron command "${command}" requires byte array payload field "${field}".`);
  }
  return items as number[];
}

function requireStringArray(value: unknown, field: string, command: ElectronCommand): string[] {
  const items = requireArray(value, field, command);
  if (items.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error(
      `Electron command "${command}" requires string array payload field "${field}".`,
    );
  }
  return items as string[];
}

function requireString(value: unknown, field: string, command: ElectronCommand): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Electron command "${command}" requires string payload field "${field}".`);
  }
  return value;
}

function requireStringValue(value: unknown, field: string, command: ElectronCommand): string {
  if (typeof value !== "string") {
    throw new Error(`Electron command "${command}" requires string payload field "${field}".`);
  }
  return value;
}

function requireBoolean(value: unknown, field: string, command: ElectronCommand): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Electron command "${command}" requires boolean payload field "${field}".`);
  }
  return value;
}

function requireNumber(value: unknown, field: string, command: ElectronCommand): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Electron command "${command}" requires number payload field "${field}".`);
  }
  return value;
}

function requireUnsignedInteger(value: unknown, field: string, command: ElectronCommand): number {
  const number = requireNumber(value, field, command);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(
      `Electron command "${command}" requires unsigned integer payload field "${field}".`,
    );
  }
  return number;
}

function requireRating(value: unknown, field: string, command: ElectronCommand): number {
  const rating = requireNumber(value, field, command);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error(
      `Electron command "${command}" requires integer rating payload field "${field}" between 1 and 5.`,
    );
  }
  return rating;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalStringField(
  value: unknown,
  field: string,
  command: ElectronCommand,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Electron command "${command}" requires string payload field "${field}".`);
  }
  return value.length > 0 ? value : undefined;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(
  value: unknown,
  field: string,
  command: ElectronCommand,
): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`Electron command "${command}" requires boolean payload field "${field}".`);
  }
  return value;
}

function optionalQueryNumber(
  value: unknown,
  field: string,
  command: ElectronCommand,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return String(requireNumber(value, field, command));
}

function resolveClientTimezone(payload: Record<string, unknown> | undefined): string | undefined {
  const payloadTimezone = optionalString(payload?.clientTimezone)?.trim();
  if (payloadTimezone) {
    return payloadTimezone;
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
}

async function readErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await response.json().catch(() => undefined)) as
      | { message?: unknown; error?: unknown }
      | undefined;
    const message = body?.message ?? body?.error;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  const body = await response.text().catch(() => "");
  return body.trim() || response.statusText || "Unknown sidecar error";
}
