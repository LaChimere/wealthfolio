import type { BackendRuntimeConfig } from "./config";
import type { AccountService, AccountUpdate, NewAccount } from "./domains/accounts";
import type {
  AddonRatingRequest,
  AddonService,
  AddonStagingInstallRequest,
  AddonZipExtractRequest,
  AddonZipInstallRequest,
} from "./domains/addons";
import { parseTrackingMode } from "./domains/accounts";
import type {
  AiProviderService,
  AiProviderSettingsUpdate,
  SetDefaultAiProviderRequest,
} from "./domains/ai-providers";
import type {
  AlternativeAssetKindApi,
  AlternativeAssetService,
  CreateAlternativeAssetRequest,
  LinkLiabilityRequest,
  UpdateAlternativeAssetDetailsRequest,
  UpdateAlternativeAssetValuationRequest,
} from "./domains/alternative-assets";
import type { AppUtilityService } from "./domains/app-utilities";
import type { AssetService, NewAsset, UpdateAssetProfile } from "./domains/assets";
import type { ContributionLimitService, NewContributionLimit } from "./domains/contribution-limits";
import type {
  CustomProviderService,
  NewCustomProvider,
  NewCustomProviderSource,
  UpdateCustomProvider,
} from "./domains/custom-providers";
import type { ExchangeRate, ExchangeRateService, NewExchangeRate } from "./domains/exchange-rates";
import type { Goal, GoalFundingRuleInput, GoalService, NewGoal } from "./domains/goals";
import type { HealthConfig, HealthService } from "./domains/health";
import type {
  HoldingsImportRequest,
  HoldingsService,
  HoldingsSnapshotInput,
  SaveManualHoldingsRequest,
} from "./domains/holdings";
import type { MarketDataProviderService, ProviderUpdate } from "./domains/market-data-providers";
import {
  buildPortfolioRecalculateConfig,
  buildPortfolioUpdateConfig,
  type MarketSyncMode,
  type PortfolioJobService,
  type PortfolioRequestBody,
} from "./domains/portfolio-jobs";
import type { PerformanceRequest, PortfolioMetricsService } from "./domains/portfolio-metrics";
import type { SecretService } from "./domains/secrets";
import type { SettingsService, SettingsUpdate } from "./domains/settings";
import type {
  NewAssetTaxonomyAssignment,
  NewTaxonomy,
  NewTaxonomyCategory,
  Taxonomy,
  TaxonomyCategory,
  TaxonomyService,
} from "./domains/taxonomies";
import { createEventStream, type BackendEventBus } from "./events";
import { sidecarTokenAuthorized } from "./sidecar-auth";

export interface BackendRequestHandlerOptions {
  includeDebugRoutes?: boolean;
  debugDelayMs?: number;
  accountService?: AccountService;
  addonService?: AddonService;
  aiProviderService?: AiProviderService;
  alternativeAssetService?: AlternativeAssetService;
  appUtilityService?: AppUtilityService;
  assetService?: AssetService;
  eventBus?: BackendEventBus;
  contributionLimitService?: ContributionLimitService;
  customProviderService?: CustomProviderService;
  exchangeRateService?: ExchangeRateService;
  goalService?: GoalService;
  healthService?: HealthService;
  holdingsService?: HoldingsService;
  marketDataProviderService?: MarketDataProviderService;
  portfolioMetricsService?: PortfolioMetricsService;
  portfolioJobService?: PortfolioJobService;
  secretService?: SecretService;
  settingsService?: SettingsService;
  taxonomyService?: TaxonomyService;
}

export function createBackendRequestHandler(
  config: BackendRuntimeConfig,
  options: BackendRequestHandlerOptions = {},
): (request: Request) => Promise<Response> {
  return async (request) => {
    const response = await runWithRequestTimeout(
      () => routeRequest(request, config, options),
      config.requestTimeoutMs,
    );
    return applyCors(response, request, config);
  };
}

export async function runWithRequestTimeout(
  operation: () => Promise<Response>,
  timeoutMs: number,
): Promise<Response> {
  let timeout: Timer | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<Response>((resolve) => {
        timeout = setTimeout(() => {
          resolve(jsonResponse({ code: 408, message: "Request timeout" }, 408));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function routeRequest(
  request: Request,
  config: BackendRuntimeConfig,
  options: BackendRequestHandlerOptions,
): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }
  if (request.method === "GET" && url.pathname === "/api/v1/healthz") {
    return new Response("ok", { status: 200 });
  }
  if (request.method === "GET" && url.pathname === "/api/v1/readyz") {
    return new Response("ok", { status: 200 });
  }
  if (request.method === "GET" && url.pathname === "/api/v1/auth/status") {
    return jsonResponse({ requiresPassword: Boolean(config.authPasswordHash) });
  }

  if (options.accountService && url.pathname.startsWith("/api/v1/accounts")) {
    return await routeAccountRequest(request, url, config, options.accountService);
  }

  if (options.addonService && url.pathname.startsWith("/api/v1/addons")) {
    return routeAddonRequest(request, url, config, options.addonService);
  }

  if (options.aiProviderService && url.pathname.startsWith("/api/v1/ai/providers")) {
    return routeAiProviderRequest(request, url, config, options.aiProviderService);
  }

  if (
    options.alternativeAssetService &&
    (url.pathname.startsWith("/api/v1/alternative-assets") ||
      url.pathname === "/api/v1/alternative-holdings")
  ) {
    return routeAlternativeAssetRequest(request, url, config, options.alternativeAssetService);
  }

  if (
    options.appUtilityService &&
    (url.pathname.startsWith("/api/v1/app") ||
      url.pathname.startsWith("/api/v1/utilities/database"))
  ) {
    return routeAppUtilityRequest(request, url, config, options.appUtilityService);
  }

  if (options.assetService && url.pathname.startsWith("/api/v1/assets")) {
    return routeAssetRequest(request, url, config, options.assetService);
  }

  if (options.contributionLimitService && url.pathname.startsWith("/api/v1/limits")) {
    return await routeContributionLimitRequest(
      request,
      url,
      config,
      options.contributionLimitService,
    );
  }

  if (options.taxonomyService && url.pathname.startsWith("/api/v1/taxonomies")) {
    return routeTaxonomyRequest(request, url, config, options.taxonomyService);
  }

  if (options.customProviderService && url.pathname.startsWith("/api/v1/custom-providers")) {
    return routeCustomProviderRequest(request, url, config, options.customProviderService);
  }

  if (options.exchangeRateService && url.pathname.startsWith("/api/v1/exchange-rates")) {
    return routeExchangeRateRequest(request, url, config, options.exchangeRateService);
  }

  if (options.goalService && url.pathname.startsWith("/api/v1/goals")) {
    return routeGoalRequest(request, url, config, options.goalService);
  }

  if (options.healthService && url.pathname.startsWith("/api/v1/health")) {
    return routeHealthRequest(request, url, config, options.healthService);
  }

  if (
    options.holdingsService &&
    (url.pathname.startsWith("/api/v1/holdings") ||
      url.pathname.startsWith("/api/v1/valuations") ||
      url.pathname.startsWith("/api/v1/allocations") ||
      url.pathname.startsWith("/api/v1/snapshots"))
  ) {
    return routeHoldingsRequest(request, url, config, options.holdingsService);
  }

  if (options.eventBus && url.pathname === "/api/v1/events/stream") {
    return routeEventStreamRequest(request, config, options.eventBus);
  }

  if (
    options.marketDataProviderService &&
    (url.pathname === "/api/v1/providers" || url.pathname.startsWith("/api/v1/providers/settings"))
  ) {
    return routeMarketDataProviderRequest(request, url, config, options.marketDataProviderService);
  }

  if (options.portfolioJobService && url.pathname.startsWith("/api/v1/portfolio")) {
    return await routePortfolioJobRequest(request, url, config, options.portfolioJobService);
  }

  if (
    options.portfolioMetricsService &&
    (url.pathname.startsWith("/api/v1/net-worth") ||
      url.pathname.startsWith("/api/v1/performance") ||
      url.pathname === "/api/v1/income/summary")
  ) {
    return routePortfolioMetricsRequest(request, url, config, options.portfolioMetricsService);
  }

  if (options.secretService && url.pathname === "/api/v1/secrets") {
    return routeSecretRequest(request, url, config, options.secretService);
  }

  if (options.settingsService && url.pathname.startsWith("/api/v1/settings")) {
    return await routeSettingsRequest(request, url, config, options.settingsService);
  }

  if (options.includeDebugRoutes) {
    if (options.debugDelayMs) {
      await Bun.sleep(options.debugDelayMs);
    }
    if (request.method === "GET" && url.pathname === "/api/v1/__ts-backend/protected-ping") {
      if (!config.sidecarToken || !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
        return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
      }
      return jsonResponse({ ok: true });
    }
  }

  return jsonResponse({ code: 404, message: "Not Found" }, 404);
}

function routeAddonRequest(
  request: Request,
  url: URL,
  config: BackendRuntimeConfig,
  addonService: AddonService,
): Promise<Response> | Response {
  if (config.sidecarToken && !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/addons/installed") {
    return Promise.resolve(addonService.listInstalledAddons())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/addons/install-zip") {
    return handleJsonMutation(request, parseAddonZipInstallRequest, (input) =>
      Promise.resolve(addonService.installAddonZip(input)),
    );
  }

  if (request.method === "POST" && url.pathname === "/api/v1/addons/toggle") {
    return handleJsonMutationNoContent(request, parseAddonToggleRequest, async (input) => {
      await addonService.toggleAddon(input.addonId, input.enabled);
    });
  }

  if (request.method === "GET" && url.pathname === "/api/v1/addons/enabled-on-startup") {
    return Promise.resolve(addonService.getEnabledAddonsOnStartup())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/addons/extract") {
    return handleJsonMutation(request, parseAddonZipExtractRequest, (input) =>
      Promise.resolve(addonService.extractAddonZip(input)),
    );
  }

  if (request.method === "GET" && url.pathname === "/api/v1/addons/store/listings") {
    return Promise.resolve(addonService.fetchStoreListings())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/addons/store/ratings") {
    return handleJsonMutation(request, parseAddonRatingRequest, (input) =>
      Promise.resolve(addonService.submitRating(input)),
    );
  }

  if (request.method === "GET" && url.pathname === "/api/v1/addons/store/ratings") {
    return jsonResponse([]);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/addons/store/check-update") {
    return handleJsonMutation(request, parseAddonIdRequest, (input) =>
      Promise.resolve(addonService.checkAddonUpdate(input.addonId)),
    );
  }

  if (request.method === "POST" && url.pathname === "/api/v1/addons/store/check-all") {
    return Promise.resolve(addonService.checkAllAddonUpdates())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/addons/store/update") {
    return handleJsonMutation(request, parseAddonIdRequest, (input) =>
      Promise.resolve(addonService.updateAddonFromStore(input.addonId)),
    );
  }

  if (request.method === "POST" && url.pathname === "/api/v1/addons/store/staging/download") {
    return handleJsonMutation(request, parseAddonIdRequest, (input) =>
      Promise.resolve(addonService.downloadAddonToStaging(input.addonId)),
    );
  }

  if (request.method === "POST" && url.pathname === "/api/v1/addons/store/install-from-staging") {
    return handleJsonMutation(request, parseAddonStagingInstallRequest, (input) =>
      Promise.resolve(addonService.installAddonFromStaging(input)),
    );
  }

  if (request.method === "DELETE" && url.pathname === "/api/v1/addons/store/staging") {
    return Promise.resolve(
      addonService.clearAddonStaging(url.searchParams.get("addonId") ?? undefined),
    )
      .then(() => new Response(null, { status: 204 }))
      .catch(domainErrorResponse);
  }

  const runtimeAddonId = addonRuntimeIdFromPath(url.pathname);
  if (request.method === "GET" && runtimeAddonId !== undefined) {
    return Promise.resolve(addonService.loadAddonForRuntime(runtimeAddonId))
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  const addonId = addonIdFromPath(url.pathname);
  if (request.method === "DELETE" && addonId !== undefined) {
    return Promise.resolve(addonService.uninstallAddon(addonId))
      .then(() => new Response(null, { status: 204 }))
      .catch(domainErrorResponse);
  }

  return jsonResponse({ code: 404, message: "Not Found" }, 404);
}

function routeAiProviderRequest(
  request: Request,
  url: URL,
  config: BackendRuntimeConfig,
  aiProviderService: AiProviderService,
): Promise<Response> | Response {
  if (config.sidecarToken && !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/ai/providers") {
    return Promise.resolve(aiProviderService.getAiProviders())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "PUT" && url.pathname === "/api/v1/ai/providers/settings") {
    return handleJsonMutation(request, parseAiProviderSettingsUpdate, async (input) => {
      await aiProviderService.updateProviderSettings(input);
      return null;
    });
  }

  if (request.method === "POST" && url.pathname === "/api/v1/ai/providers/default") {
    return handleJsonMutation(request, parseSetDefaultAiProviderRequest, async (input) => {
      await aiProviderService.setDefaultProvider(input);
      return null;
    });
  }

  const providerId = aiProviderModelsIdFromPath(url.pathname);
  if (request.method === "GET" && providerId !== undefined) {
    return Promise.resolve(aiProviderService.listModels(providerId))
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  return jsonResponse({ code: 404, message: "Not Found" }, 404);
}

function routeAlternativeAssetRequest(
  request: Request,
  url: URL,
  config: BackendRuntimeConfig,
  alternativeAssetService: AlternativeAssetService,
): Promise<Response> | Response {
  if (config.sidecarToken && !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/alternative-assets") {
    return handleJsonMutation(request, parseCreateAlternativeAssetRequest, (input) =>
      Promise.resolve(alternativeAssetService.createAlternativeAsset(input)),
    );
  }

  const valuationAssetId = alternativeAssetValuationIdFromPath(url.pathname);
  if (request.method === "PUT" && valuationAssetId !== undefined) {
    return handleJsonMutation(request, parseUpdateAlternativeAssetValuationRequest, (input) =>
      Promise.resolve(alternativeAssetService.updateValuation(valuationAssetId, input)),
    );
  }

  const linkLiabilityId = alternativeAssetLinkLiabilityIdFromPath(url.pathname);
  if (linkLiabilityId !== undefined) {
    if (request.method === "POST") {
      return handleJsonMutationNoContent(request, parseLinkLiabilityRequest, async (input) => {
        await alternativeAssetService.linkLiability(linkLiabilityId, input);
      });
    }
    if (request.method === "DELETE") {
      return Promise.resolve(alternativeAssetService.unlinkLiability(linkLiabilityId))
        .then(() => new Response(null, { status: 204 }))
        .catch(domainErrorResponse);
    }
  }

  const metadataAssetId = alternativeAssetMetadataIdFromPath(url.pathname);
  if (request.method === "PUT" && metadataAssetId !== undefined) {
    return handleJsonMutationNoContent(
      request,
      parseUpdateAlternativeAssetDetailsRequest,
      async (input) => {
        await alternativeAssetService.updateAssetDetails({ ...input, assetId: metadataAssetId });
      },
    );
  }

  const assetId = alternativeAssetIdFromPath(url.pathname);
  if (request.method === "DELETE" && assetId !== undefined) {
    return Promise.resolve(alternativeAssetService.deleteAlternativeAsset(assetId))
      .then(() => new Response(null, { status: 204 }))
      .catch(domainErrorResponse);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/alternative-holdings") {
    return Promise.resolve(alternativeAssetService.getAlternativeHoldings())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  return jsonResponse({ code: 404, message: "Not Found" }, 404);
}

function routeAssetRequest(
  request: Request,
  url: URL,
  config: BackendRuntimeConfig,
  assetService: AssetService,
): Promise<Response> | Response {
  if (config.sidecarToken && !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/assets") {
    return Promise.resolve(assetService.listAssets()).then(jsonResponse).catch(domainErrorResponse);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/assets") {
    return handleJsonMutation(request, parseNewAsset, (input) =>
      Promise.resolve(assetService.createAsset(input)),
    );
  }

  if (request.method === "GET" && url.pathname === "/api/v1/assets/profile") {
    const assetId = parseRequiredQueryString(url, "assetId");
    if (assetId instanceof Response) {
      return assetId;
    }
    return Promise.resolve(assetService.getAssetProfile(assetId))
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  const profileAssetId = assetProfileIdFromPath(url.pathname);
  if (request.method === "PUT" && profileAssetId !== undefined) {
    return handleJsonMutation(request, parseUpdateAssetProfile, (input) =>
      Promise.resolve(assetService.updateAssetProfile(profileAssetId, input)),
    );
  }

  const pricingModeAssetId = assetPricingModeIdFromPath(url.pathname);
  if (request.method === "PUT" && pricingModeAssetId !== undefined) {
    return handleJsonMutation(request, parseQuoteModeBody, (input) =>
      Promise.resolve(assetService.updateQuoteMode(pricingModeAssetId, input.quoteMode)),
    );
  }

  if (
    request.method === "DELETE" &&
    (url.pathname === "/api/v1/assets/profile" || url.pathname === "/api/v1/assets/pricing-mode")
  ) {
    return jsonResponse({ code: 404, message: "Not Found" }, 404);
  }

  const assetId = assetIdFromPath(url.pathname);
  if (request.method === "DELETE" && assetId !== undefined) {
    return Promise.resolve(assetService.deleteAsset(assetId))
      .then(() => new Response(null, { status: 204 }))
      .catch(domainErrorResponse);
  }

  return jsonResponse({ code: 404, message: "Not Found" }, 404);
}

function routeAppUtilityRequest(
  request: Request,
  url: URL,
  config: BackendRuntimeConfig,
  appUtilityService: AppUtilityService,
): Promise<Response> | Response {
  if (config.sidecarToken && !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/app/info") {
    return Promise.resolve(appUtilityService.getAppInfo())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/app/check-update") {
    return Promise.resolve(appUtilityService.checkUpdate(url.searchParams.get("force") === "true"))
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/utilities/database/backup") {
    return Promise.resolve(appUtilityService.backupDatabase())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/utilities/database/backup-to-path") {
    return handleJsonMutation(request, parseBackupToPathRequest, (input) =>
      Promise.resolve(appUtilityService.backupDatabaseToPath(input.backupDir)),
    );
  }

  if (request.method === "POST" && url.pathname === "/api/v1/utilities/database/restore") {
    return handleJsonMutationNoContent(request, parseRestoreDatabaseRequest, async (input) => {
      await appUtilityService.restoreDatabase(input.backupFilePath);
    });
  }

  return jsonResponse({ code: 404, message: "Not Found" }, 404);
}

function routePortfolioMetricsRequest(
  request: Request,
  url: URL,
  config: BackendRuntimeConfig,
  portfolioMetricsService: PortfolioMetricsService,
): Promise<Response> | Response {
  if (config.sidecarToken && !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/net-worth") {
    const date = parseOptionalDateQuery(url, "date");
    if (date instanceof Response) {
      return date;
    }
    return Promise.resolve(portfolioMetricsService.getNetWorth(date))
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/net-worth/history") {
    const startDate = parseRequiredDateQuery(url, "startDate");
    if (startDate instanceof Response) {
      return startDate;
    }
    const endDate = parseRequiredDateQuery(url, "endDate");
    if (endDate instanceof Response) {
      return endDate;
    }
    return Promise.resolve(portfolioMetricsService.getNetWorthHistory(startDate, endDate))
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/performance/accounts/simple") {
    return handleJsonMutation(request, parseAccountsSimplePerformanceRequest, (input) => {
      if (input.accountIds?.length === 0) {
        return Promise.resolve([]);
      }
      return Promise.resolve(
        portfolioMetricsService.calculateAccountsSimplePerformance(input.accountIds),
      );
    });
  }

  if (request.method === "POST" && url.pathname === "/api/v1/performance/history") {
    return handleJsonMutation(request, parsePerformanceRequest, (input) =>
      Promise.resolve(portfolioMetricsService.calculatePerformanceHistory(input)),
    );
  }

  if (request.method === "POST" && url.pathname === "/api/v1/performance/summary") {
    return handleJsonMutation(request, parsePerformanceRequest, (input) =>
      Promise.resolve(portfolioMetricsService.calculatePerformanceSummary(input)),
    );
  }

  if (request.method === "GET" && url.pathname === "/api/v1/income/summary") {
    const accountId = url.searchParams.get("accountId") ?? undefined;
    return Promise.resolve(portfolioMetricsService.getIncomeSummary(accountId))
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  return jsonResponse({ code: 404, message: "Not Found" }, 404);
}

function routeHoldingsRequest(
  request: Request,
  url: URL,
  config: BackendRuntimeConfig,
  holdingsService: HoldingsService,
): Promise<Response> | Response {
  if (config.sidecarToken && !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/holdings") {
    const accountId = parseRequiredQueryString(url, "accountId");
    if (accountId instanceof Response) {
      return accountId;
    }
    return Promise.resolve(holdingsService.getHoldings(accountId))
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/holdings/item") {
    const accountId = parseRequiredQueryString(url, "accountId");
    if (accountId instanceof Response) {
      return accountId;
    }
    const assetId = parseRequiredQueryString(url, "assetId");
    if (assetId instanceof Response) {
      return assetId;
    }
    return Promise.resolve(holdingsService.getHolding(accountId, assetId))
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/holdings/by-asset") {
    const assetId = parseRequiredQueryString(url, "assetId");
    if (assetId instanceof Response) {
      return assetId;
    }
    return Promise.resolve(holdingsService.getAssetHoldings(assetId))
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/valuations/history") {
    const accountId = parseRequiredQueryString(url, "accountId");
    if (accountId instanceof Response) {
      return accountId;
    }
    const startDate = parseOptionalDateQuery(url, "startDate");
    if (startDate instanceof Response) {
      return startDate;
    }
    const endDate = parseOptionalDateQuery(url, "endDate");
    if (endDate instanceof Response) {
      return endDate;
    }
    return Promise.resolve(holdingsService.getHistoricalValuations(accountId, startDate, endDate))
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/valuations/latest") {
    return Promise.resolve(
      holdingsService.getLatestValuations(
        parseRepeatedQueryStrings(url, ["accountIds", "accountIds[]"]),
      ),
    )
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/allocations") {
    const accountId = parseRequiredQueryString(url, "accountId");
    if (accountId instanceof Response) {
      return accountId;
    }
    return Promise.resolve(holdingsService.getPortfolioAllocations(accountId))
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/allocations/holdings") {
    const accountId = parseRequiredQueryString(url, "accountId");
    if (accountId instanceof Response) {
      return accountId;
    }
    const taxonomyId = parseRequiredQueryString(url, "taxonomyId");
    if (taxonomyId instanceof Response) {
      return taxonomyId;
    }
    const categoryId = parseRequiredQueryString(url, "categoryId");
    if (categoryId instanceof Response) {
      return categoryId;
    }
    return Promise.resolve(
      holdingsService.getHoldingsByAllocation(accountId, taxonomyId, categoryId),
    )
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/snapshots") {
    const input = parseSnapshotsQuery(url);
    if (input instanceof Response) {
      return input;
    }
    return Promise.resolve(
      holdingsService.getSnapshots(input.accountId, input.dateFrom, input.dateTo),
    )
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/snapshots/holdings") {
    const accountId = parseRequiredQueryString(url, "accountId");
    if (accountId instanceof Response) {
      return accountId;
    }
    const date = parseRequiredDateQuery(url, "date");
    if (date instanceof Response) {
      return date;
    }
    return Promise.resolve(holdingsService.getSnapshotByDate(accountId, date))
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "DELETE" && url.pathname === "/api/v1/snapshots") {
    const accountId = parseRequiredQueryString(url, "accountId");
    if (accountId instanceof Response) {
      return accountId;
    }
    const date = parseRequiredDateQuery(url, "date");
    if (date instanceof Response) {
      return date;
    }
    return Promise.resolve(holdingsService.deleteSnapshot(accountId, date))
      .then(() => new Response(null, { status: 204 }))
      .catch(domainErrorResponse);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/snapshots") {
    return handleJsonMutationEmpty(request, parseSaveManualHoldingsRequest, (input) =>
      Promise.resolve(holdingsService.saveManualHoldings(input)),
    );
  }

  if (request.method === "POST" && url.pathname === "/api/v1/snapshots/import") {
    return handleJsonMutation(request, parseHoldingsImportRequest, (input) =>
      Promise.resolve(holdingsService.importHoldingsCsv(input)),
    );
  }

  if (request.method === "POST" && url.pathname === "/api/v1/snapshots/import/check") {
    return handleJsonMutation(request, parseHoldingsImportRequest, (input) =>
      Promise.resolve(holdingsService.checkHoldingsImport(input)),
    );
  }

  return jsonResponse({ code: 404, message: "Not Found" }, 404);
}

function routeSecretRequest(
  request: Request,
  url: URL,
  config: BackendRuntimeConfig,
  secretService: SecretService,
): Promise<Response> | Response {
  if (config.sidecarToken && !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  if (request.method === "POST") {
    return handleJsonMutationNoContent(request, parseSecretSetRequest, async (body) => {
      await secretService.setSecret(body.secretKey, body.secret);
    });
  }

  if (request.method === "GET") {
    const secretKey = parseRequiredQueryString(url, "secretKey");
    if (secretKey instanceof Response) {
      return secretKey;
    }
    return Promise.resolve(secretService.getSecret(secretKey))
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "DELETE") {
    const secretKey = parseRequiredQueryString(url, "secretKey");
    if (secretKey instanceof Response) {
      return secretKey;
    }
    return Promise.resolve(secretService.deleteSecret(secretKey))
      .then(() => new Response(null, { status: 204 }))
      .catch(domainErrorResponse);
  }

  return jsonResponse({ code: 404, message: "Not Found" }, 404);
}

function routeEventStreamRequest(
  request: Request,
  config: BackendRuntimeConfig,
  eventBus: BackendEventBus,
): Response {
  if (request.method !== "GET") {
    return jsonResponse({ code: 404, message: "Not Found" }, 404);
  }
  if (config.sidecarToken && !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  return new Response(createEventStream(eventBus), {
    headers: {
      "cache-control": "no-cache",
      connection: "keep-alive",
      "content-type": "text/event-stream",
    },
  });
}

async function routePortfolioJobRequest(
  request: Request,
  url: URL,
  config: BackendRuntimeConfig,
  portfolioJobService: PortfolioJobService,
): Promise<Response> {
  if (config.sidecarToken && !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/portfolio/update") {
    const body = await parseOptionalPortfolioRequestBody(request);
    if (body instanceof Response) {
      return body;
    }
    try {
      await portfolioJobService.enqueuePortfolioJob(buildPortfolioUpdateConfig(body));
      return new Response(null, { status: 202 });
    } catch (error) {
      return domainErrorResponse(error);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/v1/portfolio/recalculate") {
    const body = await parseOptionalPortfolioRequestBody(request);
    if (body instanceof Response) {
      return body;
    }
    try {
      await portfolioJobService.enqueuePortfolioJob(buildPortfolioRecalculateConfig(body));
      return new Response(null, { status: 202 });
    } catch (error) {
      return domainErrorResponse(error);
    }
  }

  return jsonResponse({ code: 404, message: "Not Found" }, 404);
}

function routeMarketDataProviderRequest(
  request: Request,
  url: URL,
  config: BackendRuntimeConfig,
  providerService: MarketDataProviderService,
): Promise<Response> | Response {
  if (config.sidecarToken && !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  if (
    request.method === "GET" &&
    (url.pathname === "/api/v1/providers" || url.pathname === "/api/v1/providers/settings")
  ) {
    return providerService.getProvidersInfo().then(jsonResponse).catch(domainErrorResponse);
  }

  if (request.method === "PUT" && url.pathname === "/api/v1/providers/settings") {
    return handleJsonMutationNoContent(request, parseProviderUpdate, (update) =>
      providerService.updateProviderSettings(update.providerId, update.priority, update.enabled),
    );
  }

  return jsonResponse({ code: 404, message: "Not Found" }, 404);
}

function routeHealthRequest(
  request: Request,
  url: URL,
  config: BackendRuntimeConfig,
  healthService: HealthService,
): Promise<Response> | Response {
  if (config.sidecarToken && !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/health/dismissed") {
    return healthService.getDismissedIds().then(jsonResponse).catch(domainErrorResponse);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/health/dismiss") {
    return handleJsonMutationEmpty(request, parseHealthDismissRequest, (body) =>
      healthService.dismissIssue(body.issueId, body.dataHash),
    );
  }

  if (request.method === "POST" && url.pathname === "/api/v1/health/restore") {
    return handleJsonMutationEmpty(request, parseHealthRestoreRequest, (body) =>
      healthService.restoreIssue(body.issueId),
    );
  }

  if (request.method === "GET" && url.pathname === "/api/v1/health/config") {
    return healthService.getConfig().then(jsonResponse).catch(domainErrorResponse);
  }

  if (request.method === "PUT" && url.pathname === "/api/v1/health/config") {
    return handleJsonMutationEmpty(request, parseHealthConfig, (config) =>
      healthService.updateConfig(config),
    );
  }

  return jsonResponse({ code: 404, message: "Not Found" }, 404);
}

function routeExchangeRateRequest(
  request: Request,
  url: URL,
  config: BackendRuntimeConfig,
  exchangeRateService: ExchangeRateService,
): Promise<Response> | Response {
  if (config.sidecarToken && !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/exchange-rates/latest") {
    return jsonResponse(exchangeRateService.getLatestExchangeRates());
  }

  if (request.method === "POST" && url.pathname === "/api/v1/exchange-rates") {
    return handleJsonMutation(request, parseNewExchangeRate, (newRate) =>
      exchangeRateService.addExchangeRate(newRate),
    );
  }

  if (request.method === "PUT" && url.pathname === "/api/v1/exchange-rates") {
    return handleJsonMutation(request, parseExchangeRate, (rate) =>
      exchangeRateService.updateExchangeRate(rate.fromCurrency, rate.toCurrency, rate.rate),
    );
  }

  const rateId = exchangeRateIdFromPath(url.pathname);
  if (rateId && request.method === "DELETE") {
    return exchangeRateService
      .deleteExchangeRate(rateId)
      .then(() => new Response(null, { status: 204 }))
      .catch(domainErrorResponse);
  }

  return jsonResponse({ code: 404, message: "Not Found" }, 404);
}

function routeGoalRequest(
  request: Request,
  url: URL,
  config: BackendRuntimeConfig,
  goalService: GoalService,
): Promise<Response> | Response {
  if (config.sidecarToken && !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  const fundingGoalId = goalFundingIdFromPath(url.pathname);
  if (fundingGoalId && request.method === "GET") {
    return jsonResponse(goalService.getGoalFunding(fundingGoalId));
  }
  if (fundingGoalId && request.method === "PUT") {
    return handleJsonArrayMutation(request, parseGoalFundingRuleInput, (rules) =>
      goalService.saveGoalFunding(fundingGoalId, rules),
    );
  }

  const planGoalId = goalPlanIdFromPath(url.pathname);
  if (planGoalId && request.method === "GET") {
    return jsonResponse(goalService.getGoalPlan(planGoalId));
  }

  if (request.method === "GET" && url.pathname === "/api/v1/goals") {
    return jsonResponse(goalService.getGoals());
  }

  if (request.method === "POST" && url.pathname === "/api/v1/goals") {
    return handleJsonMutation(request, parseNewGoal, (newGoal) =>
      goalService.createGoal(forceGoalCurrency(newGoal, goalService)),
    );
  }

  if (request.method === "PUT" && url.pathname === "/api/v1/goals") {
    return handleJsonMutation(request, parseGoal, (goal) =>
      goalService.updateGoal(forceGoalCurrency(goal, goalService)),
    );
  }

  const goalId = goalIdFromPath(url.pathname);
  if (goalId && request.method === "GET") {
    return jsonResponse(goalService.getGoal(goalId));
  }

  if (goalId && request.method === "DELETE") {
    return goalService
      .deleteGoal(goalId)
      .then(() => new Response(null, { status: 204 }))
      .catch(domainErrorResponse);
  }

  return jsonResponse({ code: 404, message: "Not Found" }, 404);
}

function routeCustomProviderRequest(
  request: Request,
  url: URL,
  config: BackendRuntimeConfig,
  customProviderService: CustomProviderService,
): Promise<Response> | Response {
  if (config.sidecarToken && !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/custom-providers") {
    return jsonResponse(customProviderService.getAll());
  }

  if (request.method === "POST" && url.pathname === "/api/v1/custom-providers") {
    return handleJsonMutation(request, parseNewCustomProvider, (newProvider) =>
      customProviderService.create(newProvider),
    );
  }

  const providerId = customProviderIdFromPath(url.pathname);
  if (providerId && request.method === "PUT") {
    return handleJsonMutation(request, parseUpdateCustomProvider, (update) =>
      customProviderService.update(providerId, update),
    );
  }

  if (providerId && request.method === "DELETE") {
    return customProviderService
      .delete(providerId)
      .then(() => new Response(null, { status: 204 }))
      .catch(domainErrorResponse);
  }

  return jsonResponse({ code: 404, message: "Not Found" }, 404);
}

function routeTaxonomyRequest(
  request: Request,
  url: URL,
  config: BackendRuntimeConfig,
  taxonomyService: TaxonomyService,
): Promise<Response> | Response {
  if (config.sidecarToken && !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/taxonomies") {
    return jsonResponse(taxonomyService.getTaxonomies());
  }

  if (request.method === "POST" && url.pathname === "/api/v1/taxonomies") {
    return handleJsonMutation(request, parseNewTaxonomy, (newTaxonomy) =>
      taxonomyService.createTaxonomy(newTaxonomy),
    );
  }

  if (request.method === "PUT" && url.pathname === "/api/v1/taxonomies") {
    return handleJsonMutation(request, parseTaxonomy, (taxonomy) =>
      taxonomyService.updateTaxonomy(taxonomy),
    );
  }

  if (request.method === "POST" && url.pathname === "/api/v1/taxonomies/categories") {
    return handleJsonMutation(request, parseNewTaxonomyCategory, (newCategory) =>
      taxonomyService.createCategory(newCategory),
    );
  }

  if (request.method === "PUT" && url.pathname === "/api/v1/taxonomies/categories") {
    return handleJsonMutation(request, parseTaxonomyCategory, (category) =>
      taxonomyService.updateCategory(category),
    );
  }

  if (request.method === "POST" && url.pathname === "/api/v1/taxonomies/categories/move") {
    return handleJsonMutation(request, parseMoveCategoryRequest, (moveRequest) =>
      taxonomyService.moveCategory(
        moveRequest.taxonomyId,
        moveRequest.categoryId,
        moveRequest.newParentId,
        moveRequest.position,
      ),
    );
  }

  const assignmentAssetId = taxonomyAssignmentAssetIdFromPath(url.pathname);
  if (assignmentAssetId && request.method === "GET") {
    return jsonResponse(taxonomyService.getAssetAssignments(assignmentAssetId));
  }

  if (request.method === "POST" && url.pathname === "/api/v1/taxonomies/assignments") {
    return handleJsonMutation(request, parseNewAssetTaxonomyAssignment, (assignment) =>
      taxonomyService.assignAssetToCategory(assignment),
    );
  }

  if (request.method === "POST" && url.pathname === "/api/v1/taxonomies/import") {
    return handleJsonMutation(request, parseImportTaxonomyRequest, (importRequest) =>
      taxonomyService.importTaxonomyJson(importRequest.jsonStr),
    );
  }

  const exportTaxonomyId = exportTaxonomyIdFromPath(url.pathname);
  if (exportTaxonomyId && request.method === "GET") {
    try {
      return jsonResponse(taxonomyService.exportTaxonomyJson(exportTaxonomyId));
    } catch (error) {
      return domainErrorResponse(error);
    }
  }

  const assignmentId = taxonomyAssignmentIdFromPath(url.pathname);
  if (assignmentId && request.method === "DELETE") {
    return taxonomyService
      .removeAssetAssignment(assignmentId)
      .then(() => new Response(null, { status: 204 }))
      .catch(domainErrorResponse);
  }

  const categoryIds = taxonomyCategoryIdsFromPath(url.pathname);
  if (categoryIds && request.method === "DELETE") {
    return taxonomyService
      .deleteCategory(categoryIds.taxonomyId, categoryIds.categoryId)
      .then(() => new Response(null, { status: 204 }))
      .catch(domainErrorResponse);
  }

  const taxonomyId = taxonomyIdFromPath(url.pathname);
  if (taxonomyId && request.method === "GET") {
    return jsonResponse(taxonomyService.getTaxonomy(taxonomyId));
  }

  if (taxonomyId && request.method === "DELETE") {
    return taxonomyService
      .deleteTaxonomy(taxonomyId)
      .then(() => new Response(null, { status: 204 }))
      .catch(domainErrorResponse);
  }

  return jsonResponse({ code: 404, message: "Not Found" }, 404);
}

async function routeContributionLimitRequest(
  request: Request,
  url: URL,
  config: BackendRuntimeConfig,
  contributionLimitService: ContributionLimitService,
): Promise<Response> {
  if (config.sidecarToken && !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/limits") {
    return jsonResponse(contributionLimitService.getContributionLimits());
  }

  if (request.method === "POST" && url.pathname === "/api/v1/limits") {
    const payload = await parseJsonBody(request);
    if (payload instanceof Response) {
      return payload;
    }
    const newLimit = parseNewContributionLimit(payload);
    if (newLimit instanceof Response) {
      return newLimit;
    }
    try {
      return jsonResponse(await contributionLimitService.createContributionLimit(newLimit));
    } catch (error) {
      return domainErrorResponse(error);
    }
  }

  const depositsLimitId = contributionLimitDepositsIdFromPath(url.pathname);
  if (depositsLimitId && request.method === "GET") {
    try {
      return jsonResponse(
        await contributionLimitService.calculateDepositsForContributionLimit(depositsLimitId),
      );
    } catch (error) {
      return domainErrorResponse(error);
    }
  }

  const limitId = contributionLimitIdFromPath(url.pathname);
  if (!limitId) {
    return jsonResponse({ code: 404, message: "Not Found" }, 404);
  }

  if (request.method === "PUT") {
    const payload = await parseJsonBody(request);
    if (payload instanceof Response) {
      return payload;
    }
    const updatedLimit = parseNewContributionLimit(payload);
    if (updatedLimit instanceof Response) {
      return updatedLimit;
    }
    try {
      return jsonResponse(
        await contributionLimitService.updateContributionLimit(limitId, updatedLimit),
      );
    } catch (error) {
      return domainErrorResponse(error);
    }
  }

  if (request.method === "DELETE") {
    try {
      await contributionLimitService.deleteContributionLimit(limitId);
      return new Response(null, { status: 204 });
    } catch (error) {
      return domainErrorResponse(error);
    }
  }

  return jsonResponse({ code: 404, message: "Not Found" }, 404);
}

async function routeAccountRequest(
  request: Request,
  url: URL,
  config: BackendRuntimeConfig,
  accountService: AccountService,
): Promise<Response> {
  if (config.sidecarToken && !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/accounts") {
    const includeArchived = url.searchParams.get("includeArchived") === "true";
    return jsonResponse(
      includeArchived ? accountService.getAllAccounts() : accountService.getNonArchivedAccounts(),
    );
  }

  if (request.method === "POST" && url.pathname === "/api/v1/accounts") {
    const payload = await parseJsonBody(request);
    if (payload instanceof Response) {
      return payload;
    }
    const newAccount = parseNewAccount(payload);
    if (newAccount instanceof Response) {
      return newAccount;
    }
    try {
      return jsonResponse(await accountService.createAccount(newAccount));
    } catch (error) {
      return domainErrorResponse(error);
    }
  }

  const accountId = accountIdFromPath(url.pathname);
  if (!accountId) {
    return jsonResponse({ code: 404, message: "Not Found" }, 404);
  }

  if (request.method === "PUT") {
    const payload = await parseJsonBody(request);
    if (payload instanceof Response) {
      return payload;
    }
    const accountUpdate = parseAccountUpdate(payload, accountId);
    if (accountUpdate instanceof Response) {
      return accountUpdate;
    }
    try {
      return jsonResponse(await accountService.updateAccount(accountUpdate));
    } catch (error) {
      return domainErrorResponse(error);
    }
  }

  if (request.method === "DELETE") {
    try {
      await accountService.deleteAccount(accountId);
      return new Response(null, { status: 204 });
    } catch (error) {
      return domainErrorResponse(error);
    }
  }

  return jsonResponse({ code: 404, message: "Not Found" }, 404);
}

async function routeSettingsRequest(
  request: Request,
  url: URL,
  config: BackendRuntimeConfig,
  settingsService: SettingsService,
): Promise<Response> {
  if (config.sidecarToken && !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }
  if (request.method === "GET" && url.pathname === "/api/v1/settings") {
    return jsonResponse(settingsService.getSettings());
  }
  if (request.method === "POST" && url.pathname === "/api/v1/settings") {
    const payload = await parseJsonBody(request);
    if (payload instanceof Response) {
      return payload;
    }
    const update = parseSettingsUpdate(payload);
    if (update instanceof Response) {
      return update;
    }
    try {
      return jsonResponse(settingsService.updateSettings(update));
    } catch (error) {
      return jsonResponse(
        { code: 400, message: error instanceof Error ? error.message : String(error) },
        400,
      );
    }
  }
  if (request.method === "GET" && url.pathname === "/api/v1/settings/auto-update-enabled") {
    return jsonResponse(settingsService.isAutoUpdateCheckEnabled());
  }
  return jsonResponse({ code: 404, message: "Not Found" }, 404);
}

function accountIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/v1\/accounts\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function addonIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/v1\/addons\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function addonRuntimeIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/v1\/addons\/runtime\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function aiProviderModelsIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/v1\/ai\/providers\/([^/]+)\/models$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function alternativeAssetIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/v1\/alternative-assets\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function alternativeAssetValuationIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/v1\/alternative-assets\/([^/]+)\/valuation$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function alternativeAssetLinkLiabilityIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/v1\/alternative-assets\/([^/]+)\/link-liability$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function alternativeAssetMetadataIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/v1\/alternative-assets\/([^/]+)\/metadata$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function assetIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/v1\/assets\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function assetProfileIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/v1\/assets\/profile\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function assetPricingModeIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/v1\/assets\/pricing-mode\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function contributionLimitIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/v1\/limits\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function contributionLimitDepositsIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/v1\/limits\/([^/]+)\/deposits$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function taxonomyIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/v1\/taxonomies\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function customProviderIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/v1\/custom-providers\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function exchangeRateIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/v1\/exchange-rates\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function goalIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/v1\/goals\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function goalFundingIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/v1\/goals\/([^/]+)\/funding$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function goalPlanIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/v1\/goals\/([^/]+)\/plan$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function taxonomyCategoryIdsFromPath(
  pathname: string,
): { taxonomyId: string; categoryId: string } | undefined {
  const match = /^\/api\/v1\/taxonomies\/([^/]+)\/categories\/([^/]+)$/.exec(pathname);
  return match
    ? {
        taxonomyId: decodeURIComponent(match[1]),
        categoryId: decodeURIComponent(match[2]),
      }
    : undefined;
}

function taxonomyAssignmentAssetIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/v1\/taxonomies\/assignments\/asset\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function taxonomyAssignmentIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/v1\/taxonomies\/assignments\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function exportTaxonomyIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/v1\/taxonomies\/([^/]+)\/export$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function applyCors(response: Response, request: Request, config: BackendRuntimeConfig): Response {
  const origin = request.headers.get("origin");
  const allowedOrigin = resolveAllowedOrigin(origin, config.cors.allowOrigins);
  if (!allowedOrigin) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", allowedOrigin);
  headers.set("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  headers.set("access-control-allow-headers", "authorization,content-type,x-requested-with");
  if (allowedOrigin !== "*") {
    headers.set("access-control-allow-credentials", "true");
    headers.append("vary", "Origin");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function resolveAllowedOrigin(origin: string | null, allowOrigins: string[]): string | undefined {
  if (allowOrigins.includes("*")) {
    return "*";
  }
  if (origin && allowOrigins.includes(origin)) {
    return origin;
  }
  return undefined;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function domainErrorResponse(error: unknown): Response {
  return jsonResponse(
    { code: 400, message: error instanceof Error ? error.message : String(error) },
    400,
  );
}

async function parseJsonBody(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    const payload = await request.json();
    if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
      return payload as Record<string, unknown>;
    }
  } catch {
    // Fall through to the explicit bad-request response below.
  }
  return jsonResponse({ code: 400, message: "Invalid JSON body" }, 400);
}

async function parseJsonArrayBody(request: Request): Promise<unknown[] | Response> {
  try {
    const payload = await request.json();
    if (Array.isArray(payload)) {
      return payload;
    }
  } catch {
    // Fall through to the explicit bad-request response below.
  }
  return jsonResponse({ code: 400, message: "Invalid JSON array body" }, 400);
}

async function parseOptionalPortfolioRequestBody(
  request: Request,
): Promise<PortfolioRequestBody | Response> {
  let text = "";
  try {
    text = await request.text();
  } catch {
    return jsonResponse({ code: 400, message: "Invalid JSON body" }, 400);
  }
  if (text.trim() === "") {
    return {};
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return jsonResponse({ code: 400, message: "Invalid JSON body" }, 400);
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return jsonResponse({ code: 400, message: "Invalid JSON body" }, 400);
  }
  return parsePortfolioRequestBody(payload as Record<string, unknown>);
}

async function handleJsonMutation<TInput, TOutput>(
  request: Request,
  parse: (payload: Record<string, unknown>) => TInput | Response,
  mutate: (input: TInput) => Promise<TOutput>,
): Promise<Response> {
  const payload = await parseJsonBody(request);
  if (payload instanceof Response) {
    return payload;
  }
  const input = parse(payload);
  if (input instanceof Response) {
    return input;
  }
  try {
    return jsonResponse(await mutate(input));
  } catch (error) {
    return domainErrorResponse(error);
  }
}

async function handleJsonMutationEmpty<TInput>(
  request: Request,
  parse: (payload: Record<string, unknown>) => TInput | Response,
  mutate: (input: TInput) => Promise<void>,
): Promise<Response> {
  const payload = await parseJsonBody(request);
  if (payload instanceof Response) {
    return payload;
  }
  const input = parse(payload);
  if (input instanceof Response) {
    return input;
  }
  try {
    await mutate(input);
    return new Response(null, { status: 200 });
  } catch (error) {
    return domainErrorResponse(error);
  }
}

async function handleJsonMutationNoContent<TInput>(
  request: Request,
  parse: (payload: Record<string, unknown>) => TInput | Response,
  mutate: (input: TInput) => Promise<void>,
): Promise<Response> {
  const payload = await parseJsonBody(request);
  if (payload instanceof Response) {
    return payload;
  }
  const input = parse(payload);
  if (input instanceof Response) {
    return input;
  }
  try {
    await mutate(input);
    return new Response(null, { status: 204 });
  } catch (error) {
    return domainErrorResponse(error);
  }
}

async function handleJsonArrayMutation<TInput, TOutput>(
  request: Request,
  parseItem: (payload: Record<string, unknown>, index: number) => TInput | Response,
  mutate: (input: TInput[]) => Promise<TOutput>,
): Promise<Response> {
  const payload = await parseJsonArrayBody(request);
  if (payload instanceof Response) {
    return payload;
  }
  const input: TInput[] = [];
  for (const [index, item] of payload.entries()) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return jsonResponse({ code: 400, message: `body[${index}] must be an object` }, 400);
    }
    const parsed = parseItem(item as Record<string, unknown>, index);
    if (parsed instanceof Response) {
      return parsed;
    }
    input.push(parsed);
  }
  try {
    return jsonResponse(await mutate(input));
  } catch (error) {
    return domainErrorResponse(error);
  }
}

function parseHealthDismissRequest(
  payload: Record<string, unknown>,
): { issueId: string; dataHash: string } | Response {
  const issueId = parseRequiredString(payload.issueId, "issueId");
  if (issueId instanceof Response) {
    return issueId;
  }
  const dataHash = parseRequiredString(payload.dataHash, "dataHash");
  if (dataHash instanceof Response) {
    return dataHash;
  }
  return { issueId, dataHash };
}

function parseHealthRestoreRequest(
  payload: Record<string, unknown>,
): { issueId: string } | Response {
  const issueId = parseRequiredString(payload.issueId, "issueId");
  if (issueId instanceof Response) {
    return issueId;
  }
  return { issueId };
}

function parseHealthConfig(payload: Record<string, unknown>): HealthConfig | Response {
  const priceStaleWarningHours = parseRequiredInteger(
    payload.priceStaleWarningHours,
    "priceStaleWarningHours",
  );
  if (priceStaleWarningHours instanceof Response) {
    return priceStaleWarningHours;
  }
  const priceStaleCriticalHours = parseRequiredInteger(
    payload.priceStaleCriticalHours,
    "priceStaleCriticalHours",
  );
  if (priceStaleCriticalHours instanceof Response) {
    return priceStaleCriticalHours;
  }
  const fxStaleWarningHours = parseRequiredInteger(
    payload.fxStaleWarningHours,
    "fxStaleWarningHours",
  );
  if (fxStaleWarningHours instanceof Response) {
    return fxStaleWarningHours;
  }
  const fxStaleCriticalHours = parseRequiredInteger(
    payload.fxStaleCriticalHours,
    "fxStaleCriticalHours",
  );
  if (fxStaleCriticalHours instanceof Response) {
    return fxStaleCriticalHours;
  }
  const mvEscalationThreshold = parseRequiredNumber(
    payload.mvEscalationThreshold,
    "mvEscalationThreshold",
  );
  if (mvEscalationThreshold instanceof Response) {
    return mvEscalationThreshold;
  }
  const classificationWarnThreshold = parseRequiredNumber(
    payload.classificationWarnThreshold,
    "classificationWarnThreshold",
  );
  if (classificationWarnThreshold instanceof Response) {
    return classificationWarnThreshold;
  }

  return {
    priceStaleWarningHours,
    priceStaleCriticalHours,
    fxStaleWarningHours,
    fxStaleCriticalHours,
    mvEscalationThreshold,
    classificationWarnThreshold,
  };
}

function parseProviderUpdate(payload: Record<string, unknown>): ProviderUpdate | Response {
  const providerId = parseRequiredString(payload.providerId, "providerId");
  if (providerId instanceof Response) {
    return providerId;
  }
  const priority = parseRequiredInteger(payload.priority, "priority");
  if (priority instanceof Response) {
    return priority;
  }
  const enabled = parseRequiredBoolean(payload.enabled, "enabled");
  if (enabled instanceof Response) {
    return enabled;
  }

  return { providerId, priority, enabled };
}

function parseAiProviderSettingsUpdate(
  payload: Record<string, unknown>,
): AiProviderSettingsUpdate | Response {
  const providerId = parseRequiredString(payload.providerId, "providerId");
  if (providerId instanceof Response) {
    return providerId;
  }

  const parsed: AiProviderSettingsUpdate = { providerId };
  const enabled = parseOptionalBooleanOrNull(payload.enabled, "enabled");
  if (enabled instanceof Response) {
    return enabled;
  }
  if (enabled !== undefined && enabled !== null) {
    parsed.enabled = enabled;
  }
  const favorite = parseOptionalBooleanOrNull(payload.favorite, "favorite");
  if (favorite instanceof Response) {
    return favorite;
  }
  if (favorite !== undefined && favorite !== null) {
    parsed.favorite = favorite;
  }
  const selectedModel = parseOptionalStringOrNull(payload.selectedModel, "selectedModel");
  if (selectedModel instanceof Response) {
    return selectedModel;
  }
  if (selectedModel !== undefined && selectedModel !== null) {
    parsed.selectedModel = selectedModel;
  }
  const customUrl = parseOptionalStringOrNull(payload.customUrl, "customUrl");
  if (customUrl instanceof Response) {
    return customUrl;
  }
  if (customUrl !== undefined && customUrl !== null) {
    parsed.customUrl = customUrl;
  }
  const priority = parseOptionalIntegerOrNull(payload.priority, "priority");
  if (priority instanceof Response) {
    return priority;
  }
  if (priority !== undefined && priority !== null) {
    parsed.priority = priority;
  }
  const favoriteModels = parseOptionalStringArrayOrNull(payload.favoriteModels, "favoriteModels");
  if (favoriteModels instanceof Response) {
    return favoriteModels;
  }
  if (favoriteModels !== undefined && favoriteModels !== null) {
    parsed.favoriteModels = favoriteModels;
  }
  const toolsAllowlist = parseOptionalStringArrayOrNull(payload.toolsAllowlist, "toolsAllowlist");
  if (toolsAllowlist instanceof Response) {
    return toolsAllowlist;
  }
  if (toolsAllowlist !== undefined) {
    parsed.toolsAllowlist = toolsAllowlist;
  }
  const modelCapabilityOverride = parseOptionalRecordOrNull(
    payload.modelCapabilityOverride,
    "modelCapabilityOverride",
  );
  if (modelCapabilityOverride instanceof Response) {
    return modelCapabilityOverride;
  }
  if (modelCapabilityOverride !== undefined && modelCapabilityOverride !== null) {
    parsed.modelCapabilityOverride = modelCapabilityOverride;
  }
  const tuningOverrides = parseOptionalRecordOrNull(payload.tuningOverrides, "tuningOverrides");
  if (tuningOverrides instanceof Response) {
    return tuningOverrides;
  }
  if (tuningOverrides !== undefined) {
    parsed.tuningOverrides = tuningOverrides;
  }

  return parsed;
}

function parseSetDefaultAiProviderRequest(
  payload: Record<string, unknown>,
): SetDefaultAiProviderRequest | Response {
  const providerId = parseOptionalStringOrNull(payload.providerId, "providerId");
  if (providerId instanceof Response) {
    return providerId;
  }
  return providerId === undefined ? {} : { providerId };
}

const alternativeAssetKinds = new Set<AlternativeAssetKindApi>([
  "property",
  "vehicle",
  "collectible",
  "precious",
  "liability",
  "other",
]);

function parseCreateAlternativeAssetRequest(
  payload: Record<string, unknown>,
): CreateAlternativeAssetRequest | Response {
  const kind = parseAlternativeAssetKind(payload.kind, "kind");
  if (kind instanceof Response) {
    return kind;
  }
  const name = parseRequiredString(payload.name, "name");
  if (name instanceof Response) {
    return name;
  }
  const currency = parseRequiredString(payload.currency, "currency");
  if (currency instanceof Response) {
    return currency;
  }
  const currentValue = parseRequiredString(payload.currentValue, "currentValue");
  if (currentValue instanceof Response) {
    return currentValue;
  }
  const valueDate = parseRequiredString(payload.valueDate, "valueDate");
  if (valueDate instanceof Response) {
    return valueDate;
  }
  const purchasePrice = parseOptionalStringOrNull(payload.purchasePrice, "purchasePrice");
  if (purchasePrice instanceof Response) {
    return purchasePrice;
  }
  const purchaseDate = parseOptionalStringOrNull(payload.purchaseDate, "purchaseDate");
  if (purchaseDate instanceof Response) {
    return purchaseDate;
  }
  const metadata = parseOptionalRecordOrNull(payload.metadata, "metadata");
  if (metadata instanceof Response) {
    return metadata;
  }
  const linkedAssetId = parseOptionalStringOrNull(payload.linkedAssetId, "linkedAssetId");
  if (linkedAssetId instanceof Response) {
    return linkedAssetId;
  }

  const parsed: CreateAlternativeAssetRequest = {
    kind,
    name,
    currency,
    currentValue,
    valueDate,
  };
  if (purchasePrice !== undefined && purchasePrice !== null) {
    parsed.purchasePrice = purchasePrice;
  }
  if (purchaseDate !== undefined && purchaseDate !== null) {
    parsed.purchaseDate = purchaseDate;
  }
  if (metadata !== undefined && metadata !== null) {
    parsed.metadata = metadata;
  }
  if (linkedAssetId !== undefined && linkedAssetId !== null) {
    parsed.linkedAssetId = linkedAssetId;
  }
  return parsed;
}

function parseUpdateAlternativeAssetValuationRequest(
  payload: Record<string, unknown>,
): UpdateAlternativeAssetValuationRequest | Response {
  const value = parseRequiredString(payload.value, "value");
  if (value instanceof Response) {
    return value;
  }
  const date = parseRequiredString(payload.date, "date");
  if (date instanceof Response) {
    return date;
  }
  const notes = parseOptionalStringOrNull(payload.notes, "notes");
  if (notes instanceof Response) {
    return notes;
  }
  return notes === undefined || notes === null ? { value, date } : { value, date, notes };
}

function parseLinkLiabilityRequest(
  payload: Record<string, unknown>,
): LinkLiabilityRequest | Response {
  const targetAssetId = parseRequiredString(payload.targetAssetId, "targetAssetId");
  if (targetAssetId instanceof Response) {
    return targetAssetId;
  }
  return { targetAssetId };
}

function parseUpdateAlternativeAssetDetailsRequest(
  payload: Record<string, unknown>,
): Omit<UpdateAlternativeAssetDetailsRequest, "assetId"> | Response {
  const name = parseOptionalStringOrNull(payload.name, "name");
  if (name instanceof Response) {
    return name;
  }
  const metadata = parseRequiredStringRecord(payload.metadata, "metadata");
  if (metadata instanceof Response) {
    return metadata;
  }
  const notes = parseOptionalStringOrNull(payload.notes, "notes");
  if (notes instanceof Response) {
    return notes;
  }

  const parsed: Omit<UpdateAlternativeAssetDetailsRequest, "assetId"> = {
    metadata: Object.fromEntries(
      Object.entries(metadata).map(([key, value]) => [key, value === "" ? null : value]),
    ),
  };
  if (name !== undefined && name !== null) {
    parsed.name = name;
  }
  if (notes !== undefined && notes !== null) {
    parsed.notes = notes;
  }
  return parsed;
}

function parseAlternativeAssetKind(
  value: unknown,
  field: string,
): AlternativeAssetKindApi | Response {
  if (typeof value !== "string" || !alternativeAssetKinds.has(value as AlternativeAssetKindApi)) {
    return jsonResponse(
      { code: 400, message: `${field} must be a valid alternative asset kind` },
      400,
    );
  }
  return value as AlternativeAssetKindApi;
}

function parseNewAsset(payload: Record<string, unknown>): NewAsset | Response {
  const kind = parseRequiredString(payload.kind, "kind");
  if (kind instanceof Response) {
    return kind;
  }
  const quoteMode = parseRequiredString(payload.quoteMode, "quoteMode");
  if (quoteMode instanceof Response) {
    return quoteMode;
  }
  const quoteCcy = parseRequiredString(payload.quoteCcy, "quoteCcy");
  if (quoteCcy instanceof Response) {
    return quoteCcy;
  }

  const parsed: NewAsset = { kind, quoteMode, quoteCcy };
  const stringFieldError = copyOptionalStringOrNullFields(payload, parsed, [
    "id",
    "name",
    "displayCode",
    "instrumentType",
    "instrumentSymbol",
    "instrumentExchangeMic",
    "notes",
  ]);
  if (stringFieldError) {
    return stringFieldError;
  }
  const booleanFieldError = copyOptionalBooleanFields(payload, parsed, ["isActive"]);
  if (booleanFieldError) {
    return booleanFieldError;
  }
  if (parsed.isActive === undefined) {
    parsed.isActive = true;
  }
  const providerConfig = parseOptionalRecordOrNull(payload.providerConfig, "providerConfig");
  if (providerConfig instanceof Response) {
    return providerConfig;
  }
  if (providerConfig !== undefined && providerConfig !== null) {
    parsed.providerConfig = providerConfig;
  }
  const metadata = parseOptionalRecordOrNull(payload.metadata, "metadata");
  if (metadata instanceof Response) {
    return metadata;
  }
  if (metadata !== undefined && metadata !== null) {
    parsed.metadata = metadata;
  }
  return parsed;
}

function parseUpdateAssetProfile(payload: Record<string, unknown>): UpdateAssetProfile | Response {
  const notes = parseRequiredString(payload.notes, "notes");
  if (notes instanceof Response) {
    return notes;
  }

  const parsed: UpdateAssetProfile = { notes };
  const stringFieldError = copyOptionalStringOrNullFields(payload, parsed, [
    "name",
    "displayCode",
    "kind",
    "quoteMode",
    "quoteCcy",
    "instrumentType",
    "instrumentSymbol",
    "instrumentExchangeMic",
  ]);
  if (stringFieldError) {
    return stringFieldError;
  }
  const providerConfig = parseOptionalRecordOrNull(payload.providerConfig, "providerConfig");
  if (providerConfig instanceof Response) {
    return providerConfig;
  }
  if (providerConfig !== undefined && providerConfig !== null) {
    parsed.providerConfig = providerConfig;
  }
  const metadata = parseOptionalRecordOrNull(payload.metadata, "metadata");
  if (metadata instanceof Response) {
    return metadata;
  }
  if (metadata !== undefined && metadata !== null) {
    parsed.metadata = metadata;
  }
  return parsed;
}

function parseQuoteModeBody(payload: Record<string, unknown>): { quoteMode: string } | Response {
  const value = payload.quoteMode ?? payload.pricingMode;
  const quoteMode = parseRequiredString(value, "quoteMode");
  if (quoteMode instanceof Response) {
    return quoteMode;
  }
  return { quoteMode };
}

function parseBackupToPathRequest(
  payload: Record<string, unknown>,
): { backupDir: string } | Response {
  const backupDir = parseRequiredString(payload.backupDir, "backupDir");
  if (backupDir instanceof Response) {
    return backupDir;
  }
  return { backupDir };
}

function parseRestoreDatabaseRequest(
  payload: Record<string, unknown>,
): { backupFilePath: string } | Response {
  const backupFilePath = parseRequiredString(payload.backupFilePath, "backupFilePath");
  if (backupFilePath instanceof Response) {
    return backupFilePath;
  }
  return { backupFilePath };
}

function parseAddonZipInstallRequest(
  payload: Record<string, unknown>,
): AddonZipInstallRequest | Response {
  const zipData = parseAddonZipData(payload);
  if (zipData instanceof Response) {
    return zipData;
  }
  const enableAfterInstall = parseOptionalBooleanOrNull(
    payload.enableAfterInstall,
    "enableAfterInstall",
  );
  if (enableAfterInstall instanceof Response) {
    return enableAfterInstall;
  }
  return { zipData, enableAfterInstall: enableAfterInstall ?? true };
}

function parseAddonZipExtractRequest(
  payload: Record<string, unknown>,
): AddonZipExtractRequest | Response {
  const zipData = parseAddonZipData(payload);
  if (zipData instanceof Response) {
    return zipData;
  }
  return { zipData };
}

function parseAddonZipData(payload: Record<string, unknown>): Uint8Array | Response {
  if (payload.zipDataB64 !== undefined && payload.zipDataB64 !== null) {
    const zipDataB64 = parseRequiredString(payload.zipDataB64, "zipDataB64");
    if (zipDataB64 instanceof Response) {
      return zipDataB64;
    }
    return decodeAddonZipDataB64(zipDataB64);
  }
  if (payload.zipData !== undefined && payload.zipData !== null) {
    if (
      !Array.isArray(payload.zipData) ||
      payload.zipData.some(
        (byte) => typeof byte !== "number" || !Number.isInteger(byte) || byte < 0 || byte > 255,
      )
    ) {
      return jsonResponse({ code: 400, message: "zipData must be an array of bytes" }, 400);
    }
    return new Uint8Array(payload.zipData);
  }
  return addonZipErrorResponse("Missing zip data");
}

function decodeAddonZipDataB64(value: string): Uint8Array | Response {
  if (!isStandardBase64(value)) {
    return addonZipErrorResponse("Invalid base64 zipDataB64");
  }
  return new Uint8Array(Buffer.from(value, "base64"));
}

function isStandardBase64(value: string): boolean {
  return (
    value.length % 4 === 0 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  );
}

function addonZipErrorResponse(message: string): Response {
  return jsonResponse({ code: 500, message }, 500);
}

function parseAddonToggleRequest(
  payload: Record<string, unknown>,
): { addonId: string; enabled: boolean } | Response {
  const addonId = parseRequiredString(payload.addonId, "addonId");
  if (addonId instanceof Response) {
    return addonId;
  }
  const enabled = parseRequiredBoolean(payload.enabled, "enabled");
  if (enabled instanceof Response) {
    return enabled;
  }
  return { addonId, enabled };
}

function parseAddonIdRequest(payload: Record<string, unknown>): { addonId: string } | Response {
  const addonId = parseRequiredString(payload.addonId, "addonId");
  if (addonId instanceof Response) {
    return addonId;
  }
  return { addonId };
}

function parseAddonRatingRequest(payload: Record<string, unknown>): AddonRatingRequest | Response {
  const addonId = parseRequiredString(payload.addonId, "addonId");
  if (addonId instanceof Response) {
    return addonId;
  }
  const rating = parseRequiredU8(payload.rating, "rating");
  if (rating instanceof Response) {
    return rating;
  }
  const review = parseOptionalStringOrNull(payload.review, "review");
  if (review instanceof Response) {
    return review;
  }
  const parsed: AddonRatingRequest = { addonId, rating };
  if (review !== undefined && review !== null) {
    parsed.review = review;
  }
  return parsed;
}

function parseAddonStagingInstallRequest(
  payload: Record<string, unknown>,
): AddonStagingInstallRequest | Response {
  const addonId = parseRequiredString(payload.addonId, "addonId");
  if (addonId instanceof Response) {
    return addonId;
  }
  const enableAfterInstall = parseOptionalBooleanOrNull(
    payload.enableAfterInstall,
    "enableAfterInstall",
  );
  if (enableAfterInstall instanceof Response) {
    return enableAfterInstall;
  }
  return { addonId, enableAfterInstall: enableAfterInstall ?? true };
}

function parseAccountsSimplePerformanceRequest(
  payload: Record<string, unknown>,
): { accountIds?: string[] } | Response {
  const accountIds = parseOptionalStringArrayOrNull(payload.accountIds, "accountIds");
  if (accountIds instanceof Response) {
    return accountIds;
  }
  return accountIds === undefined || accountIds === null ? {} : { accountIds };
}

function parsePerformanceRequest(payload: Record<string, unknown>): PerformanceRequest | Response {
  const itemType = parseRequiredString(payload.itemType, "itemType");
  if (itemType instanceof Response) {
    return itemType;
  }
  const itemId = parseRequiredString(payload.itemId, "itemId");
  if (itemId instanceof Response) {
    return itemId;
  }
  const startDate = parseOptionalDateBody(payload.startDate, "startDate");
  if (startDate instanceof Response) {
    return startDate;
  }
  const endDate = parseOptionalDateBody(payload.endDate, "endDate");
  if (endDate instanceof Response) {
    return endDate;
  }
  const trackingMode = parseOptionalPerformanceTrackingMode(payload.trackingMode);
  if (trackingMode instanceof Response) {
    return trackingMode;
  }

  const parsed: PerformanceRequest = { itemType, itemId };
  if (startDate !== undefined) {
    parsed.startDate = startDate;
  }
  if (endDate !== undefined) {
    parsed.endDate = endDate;
  }
  if (trackingMode !== undefined) {
    parsed.trackingMode = trackingMode;
  }
  return parsed;
}

function parseSnapshotsQuery(
  url: URL,
): { accountId: string; dateFrom?: string; dateTo?: string } | Response {
  const accountId = parseRequiredQueryString(url, "accountId");
  if (accountId instanceof Response) {
    return accountId;
  }
  const dateFrom = parseOptionalDateQuery(url, "dateFrom");
  if (dateFrom instanceof Response) {
    return dateFrom;
  }
  const dateTo = parseOptionalDateQuery(url, "dateTo");
  if (dateTo instanceof Response) {
    return dateTo;
  }
  const parsed: { accountId: string; dateFrom?: string; dateTo?: string } = { accountId };
  if (dateFrom !== undefined) {
    parsed.dateFrom = dateFrom;
  }
  if (dateTo !== undefined) {
    parsed.dateTo = dateTo;
  }
  return parsed;
}

function parseSaveManualHoldingsRequest(
  payload: Record<string, unknown>,
): SaveManualHoldingsRequest | Response {
  const accountId = parseRequiredString(payload.accountId, "accountId");
  if (accountId instanceof Response) {
    return accountId;
  }
  const holdings = parseHoldingInputArray(payload.holdings, "holdings");
  if (holdings instanceof Response) {
    return holdings;
  }
  const cashBalances = parseRequiredStringRecord(payload.cashBalances, "cashBalances");
  if (cashBalances instanceof Response) {
    return cashBalances;
  }
  const snapshotDate = parseOptionalDateBody(payload.snapshotDate, "snapshotDate");
  if (snapshotDate instanceof Response) {
    return snapshotDate;
  }

  const parsed: SaveManualHoldingsRequest = { accountId, holdings, cashBalances };
  if (snapshotDate !== undefined) {
    parsed.snapshotDate = snapshotDate;
  }
  return parsed;
}

function parseHoldingsImportRequest(
  payload: Record<string, unknown>,
): HoldingsImportRequest | Response {
  const accountId = parseRequiredString(payload.accountId, "accountId");
  if (accountId instanceof Response) {
    return accountId;
  }
  const snapshots = parseHoldingsSnapshotArray(payload.snapshots, "snapshots");
  if (snapshots instanceof Response) {
    return snapshots;
  }
  return { accountId, snapshots };
}

function parseSecretSetRequest(
  payload: Record<string, unknown>,
): { secretKey: string; secret: string } | Response {
  const secretKey = parseRequiredString(payload.secretKey, "secretKey");
  if (secretKey instanceof Response) {
    return secretKey;
  }
  const secret = parseRequiredString(payload.secret, "secret");
  if (secret instanceof Response) {
    return secret;
  }
  return { secretKey, secret };
}

function parsePortfolioRequestBody(
  payload: Record<string, unknown>,
): PortfolioRequestBody | Response {
  const accountIds = parseOptionalStringArrayOrNull(payload.accountIds, "accountIds");
  if (accountIds instanceof Response) {
    return accountIds;
  }
  const parsed: PortfolioRequestBody = {};
  if (accountIds !== undefined) {
    parsed.accountIds = accountIds;
  }
  if (payload.marketSyncMode !== undefined) {
    if (
      typeof payload.marketSyncMode !== "object" ||
      payload.marketSyncMode === null ||
      Array.isArray(payload.marketSyncMode)
    ) {
      return jsonResponse({ code: 400, message: "marketSyncMode must be an object" }, 400);
    }
    const marketSyncMode = parseMarketSyncMode(
      payload.marketSyncMode as Record<string, unknown>,
      "marketSyncMode",
    );
    if (marketSyncMode instanceof Response) {
      return marketSyncMode;
    }
    parsed.marketSyncMode = marketSyncMode;
  }
  return parsed;
}

function parseMarketSyncMode(
  payload: Record<string, unknown>,
  field: string,
): MarketSyncMode | Response {
  const type = parseRequiredString(payload.type, `${field}.type`);
  if (type instanceof Response) {
    return type;
  }
  switch (type) {
    case "none":
      return { type };
    case "incremental": {
      const assetIds = parseOptionalStringArrayOrNull(payload.asset_ids, `${field}.asset_ids`);
      if (assetIds instanceof Response) {
        return assetIds;
      }
      return { type, asset_ids: assetIds ?? null };
    }
    case "refetch_recent":
    case "backfill_history": {
      const assetIds = parseOptionalStringArrayOrNull(payload.asset_ids, `${field}.asset_ids`);
      if (assetIds instanceof Response) {
        return assetIds;
      }
      const days = parseRequiredInteger(payload.days, `${field}.days`);
      if (days instanceof Response) {
        return days;
      }
      return { type, asset_ids: assetIds ?? null, days };
    }
    default:
      return jsonResponse({ code: 400, message: `${field}.type is not supported` }, 400);
  }
}

function parseSettingsUpdate(payload: Record<string, unknown>): SettingsUpdate | Response {
  const update: SettingsUpdate = {};
  const stringFields = ["theme", "font", "baseCurrency", "timezone"] as const;
  const booleanFields = [
    "onboardingCompleted",
    "autoUpdateCheckEnabled",
    "menuBarVisible",
    "syncEnabled",
  ] as const;

  for (const field of stringFields) {
    const value = payload[field];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== "string") {
      return jsonResponse({ code: 400, message: `${field} must be a string` }, 400);
    }
    update[field] = value;
  }

  for (const field of booleanFields) {
    const value = payload[field];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== "boolean") {
      return jsonResponse({ code: 400, message: `${field} must be a boolean` }, 400);
    }
    update[field] = value;
  }

  return update;
}

function parseNewExchangeRate(payload: Record<string, unknown>): NewExchangeRate | Response {
  const fromCurrency = parseRequiredString(payload.fromCurrency, "fromCurrency");
  if (fromCurrency instanceof Response) {
    return fromCurrency;
  }
  const toCurrency = parseRequiredString(payload.toCurrency, "toCurrency");
  if (toCurrency instanceof Response) {
    return toCurrency;
  }
  const rate = parseRequiredString(payload.rate, "rate");
  if (rate instanceof Response) {
    return rate;
  }
  const source = parseRequiredString(payload.source, "source");
  if (source instanceof Response) {
    return source;
  }
  return {
    fromCurrency,
    toCurrency,
    rate,
    source,
  };
}

function parseExchangeRate(payload: Record<string, unknown>): ExchangeRate | Response {
  const id = parseRequiredString(payload.id, "id");
  if (id instanceof Response) {
    return id;
  }
  const newRate = parseNewExchangeRate(payload);
  if (newRate instanceof Response) {
    return newRate;
  }
  const timestamp = parseRequiredString(payload.timestamp, "timestamp");
  if (timestamp instanceof Response) {
    return timestamp;
  }
  return {
    id,
    ...newRate,
    timestamp,
  };
}

function parseNewGoal(payload: Record<string, unknown>): NewGoal | Response {
  const goalType = parseRequiredString(payload.goalType, "goalType");
  if (goalType instanceof Response) {
    return goalType;
  }
  const title = parseRequiredString(payload.title, "title");
  if (title instanceof Response) {
    return title;
  }
  const optionals = parseGoalOptionals(payload);
  if (optionals instanceof Response) {
    return optionals;
  }
  return {
    id: optionals.id,
    goalType,
    title,
    description: optionals.description,
    targetAmount: optionals.targetAmount,
    statusLifecycle: optionals.statusLifecycle,
    statusHealth: optionals.statusHealth,
    priority: optionals.priority,
    coverImageKey: optionals.coverImageKey,
    currency: optionals.currency,
    startDate: optionals.startDate,
    targetDate: optionals.targetDate,
    createdAt: optionals.createdAt,
    updatedAt: optionals.updatedAt,
  };
}

function parseGoal(payload: Record<string, unknown>): Goal | Response {
  const goalType = parseRequiredString(payload.goalType, "goalType");
  if (goalType instanceof Response) {
    return goalType;
  }
  const title = parseRequiredString(payload.title, "title");
  if (title instanceof Response) {
    return title;
  }
  const optionals = parseGoalOptionals(payload);
  if (optionals instanceof Response) {
    return optionals;
  }
  const id = parseRequiredString(payload.id, "id");
  if (id instanceof Response) {
    return id;
  }
  const statusLifecycle = parseRequiredString(payload.statusLifecycle, "statusLifecycle");
  if (statusLifecycle instanceof Response) {
    return statusLifecycle;
  }
  const statusHealth = parseRequiredString(payload.statusHealth, "statusHealth");
  if (statusHealth instanceof Response) {
    return statusHealth;
  }
  const priority = parseRequiredInteger(payload.priority, "priority");
  if (priority instanceof Response) {
    return priority;
  }
  const createdAt = parseRequiredString(payload.createdAt, "createdAt");
  if (createdAt instanceof Response) {
    return createdAt;
  }
  const updatedAt = parseRequiredString(payload.updatedAt, "updatedAt");
  if (updatedAt instanceof Response) {
    return updatedAt;
  }

  return {
    id,
    goalType,
    title,
    description: optionals.description ?? null,
    targetAmount: optionals.targetAmount ?? null,
    statusLifecycle,
    statusHealth,
    priority,
    coverImageKey: optionals.coverImageKey ?? null,
    currency: optionals.currency ?? null,
    startDate: optionals.startDate ?? null,
    targetDate: optionals.targetDate ?? null,
    summaryCurrentValue: optionals.summaryCurrentValue ?? null,
    summaryProgress: optionals.summaryProgress ?? null,
    projectedCompletionDate: optionals.projectedCompletionDate ?? null,
    projectedValueAtTargetDate: optionals.projectedValueAtTargetDate ?? null,
    createdAt,
    updatedAt,
    summaryTargetAmount: optionals.summaryTargetAmount ?? null,
  };
}

function parseGoalOptionals(payload: Record<string, unknown>):
  | {
      id?: string | null;
      description?: string | null;
      targetAmount?: number | null;
      statusLifecycle?: string | null;
      statusHealth?: string | null;
      priority?: number | null;
      coverImageKey?: string | null;
      currency?: string | null;
      startDate?: string | null;
      targetDate?: string | null;
      createdAt?: string | null;
      updatedAt?: string | null;
      summaryCurrentValue?: number | null;
      summaryProgress?: number | null;
      projectedCompletionDate?: string | null;
      projectedValueAtTargetDate?: number | null;
      summaryTargetAmount?: number | null;
    }
  | Response {
  const id = parseOptionalStringOrNull(payload.id, "id");
  if (id instanceof Response) {
    return id;
  }
  const description = parseOptionalStringOrNull(payload.description, "description");
  if (description instanceof Response) {
    return description;
  }
  const targetAmount = parseOptionalNumberOrNull(payload.targetAmount, "targetAmount");
  if (targetAmount instanceof Response) {
    return targetAmount;
  }
  const statusLifecycle = parseOptionalStringOrNull(payload.statusLifecycle, "statusLifecycle");
  if (statusLifecycle instanceof Response) {
    return statusLifecycle;
  }
  const statusHealth = parseOptionalStringOrNull(payload.statusHealth, "statusHealth");
  if (statusHealth instanceof Response) {
    return statusHealth;
  }
  const priority = parseOptionalIntegerOrNull(payload.priority, "priority");
  if (priority instanceof Response) {
    return priority;
  }
  const coverImageKey = parseOptionalStringOrNull(payload.coverImageKey, "coverImageKey");
  if (coverImageKey instanceof Response) {
    return coverImageKey;
  }
  const currency = parseOptionalStringOrNull(payload.currency, "currency");
  if (currency instanceof Response) {
    return currency;
  }
  const startDate = parseOptionalStringOrNull(payload.startDate, "startDate");
  if (startDate instanceof Response) {
    return startDate;
  }
  const targetDate = parseOptionalStringOrNull(payload.targetDate, "targetDate");
  if (targetDate instanceof Response) {
    return targetDate;
  }
  const createdAt = parseOptionalStringOrNull(payload.createdAt, "createdAt");
  if (createdAt instanceof Response) {
    return createdAt;
  }
  const updatedAt = parseOptionalStringOrNull(payload.updatedAt, "updatedAt");
  if (updatedAt instanceof Response) {
    return updatedAt;
  }
  const summaryCurrentValue = parseOptionalNumberOrNull(
    payload.summaryCurrentValue,
    "summaryCurrentValue",
  );
  if (summaryCurrentValue instanceof Response) {
    return summaryCurrentValue;
  }
  const summaryProgress = parseOptionalNumberOrNull(payload.summaryProgress, "summaryProgress");
  if (summaryProgress instanceof Response) {
    return summaryProgress;
  }
  const projectedCompletionDate = parseOptionalStringOrNull(
    payload.projectedCompletionDate,
    "projectedCompletionDate",
  );
  if (projectedCompletionDate instanceof Response) {
    return projectedCompletionDate;
  }
  const projectedValueAtTargetDate = parseOptionalNumberOrNull(
    payload.projectedValueAtTargetDate,
    "projectedValueAtTargetDate",
  );
  if (projectedValueAtTargetDate instanceof Response) {
    return projectedValueAtTargetDate;
  }
  const summaryTargetAmount = parseOptionalNumberOrNull(
    payload.summaryTargetAmount,
    "summaryTargetAmount",
  );
  if (summaryTargetAmount instanceof Response) {
    return summaryTargetAmount;
  }

  return {
    id,
    description,
    targetAmount,
    statusLifecycle,
    statusHealth,
    priority,
    coverImageKey,
    currency,
    startDate,
    targetDate,
    createdAt,
    updatedAt,
    summaryCurrentValue,
    summaryProgress,
    projectedCompletionDate,
    projectedValueAtTargetDate,
    summaryTargetAmount,
  };
}

function parseGoalFundingRuleInput(
  payload: Record<string, unknown>,
  index: number,
): GoalFundingRuleInput | Response {
  const accountId = parseRequiredString(payload.accountId, `body[${index}].accountId`);
  if (accountId instanceof Response) {
    return accountId;
  }
  const sharePercent = parseRequiredNumber(payload.sharePercent, `body[${index}].sharePercent`);
  if (sharePercent instanceof Response) {
    return sharePercent;
  }
  const taxBucket = parseOptionalStringOrNull(payload.taxBucket, `body[${index}].taxBucket`);
  if (taxBucket instanceof Response) {
    return taxBucket;
  }
  return {
    accountId,
    sharePercent,
    taxBucket,
  };
}

function forceGoalCurrency<TGoal extends NewGoal | Goal>(
  goal: TGoal,
  goalService: GoalService,
): TGoal {
  const baseCurrency = goalService.getBaseCurrency();
  if (!baseCurrency) {
    return goal;
  }
  return { ...goal, currency: baseCurrency };
}

function parseNewCustomProvider(payload: Record<string, unknown>): NewCustomProvider | Response {
  const code = parseRequiredString(payload.code, "code");
  if (code instanceof Response) {
    return code;
  }
  const name = parseRequiredString(payload.name, "name");
  if (name instanceof Response) {
    return name;
  }
  const description = parseOptionalStringOrNull(payload.description, "description");
  if (description instanceof Response) {
    return description;
  }
  const priority = parseOptionalNumberOrNull(payload.priority, "priority");
  if (priority instanceof Response) {
    return priority;
  }
  const sources = parseNewCustomProviderSources(payload.sources, "sources", true);
  if (sources instanceof Response) {
    return sources;
  }
  if (!sources) {
    return jsonResponse({ code: 400, message: "sources must be an array" }, 400);
  }

  return {
    code,
    name,
    description,
    priority,
    sources,
  };
}

function parseUpdateCustomProvider(
  payload: Record<string, unknown>,
): UpdateCustomProvider | Response {
  const name = parseOptionalStringOrNull(payload.name, "name");
  if (name instanceof Response) {
    return name;
  }
  const description = parseOptionalStringOrNull(payload.description, "description");
  if (description instanceof Response) {
    return description;
  }
  const enabled = parseOptionalBooleanOrNull(payload.enabled, "enabled");
  if (enabled instanceof Response) {
    return enabled;
  }
  const priority = parseOptionalNumberOrNull(payload.priority, "priority");
  if (priority instanceof Response) {
    return priority;
  }
  const sources = parseNewCustomProviderSources(payload.sources, "sources", false);
  if (sources instanceof Response) {
    return sources;
  }

  return {
    name,
    description,
    enabled,
    priority,
    sources,
  };
}

function parseNewCustomProviderSources(
  value: unknown,
  field: string,
  required: boolean,
): NewCustomProviderSource[] | null | undefined | Response {
  if (value === undefined) {
    if (required) {
      return jsonResponse({ code: 400, message: `${field} must be an array` }, 400);
    }
    return undefined;
  }
  if (value === null && !required) {
    return null;
  }
  if (!Array.isArray(value)) {
    return jsonResponse({ code: 400, message: `${field} must be an array` }, 400);
  }
  const sources: NewCustomProviderSource[] = [];
  for (const [index, source] of value.entries()) {
    if (typeof source !== "object" || source === null || Array.isArray(source)) {
      return jsonResponse({ code: 400, message: `${field}[${index}] must be an object` }, 400);
    }
    const parsed = parseNewCustomProviderSource(
      source as Record<string, unknown>,
      `${field}[${index}]`,
    );
    if (parsed instanceof Response) {
      return parsed;
    }
    sources.push(parsed);
  }
  return sources;
}

function parseNewCustomProviderSource(
  payload: Record<string, unknown>,
  field: string,
): NewCustomProviderSource | Response {
  const kind = parseRequiredString(payload.kind, `${field}.kind`);
  if (kind instanceof Response) {
    return kind;
  }
  const format = parseRequiredString(payload.format, `${field}.format`);
  if (format instanceof Response) {
    return format;
  }
  const url = parseRequiredString(payload.url, `${field}.url`);
  if (url instanceof Response) {
    return url;
  }
  const pricePath = parseRequiredString(payload.pricePath, `${field}.pricePath`);
  if (pricePath instanceof Response) {
    return pricePath;
  }
  const datePath = parseOptionalStringOrNull(payload.datePath, `${field}.datePath`);
  if (datePath instanceof Response) {
    return datePath;
  }
  const dateFormat = parseOptionalStringOrNull(payload.dateFormat, `${field}.dateFormat`);
  if (dateFormat instanceof Response) {
    return dateFormat;
  }
  const currencyPath = parseOptionalStringOrNull(payload.currencyPath, `${field}.currencyPath`);
  if (currencyPath instanceof Response) {
    return currencyPath;
  }
  const factor = parseOptionalNumberOrNull(payload.factor, `${field}.factor`);
  if (factor instanceof Response) {
    return factor;
  }
  const invert = parseOptionalBooleanOrNull(payload.invert, `${field}.invert`);
  if (invert instanceof Response) {
    return invert;
  }
  const locale = parseOptionalStringOrNull(payload.locale, `${field}.locale`);
  if (locale instanceof Response) {
    return locale;
  }
  const headers = parseOptionalStringOrNull(payload.headers, `${field}.headers`);
  if (headers instanceof Response) {
    return headers;
  }
  const openPath = parseOptionalStringOrNull(payload.openPath, `${field}.openPath`);
  if (openPath instanceof Response) {
    return openPath;
  }
  const highPath = parseOptionalStringOrNull(payload.highPath, `${field}.highPath`);
  if (highPath instanceof Response) {
    return highPath;
  }
  const lowPath = parseOptionalStringOrNull(payload.lowPath, `${field}.lowPath`);
  if (lowPath instanceof Response) {
    return lowPath;
  }
  const volumePath = parseOptionalStringOrNull(payload.volumePath, `${field}.volumePath`);
  if (volumePath instanceof Response) {
    return volumePath;
  }
  const defaultPrice = parseOptionalNumberOrNull(payload.defaultPrice, `${field}.defaultPrice`);
  if (defaultPrice instanceof Response) {
    return defaultPrice;
  }
  const dateTimezone = parseOptionalStringOrNull(payload.dateTimezone, `${field}.dateTimezone`);
  if (dateTimezone instanceof Response) {
    return dateTimezone;
  }

  return {
    kind: kind as NewCustomProviderSource["kind"],
    format: format as NewCustomProviderSource["format"],
    url,
    pricePath,
    datePath,
    dateFormat,
    currencyPath,
    factor,
    invert,
    locale,
    headers,
    openPath,
    highPath,
    lowPath,
    volumePath,
    defaultPrice,
    dateTimezone,
  };
}

function parseNewTaxonomy(payload: Record<string, unknown>): NewTaxonomy | Response {
  const id = parseOptionalStringOrNull(payload.id, "id");
  if (id instanceof Response) {
    return id;
  }
  const name = parseRequiredString(payload.name, "name");
  if (name instanceof Response) {
    return name;
  }
  const color = parseRequiredString(payload.color, "color");
  if (color instanceof Response) {
    return color;
  }
  const description = parseOptionalStringOrNull(payload.description, "description");
  if (description instanceof Response) {
    return description;
  }
  const isSystem = parseRequiredBoolean(payload.isSystem, "isSystem");
  if (isSystem instanceof Response) {
    return isSystem;
  }
  const isSingleSelect = parseRequiredBoolean(payload.isSingleSelect, "isSingleSelect");
  if (isSingleSelect instanceof Response) {
    return isSingleSelect;
  }
  const sortOrder = parseRequiredInteger(payload.sortOrder, "sortOrder");
  if (sortOrder instanceof Response) {
    return sortOrder;
  }

  return {
    id,
    name,
    color,
    description,
    isSystem,
    isSingleSelect,
    sortOrder,
  };
}

function parseTaxonomy(payload: Record<string, unknown>): Taxonomy | Response {
  const taxonomy = parseNewTaxonomy(payload);
  if (taxonomy instanceof Response) {
    return taxonomy;
  }
  const id = parseRequiredString(payload.id, "id");
  if (id instanceof Response) {
    return id;
  }
  const createdAt = parseRequiredString(payload.createdAt, "createdAt");
  if (createdAt instanceof Response) {
    return createdAt;
  }
  const updatedAt = parseRequiredString(payload.updatedAt, "updatedAt");
  if (updatedAt instanceof Response) {
    return updatedAt;
  }
  return {
    ...taxonomy,
    id,
    description: taxonomy.description ?? null,
    createdAt,
    updatedAt,
  };
}

function parseNewTaxonomyCategory(
  payload: Record<string, unknown>,
): NewTaxonomyCategory | Response {
  const id = parseOptionalStringOrNull(payload.id, "id");
  if (id instanceof Response) {
    return id;
  }
  const taxonomyId = parseRequiredString(payload.taxonomyId, "taxonomyId");
  if (taxonomyId instanceof Response) {
    return taxonomyId;
  }
  const parentId = parseOptionalStringOrNull(payload.parentId, "parentId");
  if (parentId instanceof Response) {
    return parentId;
  }
  const name = parseRequiredString(payload.name, "name");
  if (name instanceof Response) {
    return name;
  }
  const key = parseRequiredString(payload.key, "key");
  if (key instanceof Response) {
    return key;
  }
  const color = parseRequiredString(payload.color, "color");
  if (color instanceof Response) {
    return color;
  }
  const description = parseOptionalStringOrNull(payload.description, "description");
  if (description instanceof Response) {
    return description;
  }
  const sortOrder = parseRequiredInteger(payload.sortOrder, "sortOrder");
  if (sortOrder instanceof Response) {
    return sortOrder;
  }

  return {
    id,
    taxonomyId,
    parentId,
    name,
    key,
    color,
    description,
    sortOrder,
  };
}

function parseTaxonomyCategory(payload: Record<string, unknown>): TaxonomyCategory | Response {
  const category = parseNewTaxonomyCategory(payload);
  if (category instanceof Response) {
    return category;
  }
  const id = parseRequiredString(payload.id, "id");
  if (id instanceof Response) {
    return id;
  }
  const createdAt = parseRequiredString(payload.createdAt, "createdAt");
  if (createdAt instanceof Response) {
    return createdAt;
  }
  const updatedAt = parseRequiredString(payload.updatedAt, "updatedAt");
  if (updatedAt instanceof Response) {
    return updatedAt;
  }
  return {
    ...category,
    id,
    parentId: category.parentId ?? null,
    description: category.description ?? null,
    createdAt,
    updatedAt,
  };
}

function parseMoveCategoryRequest(payload: Record<string, unknown>):
  | {
      taxonomyId: string;
      categoryId: string;
      newParentId: string | null;
      position: number;
    }
  | Response {
  const taxonomyId = parseRequiredString(payload.taxonomyId, "taxonomyId");
  if (taxonomyId instanceof Response) {
    return taxonomyId;
  }
  const categoryId = parseRequiredString(payload.categoryId, "categoryId");
  if (categoryId instanceof Response) {
    return categoryId;
  }
  const newParentId = parseOptionalStringOrNull(payload.newParentId, "newParentId");
  if (newParentId instanceof Response) {
    return newParentId;
  }
  const position = parseRequiredInteger(payload.position, "position");
  if (position instanceof Response) {
    return position;
  }
  return {
    taxonomyId,
    categoryId,
    newParentId: newParentId ?? null,
    position,
  };
}

function parseNewAssetTaxonomyAssignment(
  payload: Record<string, unknown>,
): NewAssetTaxonomyAssignment | Response {
  const id = parseOptionalStringOrNull(payload.id, "id");
  if (id instanceof Response) {
    return id;
  }
  const assetId = parseRequiredString(payload.assetId, "assetId");
  if (assetId instanceof Response) {
    return assetId;
  }
  const taxonomyId = parseRequiredString(payload.taxonomyId, "taxonomyId");
  if (taxonomyId instanceof Response) {
    return taxonomyId;
  }
  const categoryId = parseRequiredString(payload.categoryId, "categoryId");
  if (categoryId instanceof Response) {
    return categoryId;
  }
  const weight = parseRequiredInteger(payload.weight, "weight");
  if (weight instanceof Response) {
    return weight;
  }
  const source = parseRequiredString(payload.source, "source");
  if (source instanceof Response) {
    return source;
  }
  return {
    id,
    assetId,
    taxonomyId,
    categoryId,
    weight,
    source,
  };
}

function parseImportTaxonomyRequest(payload: Record<string, unknown>):
  | {
      jsonStr: string;
    }
  | Response {
  const jsonStr = parseRequiredString(payload.jsonStr, "jsonStr");
  if (jsonStr instanceof Response) {
    return jsonStr;
  }
  return { jsonStr };
}

function parseNewContributionLimit(
  payload: Record<string, unknown>,
): NewContributionLimit | Response {
  const id = parseOptionalString(payload.id, "id");
  if (id instanceof Response) {
    return id;
  }
  const groupName = payload.groupName;
  if (typeof groupName !== "string") {
    return jsonResponse({ code: 400, message: "groupName must be a string" }, 400);
  }
  const contributionYear = payload.contributionYear;
  if (typeof contributionYear !== "number" || !Number.isInteger(contributionYear)) {
    return jsonResponse({ code: 400, message: "contributionYear must be an integer" }, 400);
  }
  const limitAmount = payload.limitAmount;
  if (typeof limitAmount !== "number" || !Number.isFinite(limitAmount)) {
    return jsonResponse({ code: 400, message: "limitAmount must be a finite number" }, 400);
  }
  const accountIds = parseOptionalStringOrNull(payload.accountIds, "accountIds");
  if (accountIds instanceof Response) {
    return accountIds;
  }
  const startDate = parseOptionalStringOrNull(payload.startDate, "startDate");
  if (startDate instanceof Response) {
    return startDate;
  }
  const endDate = parseOptionalStringOrNull(payload.endDate, "endDate");
  if (endDate instanceof Response) {
    return endDate;
  }

  return {
    id,
    groupName,
    contributionYear,
    limitAmount,
    accountIds,
    startDate,
    endDate,
  };
}

function parseNewAccount(payload: Record<string, unknown>): NewAccount | Response {
  const name = payload.name;
  const accountType = payload.accountType;
  const currency = payload.currency;
  const isDefault = payload.isDefault;
  const isActive = payload.isActive;
  if (typeof name !== "string") {
    return jsonResponse({ code: 400, message: "name must be a string" }, 400);
  }
  if (typeof accountType !== "string") {
    return jsonResponse({ code: 400, message: "accountType must be a string" }, 400);
  }
  if (typeof currency !== "string") {
    return jsonResponse({ code: 400, message: "currency must be a string" }, 400);
  }
  if (typeof isDefault !== "boolean") {
    return jsonResponse({ code: 400, message: "isDefault must be a boolean" }, 400);
  }
  if (typeof isActive !== "boolean") {
    return jsonResponse({ code: 400, message: "isActive must be a boolean" }, 400);
  }
  const optionals = parseAccountOptionals(payload);
  if (optionals instanceof Response) {
    return optionals;
  }
  const id = parseOptionalString(payload.id, "id");
  if (id instanceof Response) {
    return id;
  }
  const isArchived = parseOptionalBoolean(payload.isArchived, "isArchived");
  if (isArchived instanceof Response) {
    return isArchived;
  }
  const trackingMode = parseOptionalTrackingMode(payload.trackingMode);
  if (trackingMode instanceof Response) {
    return trackingMode;
  }

  return {
    id,
    name,
    accountType,
    group: optionals.group,
    currency,
    isDefault,
    isActive,
    isArchived,
    trackingMode,
    platformId: optionals.platformId,
    accountNumber: optionals.accountNumber,
    meta: optionals.meta,
    provider: optionals.provider,
    providerAccountId: optionals.providerAccountId,
  };
}

function parseAccountUpdate(
  payload: Record<string, unknown>,
  accountId: string,
): AccountUpdate | Response {
  const name = payload.name;
  const accountType = payload.accountType;
  const isDefault = payload.isDefault;
  const isActive = payload.isActive;
  if (typeof name !== "string") {
    return jsonResponse({ code: 400, message: "name must be a string" }, 400);
  }
  if (typeof accountType !== "string") {
    return jsonResponse({ code: 400, message: "accountType must be a string" }, 400);
  }
  if (typeof isDefault !== "boolean") {
    return jsonResponse({ code: 400, message: "isDefault must be a boolean" }, 400);
  }
  if (typeof isActive !== "boolean") {
    return jsonResponse({ code: 400, message: "isActive must be a boolean" }, 400);
  }
  const optionals = parseAccountOptionals(payload);
  if (optionals instanceof Response) {
    return optionals;
  }
  const isArchived = parseOptionalBoolean(payload.isArchived, "isArchived");
  if (isArchived instanceof Response) {
    return isArchived;
  }
  const trackingMode = parseOptionalTrackingMode(payload.trackingMode);
  if (trackingMode instanceof Response) {
    return trackingMode;
  }

  return {
    id: accountId,
    name,
    accountType,
    group: optionals.group,
    isDefault,
    isActive,
    isArchived,
    trackingMode,
    platformId: optionals.platformId,
    accountNumber: optionals.accountNumber,
    meta: optionals.meta,
    provider: optionals.provider,
    providerAccountId: optionals.providerAccountId,
  };
}

function parseAccountOptionals(payload: Record<string, unknown>):
  | {
      group?: string | null;
      platformId?: string | null;
      accountNumber?: string | null;
      meta?: string | null;
      provider?: string | null;
      providerAccountId?: string | null;
    }
  | Response {
  const stringOrNullFields = [
    "group",
    "platformId",
    "accountNumber",
    "meta",
    "provider",
    "providerAccountId",
  ] as const;
  const parsed: {
    group?: string | null;
    platformId?: string | null;
    accountNumber?: string | null;
    meta?: string | null;
    provider?: string | null;
    providerAccountId?: string | null;
  } = {};

  for (const field of stringOrNullFields) {
    const value = payload[field];
    if (value === undefined) {
      continue;
    }
    if (value !== null && typeof value !== "string") {
      return jsonResponse({ code: 400, message: `${field} must be a string or null` }, 400);
    }
    parsed[field] = value;
  }
  return parsed;
}

function parseOptionalString(value: unknown, field: string): string | undefined | Response {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    return jsonResponse({ code: 400, message: `${field} must be a string` }, 400);
  }
  return value;
}

function parseRequiredQueryString(url: URL, field: string): string | Response {
  const value = url.searchParams.get(field);
  if (value === null) {
    return jsonResponse({ code: 400, message: `${field} must be a string` }, 400);
  }
  return value;
}

function parseRepeatedQueryStrings(url: URL, fields: string[]): string[] | undefined {
  const acceptedFields = new Set(fields);
  const values: string[] = [];
  for (const [field, value] of url.searchParams) {
    if (acceptedFields.has(field)) {
      values.push(value);
    }
  }
  return values.length === 0 ? undefined : values;
}

function parseRequiredDateQuery(url: URL, field: string): string | Response {
  const value = parseRequiredQueryString(url, field);
  if (value instanceof Response) {
    return value;
  }
  return parseIsoDate(value, field);
}

function parseOptionalDateQuery(url: URL, field: string): string | undefined | Response {
  const value = url.searchParams.get(field);
  if (value === null) {
    return undefined;
  }
  return parseIsoDate(value, field);
}

function parseRequiredString(value: unknown, field: string): string | Response {
  if (typeof value !== "string") {
    return jsonResponse({ code: 400, message: `${field} must be a string` }, 400);
  }
  return value;
}

function parseOptionalStringOrNull(
  value: unknown,
  field: string,
): string | null | undefined | Response {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return jsonResponse({ code: 400, message: `${field} must be a string or null` }, 400);
  }
  return value;
}

function parseOptionalDateBody(value: unknown, field: string): string | undefined | Response {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    return jsonResponse({ code: 400, message: `${field} must be a string` }, 400);
  }
  return parseIsoDate(value, field);
}

function parseIsoDate(value: string, field: string): string | Response {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return jsonResponse({ code: 400, message: `${field} must be a YYYY-MM-DD date` }, 400);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return jsonResponse({ code: 400, message: `${field} must be a valid date` }, 400);
  }
  return value;
}

function parseHoldingInputArray(
  value: unknown,
  field: string,
): SaveManualHoldingsRequest["holdings"] | Response {
  if (!Array.isArray(value)) {
    return jsonResponse({ code: 400, message: `${field} must be an array` }, 400);
  }
  const parsed: SaveManualHoldingsRequest["holdings"] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return jsonResponse({ code: 400, message: `${field}[${index}] must be an object` }, 400);
    }
    const holding = parseHoldingInput(item as Record<string, unknown>, `${field}[${index}]`);
    if (holding instanceof Response) {
      return holding;
    }
    parsed.push(holding);
  }
  return parsed;
}

function parseHoldingInput(
  payload: Record<string, unknown>,
  field: string,
): SaveManualHoldingsRequest["holdings"][number] | Response {
  const symbol = parseRequiredString(payload.symbol, `${field}.symbol`);
  if (symbol instanceof Response) {
    return symbol;
  }
  const quantity = parseRequiredString(payload.quantity, `${field}.quantity`);
  if (quantity instanceof Response) {
    return quantity;
  }
  const currency = parseRequiredString(payload.currency, `${field}.currency`);
  if (currency instanceof Response) {
    return currency;
  }

  const parsed: SaveManualHoldingsRequest["holdings"][number] = { symbol, quantity, currency };
  const optionalFields = copyManualHoldingOptionalStrings(payload, parsed, field);
  if (optionalFields instanceof Response) {
    return optionalFields;
  }
  return parsed;
}

function parseHoldingsSnapshotArray(
  value: unknown,
  field: string,
): HoldingsSnapshotInput[] | Response {
  if (!Array.isArray(value)) {
    return jsonResponse({ code: 400, message: `${field} must be an array` }, 400);
  }
  const parsed: HoldingsSnapshotInput[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return jsonResponse({ code: 400, message: `${field}[${index}] must be an object` }, 400);
    }
    const snapshot = parseHoldingsSnapshot(item as Record<string, unknown>, `${field}[${index}]`);
    if (snapshot instanceof Response) {
      return snapshot;
    }
    parsed.push(snapshot);
  }
  return parsed;
}

function parseHoldingsSnapshot(
  payload: Record<string, unknown>,
  field: string,
): HoldingsSnapshotInput | Response {
  const date = parseRequiredString(payload.date, `${field}.date`);
  if (date instanceof Response) {
    return date;
  }
  const positions = parseHoldingsPositionArray(payload.positions, `${field}.positions`);
  if (positions instanceof Response) {
    return positions;
  }
  const cashBalances = parseRequiredStringRecord(payload.cashBalances, `${field}.cashBalances`);
  if (cashBalances instanceof Response) {
    return cashBalances;
  }
  return { date, positions, cashBalances };
}

function parseHoldingsPositionArray(
  value: unknown,
  field: string,
): HoldingsSnapshotInput["positions"] | Response {
  if (!Array.isArray(value)) {
    return jsonResponse({ code: 400, message: `${field} must be an array` }, 400);
  }
  const parsed: HoldingsSnapshotInput["positions"] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return jsonResponse({ code: 400, message: `${field}[${index}] must be an object` }, 400);
    }
    const position = parseHoldingsPosition(item as Record<string, unknown>, `${field}[${index}]`);
    if (position instanceof Response) {
      return position;
    }
    parsed.push(position);
  }
  return parsed;
}

function parseHoldingsPosition(
  payload: Record<string, unknown>,
  field: string,
): HoldingsSnapshotInput["positions"][number] | Response {
  const symbol = parseRequiredString(payload.symbol, `${field}.symbol`);
  if (symbol instanceof Response) {
    return symbol;
  }
  const quantity = parseRequiredString(payload.quantity, `${field}.quantity`);
  if (quantity instanceof Response) {
    return quantity;
  }
  const currency = parseRequiredString(payload.currency, `${field}.currency`);
  if (currency instanceof Response) {
    return currency;
  }

  const parsed: HoldingsSnapshotInput["positions"][number] = { symbol, quantity, currency };
  const optionalFields = copyHoldingsPositionOptionalStrings(payload, parsed, field);
  if (optionalFields instanceof Response) {
    return optionalFields;
  }
  return parsed;
}

function copyManualHoldingOptionalStrings(
  source: Record<string, unknown>,
  target: SaveManualHoldingsRequest["holdings"][number],
  field: string,
): Response | undefined {
  const optionalFields = [
    "assetId",
    "averageCost",
    "exchangeMic",
    "name",
    "dataSource",
    "assetKind",
  ] as const;
  for (const optionalField of optionalFields) {
    const value = parseOptionalStringOrNull(source[optionalField], `${field}.${optionalField}`);
    if (value instanceof Response) {
      return value;
    }
    if (value !== undefined && value !== null) {
      target[optionalField] = value;
    }
  }
  return undefined;
}

function copyHoldingsPositionOptionalStrings(
  source: Record<string, unknown>,
  target: HoldingsSnapshotInput["positions"][number],
  field: string,
): Response | undefined {
  const optionalFields = ["assetId", "avgCost", "exchangeMic"] as const;
  for (const optionalField of optionalFields) {
    const value = parseOptionalStringOrNull(source[optionalField], `${field}.${optionalField}`);
    if (value instanceof Response) {
      return value;
    }
    if (value !== undefined && value !== null) {
      target[optionalField] = value;
    }
  }
  return undefined;
}

function parseOptionalRecordOrNull(
  value: unknown,
  field: string,
): Record<string, unknown> | null | undefined | Response {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return jsonResponse({ code: 400, message: `${field} must be an object or null` }, 400);
  }
  return value as Record<string, unknown>;
}

function parseRequiredStringRecord(
  value: unknown,
  field: string,
): Record<string, string> | Response {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.values(value).some((item) => typeof item !== "string")
  ) {
    return jsonResponse({ code: 400, message: `${field} must be an object of strings` }, 400);
  }
  return value as Record<string, string>;
}

function copyOptionalStringOrNullFields(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  fields: string[],
): Response | undefined {
  for (const field of fields) {
    const value = parseOptionalStringOrNull(source[field], field);
    if (value instanceof Response) {
      return value;
    }
    if (value !== undefined && value !== null) {
      target[field] = value;
    }
  }
  return undefined;
}

function copyOptionalBooleanFields(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  fields: string[],
): Response | undefined {
  for (const field of fields) {
    const value = parseOptionalBoolean(source[field], field);
    if (value instanceof Response) {
      return value;
    }
    if (value !== undefined) {
      target[field] = value;
    }
  }
  return undefined;
}

function parseOptionalStringArrayOrNull(
  value: unknown,
  field: string,
): string[] | null | undefined | Response {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return jsonResponse(
      { code: 400, message: `${field} must be an array of strings or null` },
      400,
    );
  }
  return value;
}

function parseRequiredBoolean(value: unknown, field: string): boolean | Response {
  if (typeof value !== "boolean") {
    return jsonResponse({ code: 400, message: `${field} must be a boolean` }, 400);
  }
  return value;
}

function parseOptionalBooleanOrNull(
  value: unknown,
  field: string,
): boolean | null | undefined | Response {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "boolean") {
    return jsonResponse({ code: 400, message: `${field} must be a boolean or null` }, 400);
  }
  return value;
}

function parseRequiredInteger(value: unknown, field: string): number | Response {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return jsonResponse({ code: 400, message: `${field} must be an integer` }, 400);
  }
  return value;
}

function parseRequiredU8(value: unknown, field: string): number | Response {
  const parsed = parseRequiredInteger(value, field);
  if (parsed instanceof Response) {
    return parsed;
  }
  if (parsed < 0 || parsed > 255) {
    return jsonResponse({ code: 400, message: `${field} must be between 0 and 255` }, 400);
  }
  return parsed;
}

function parseRequiredNumber(value: unknown, field: string): number | Response {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return jsonResponse({ code: 400, message: `${field} must be a finite number` }, 400);
  }
  return value;
}

function parseOptionalIntegerOrNull(
  value: unknown,
  field: string,
): number | null | undefined | Response {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return jsonResponse({ code: 400, message: `${field} must be an integer or null` }, 400);
  }
  return value;
}

function parseOptionalNumberOrNull(
  value: unknown,
  field: string,
): number | null | undefined | Response {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return jsonResponse({ code: 400, message: `${field} must be a finite number or null` }, 400);
  }
  return value;
}

function parseOptionalBoolean(value: unknown, field: string): boolean | undefined | Response {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    return jsonResponse({ code: 400, message: `${field} must be a boolean` }, 400);
  }
  return value;
}

function parseOptionalTrackingMode(
  value: unknown,
): ReturnType<typeof parseTrackingMode> | undefined | Response {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    return jsonResponse({ code: 400, message: "trackingMode must be a string" }, 400);
  }
  return parseTrackingMode(value);
}

function parseOptionalPerformanceTrackingMode(
  value: unknown,
): "HOLDINGS" | "TRANSACTIONS" | undefined | Response {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value === "HOLDINGS" || value === "TRANSACTIONS") {
    return value;
  }
  if (typeof value !== "string") {
    return jsonResponse({ code: 400, message: "trackingMode must be a string" }, 400);
  }
  return undefined;
}
