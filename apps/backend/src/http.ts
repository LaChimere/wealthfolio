import path from "node:path";

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
import {
  ACTIVITY_IMPORT_CONTEXT_KIND,
  type ActivityParseCsvRequest,
  type ActivitySearchRequest,
  type ActivityService,
} from "./domains/activities";
import {
  AI_CHAT_ERROR_STATUS_BY_CODE,
  type AiChatListThreadsRequest,
  type AiChatService,
  type AiChatServiceErrorShape,
  type AiChatUpdateThreadRequest,
  type AiChatUpdateToolResultRequest,
} from "./domains/ai-chat";
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
import { isValidBackupFilename } from "./domains/app-utilities";
import type { AssetService, NewAsset, UpdateAssetProfile } from "./domains/assets";
import type {
  ConnectDeviceSyncReconcileReadyRequest,
  ConnectDeviceSyncService,
  ConnectImportRunsRequest,
  ConnectService,
  ConnectSyncBrokerDataResult,
} from "./domains/connect";
import type { ContributionLimitService, NewContributionLimit } from "./domains/contribution-limits";
import type { DataExportService, ExportDataType, ExportFileFormat } from "./domains/data-exports";
import {
  contentType as exportContentType,
  exportFileName,
  parseExportDataType,
  parseExportFileFormat,
} from "./domains/data-exports";
import type {
  CustomProviderService,
  NewCustomProvider,
  NewCustomProviderSource,
  TestSourceRequest,
  UpdateCustomProvider,
} from "./domains/custom-providers";
import type {
  BeginPairingConfirmRequest,
  ClaimPairingRequest,
  CommitInitializeTeamKeysRequest,
  CommitRotateTeamKeysRequest,
  CompletePairingRequest,
  CompletePairingWithTransferRequest,
  ConfirmPairingRequest,
  ConfirmPairingWithBootstrapRequest,
  CreatePairingRequest,
  DeviceSyncService,
  PairingFlowIdRequest,
  RegisterDeviceRequest,
  ResetTeamSyncRequest,
  UpdateDeviceRequest,
} from "./domains/device-sync";
import type { ExchangeRate, ExchangeRateService, NewExchangeRate } from "./domains/exchange-rates";
import type {
  Goal,
  GoalFundingRuleInput,
  GoalService,
  GoalValuationMap,
  NewGoal,
  SaveGoalPlan,
} from "./domains/goals";
import type { HealthConfig, HealthFixAction, HealthService } from "./domains/health";
import type {
  HoldingsImportRequest,
  HoldingsService,
  HoldingsSnapshotInput,
  SaveManualHoldingsRequest,
} from "./domains/holdings";
import type { MarketDataService, ResolveSymbolQuoteRequest } from "./domains/market-data";
import type { MarketDataProviderService, ProviderUpdate } from "./domains/market-data-providers";
import {
  DEFAULT_HISTORY_DAYS,
  buildPortfolioRecalculateConfig,
  buildPortfolioUpdateConfig,
  enqueueFullPortfolioRecalculation,
  enqueueIncrementalPortfolioRecalculation,
  enqueuePortfolioJobBestEffort,
  type MarketSyncMode,
  type PortfolioJobService,
  type PortfolioRequestBody,
} from "./domains/portfolio-jobs";
import type { PerformanceRequest, PortfolioMetricsService } from "./domains/portfolio-metrics";
import type { NewPortfolio, PortfolioService, PortfolioUpdate } from "./domains/portfolios";
import {
  projectRetirementWithMode,
  runMonteCarloWithModeAndSeed,
  runDecisionSensitivityMatrixWithMode,
  runScenarioAnalysisWithMode,
  runSorr,
  runStressTestsWithMode,
  type DecisionSensitivityMap,
  type RetirementPlan,
} from "./domains/retirement-calculations";
import {
  parseValidateAndNormalizeRetirementPlanSettings,
  type RetirementTimingMode,
} from "./domains/retirement-plan";
import type { SecretService } from "./domains/secrets";
import { previewSaveUpOverview, type SaveUpInput } from "./domains/save-up";
import type { Settings, SettingsService, SettingsUpdate } from "./domains/settings";
import type { SyncCryptoService } from "./domains/sync-crypto";
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
  activityService?: ActivityService;
  addonService?: AddonService;
  aiChatService?: AiChatService;
  aiProviderService?: AiProviderService;
  alternativeAssetService?: AlternativeAssetService;
  appDataDir?: string;
  appUtilityService?: AppUtilityService;
  assetService?: AssetService;
  connectDeviceSyncService?: ConnectDeviceSyncService;
  connectService?: ConnectService;
  dataExportService?: DataExportService;
  deviceSyncService?: DeviceSyncService;
  eventBus?: BackendEventBus;
  contributionLimitService?: ContributionLimitService;
  customProviderService?: CustomProviderService;
  exchangeRateService?: ExchangeRateService;
  goalService?: GoalService;
  goalValuationProvider?: GoalValuationProvider;
  healthService?: HealthService;
  holdingsService?: HoldingsService;
  marketDataService?: MarketDataService;
  marketDataProviderService?: MarketDataProviderService;
  portfolioMetricsService?: PortfolioMetricsService;
  portfolioService?: PortfolioService;
  portfolioJobService?: PortfolioJobService;
  restartRequired?: () => boolean;
  secretService?: SecretService;
  settingsService?: SettingsService;
  syncCryptoService?: SyncCryptoService;
  taxonomyService?: TaxonomyService;
}

export interface GoalValuationProvider {
  getGoalValuationMap(): Promise<GoalValuationMap>;
}

const DEFAULT_RETIREMENT_MONTE_CARLO_SIMULATIONS = 10_000;
const MAX_RETIREMENT_MONTE_CARLO_SIMULATIONS = 500_000;

interface RetirementSimulationRequest {
  plan: Record<string, unknown>;
  currentPortfolio: number;
  goalId?: string;
  plannerMode?: RetirementTimingMode;
}

interface RetirementMonteCarloRequest extends RetirementSimulationRequest {
  nSims: number;
  seed?: bigint;
}

interface RetirementSorrRequest {
  plan: Record<string, unknown>;
  portfolioAtFire: number;
  retirementStartAge: number;
  goalId?: string;
}

interface RetirementDecisionSensitivityMapRequest extends RetirementSimulationRequest {
  map: DecisionSensitivityMap;
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
    if (options.restartRequired?.()) {
      return jsonResponse({ code: 503, message: "Backend restart required" }, 503);
    }
    return new Response("ok", { status: 200 });
  }
  if (options.restartRequired?.()) {
    return jsonResponse({ code: 503, message: "Backend restart required" }, 503);
  }
  if (request.method === "GET" && url.pathname === "/api/v1/auth/status") {
    return jsonResponse({ requiresPassword: Boolean(config.authPasswordHash) });
  }

  if (options.accountService && url.pathname.startsWith("/api/v1/accounts")) {
    return await routeAccountRequest(request, url, config, options.accountService);
  }

  if (options.activityService && url.pathname.startsWith("/api/v1/activities")) {
    return routeActivityRequest(request, url, config, options.activityService);
  }

  if (options.addonService && url.pathname.startsWith("/api/v1/addons")) {
    return routeAddonRequest(request, url, config, options.addonService);
  }

  if (options.aiChatService && isAiChatPath(url.pathname)) {
    return routeAiChatRequest(request, url, config, options.aiChatService);
  }

  if (options.aiProviderService && url.pathname.startsWith("/api/v1/ai/providers")) {
    return routeAiProviderRequest(request, url, config, options.aiProviderService);
  }

  if (
    options.alternativeAssetService &&
    (url.pathname.startsWith("/api/v1/alternative-assets") ||
      url.pathname === "/api/v1/alternative-holdings")
  ) {
    return routeAlternativeAssetRequest(
      request,
      url,
      config,
      options.alternativeAssetService,
      options.portfolioJobService,
    );
  }

  if (options.dataExportService && url.pathname.startsWith("/api/v1/utilities/export")) {
    if (config.sidecarToken && !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
      return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
    }
    return routeDataExportRequest(request, url, options.dataExportService);
  }

  if (
    options.appUtilityService &&
    (url.pathname.startsWith("/api/v1/app") ||
      url.pathname.startsWith("/api/v1/utilities/database"))
  ) {
    return routeAppUtilityRequest(
      request,
      url,
      config,
      options.appUtilityService,
      options.appDataDir,
    );
  }

  if (options.assetService && url.pathname.startsWith("/api/v1/assets")) {
    return routeAssetRequest(request, url, config, options.assetService);
  }

  if (isConnectDevicePath(url.pathname)) {
    if (config.sidecarToken && !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
      return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
    }
    if (options.connectDeviceSyncService) {
      return routeConnectDeviceSyncRequest(request, url, options.connectDeviceSyncService);
    }
    return jsonResponse({ code: 404, message: "Not Found" }, 404);
  }

  if (isConnectBrokerPath(url.pathname)) {
    if (config.sidecarToken && !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
      return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
    }
    if (options.connectService) {
      return routeConnectRequest(request, url, options.connectService);
    }
    return jsonResponse({ code: 404, message: "Not Found" }, 404);
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

  if (isDeviceSyncDeviceManagementPath(url.pathname)) {
    if (config.sidecarToken && !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
      return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
    }
    if (options.deviceSyncService) {
      return routeDeviceSyncDeviceManagementRequest(request, url, options.deviceSyncService);
    }
    return jsonResponse({ code: 404, message: "Not Found" }, 404);
  }

  if (isDeviceSyncTeamKeyPath(url.pathname)) {
    if (config.sidecarToken && !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
      return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
    }
    if (options.deviceSyncService) {
      return routeDeviceSyncTeamKeyRequest(request, url, options.deviceSyncService);
    }
    return jsonResponse({ code: 404, message: "Not Found" }, 404);
  }

  if (isDeviceSyncPairingPath(url.pathname)) {
    if (config.sidecarToken && !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
      return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
    }
    if (options.deviceSyncService) {
      return routeDeviceSyncPairingRequest(request, url, options.deviceSyncService);
    }
    return jsonResponse({ code: 404, message: "Not Found" }, 404);
  }

  if (options.exchangeRateService && url.pathname.startsWith("/api/v1/exchange-rates")) {
    return routeExchangeRateRequest(
      request,
      url,
      config,
      options.exchangeRateService,
      options.portfolioJobService,
    );
  }

  if (options.goalService && url.pathname.startsWith("/api/v1/goals")) {
    return routeGoalRequest(
      request,
      url,
      config,
      options.goalService,
      options.goalValuationProvider,
    );
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
    return routeHoldingsRequest(
      request,
      url,
      config,
      options.holdingsService,
      options.portfolioService,
    );
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

  if (
    options.marketDataService &&
    (url.pathname === "/api/v1/exchanges" || url.pathname.startsWith("/api/v1/market-data"))
  ) {
    return routeMarketDataRequest(
      request,
      url,
      config,
      options.marketDataService,
      options.portfolioJobService,
    );
  }

  if (options.portfolioService && url.pathname.startsWith("/api/v1/portfolios")) {
    return routePortfolioRequest(request, url, config, options.portfolioService);
  }

  if (options.portfolioJobService && url.pathname.startsWith("/api/v1/portfolio")) {
    return await routePortfolioJobRequest(request, url, config, options.portfolioJobService);
  }

  if (
    options.portfolioMetricsService &&
    (url.pathname.startsWith("/api/v1/net-worth") ||
      url.pathname.startsWith("/api/v1/performance") ||
      url.pathname.startsWith("/api/v1/income/summary"))
  ) {
    return routePortfolioMetricsRequest(
      request,
      url,
      config,
      options.portfolioMetricsService,
      options.portfolioService,
    );
  }

  if (options.secretService && url.pathname === "/api/v1/secrets") {
    return routeSecretRequest(request, url, config, options.secretService);
  }

  if (options.syncCryptoService && url.pathname.startsWith("/api/v1/sync/crypto")) {
    return routeSyncCryptoRequest(request, url, config, options.syncCryptoService);
  }

  if (options.settingsService && url.pathname.startsWith("/api/v1/settings")) {
    return await routeSettingsRequest(
      request,
      url,
      config,
      options.settingsService,
      options.healthService,
      options.portfolioJobService,
    );
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

  if (
    config.staticDir &&
    !url.pathname.startsWith("/api/") &&
    (request.method === "GET" || request.method === "HEAD")
  ) {
    const staticResponse = await serveStaticFile(config.staticDir, url.pathname, request.method);
    if (staticResponse) {
      return staticResponse;
    }
  }

  return jsonResponse({ code: 404, message: "Not Found" }, 404);
}

function routeActivityRequest(
  request: Request,
  url: URL,
  config: BackendRuntimeConfig,
  activityService: ActivityService,
): Promise<Response> | Response {
  if (config.sidecarToken && !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/activities/search") {
    return handleJsonMutation(request, parseActivitySearchRequest, (input) =>
      Promise.resolve(activityService.searchActivities(input)),
    );
  }

  if (request.method === "POST" && url.pathname === "/api/v1/activities") {
    return handleJsonMutation(request, passThroughObject, (activity) =>
      Promise.resolve(activityService.createActivity(activity)),
    );
  }

  if (request.method === "PUT" && url.pathname === "/api/v1/activities") {
    return handleJsonMutation(request, passThroughObject, (activity) =>
      Promise.resolve(activityService.updateActivity(activity)),
    );
  }

  if (request.method === "POST" && url.pathname === "/api/v1/activities/bulk") {
    return handleJsonMutation(request, passThroughObject, (input) =>
      Promise.resolve(activityService.bulkMutateActivities(input)),
    );
  }

  if (request.method === "POST" && url.pathname === "/api/v1/activities/link") {
    return handleJsonMutation(request, parseTransferActivitiesRequest, (input) =>
      Promise.resolve(activityService.linkTransferActivities(input.activityAId, input.activityBId)),
    );
  }

  if (request.method === "POST" && url.pathname === "/api/v1/activities/unlink") {
    return handleJsonMutation(request, parseTransferActivitiesRequest, (input) =>
      Promise.resolve(
        activityService.unlinkTransferActivities(input.activityAId, input.activityBId),
      ),
    );
  }

  if (request.method === "POST" && url.pathname === "/api/v1/activities/import/check") {
    return handleJsonMutation(request, parseActivitiesArrayRequest, (input) =>
      Promise.resolve(activityService.checkActivitiesImport(input.activities)),
    );
  }

  if (request.method === "POST" && url.pathname === "/api/v1/activities/import/assets/preview") {
    return handleJsonMutation(request, parseImportCandidatesRequest, (input) =>
      Promise.resolve(activityService.previewImportAssets(input.candidates)),
    );
  }

  if (request.method === "POST" && url.pathname === "/api/v1/activities/import") {
    return handleJsonMutation(request, parseActivitiesArrayRequest, (input) =>
      Promise.resolve(activityService.importActivities(input.activities)),
    );
  }

  if (request.method === "POST" && url.pathname === "/api/v1/activities/import/parse") {
    return handleActivityCsvParseRequest(request, activityService.parseCsv);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/activities/import/mapping") {
    const input = parseActivityImportMappingQuery(url);
    if (input instanceof Response) {
      return input;
    }
    return Promise.resolve(activityService.getImportMapping(input.accountId, input.contextKind))
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/activities/import/mapping") {
    return handleJsonMutation(request, parseWrappedObject("mapping"), (input) =>
      Promise.resolve(activityService.saveImportMapping(input.mapping)),
    );
  }

  if (request.method === "GET" && url.pathname === "/api/v1/activities/import/templates") {
    return Promise.resolve(activityService.listImportTemplates())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/activities/import/templates") {
    return handleJsonMutation(request, parseWrappedObject("template"), (input) =>
      Promise.resolve(activityService.saveImportTemplate(input.template)),
    );
  }

  if (request.method === "DELETE" && url.pathname === "/api/v1/activities/import/templates") {
    const id = parseRequiredQueryString(url, "id");
    if (id instanceof Response) {
      return id;
    }
    return Promise.resolve(activityService.deleteImportTemplate(id))
      .then(() => jsonResponse({ success: true }))
      .catch(domainErrorResponse);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/activities/import/templates/item") {
    const id = parseRequiredQueryString(url, "id");
    if (id instanceof Response) {
      return id;
    }
    return Promise.resolve(activityService.getImportTemplate(id))
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/activities/import/templates/link") {
    return handleJsonMutation(request, parseLinkAccountTemplateRequest, async (input) => {
      await activityService.linkAccountTemplate(
        input.accountId,
        input.templateId,
        input.contextKind,
      );
      return { success: true };
    });
  }

  if (request.method === "POST" && url.pathname === "/api/v1/activities/import/check-duplicates") {
    return handleJsonMutation(request, parseCheckDuplicatesRequest, async (input) => ({
      duplicates: await activityService.checkExistingDuplicates(input.idempotencyKeys),
    }));
  }

  const activityId = activityIdFromPath(url.pathname);
  if (request.method === "DELETE" && activityId !== undefined) {
    return Promise.resolve(activityService.deleteActivity(activityId))
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  return jsonResponse({ code: 404, message: "Not Found" }, 404);
}

function routeConnectRequest(
  request: Request,
  url: URL,
  connectService: ConnectService,
): Promise<Response> | Response {
  if (request.method === "POST" && url.pathname === "/api/v1/connect/session") {
    return handleConnectStoreSessionRequest(request, connectService);
  }

  if (request.method === "DELETE" && url.pathname === "/api/v1/connect/session") {
    return Promise.resolve(connectService.clearSyncSession())
      .then(() => jsonResponse(null))
      .catch(domainErrorResponse);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/connect/session/status") {
    return Promise.resolve(connectService.getSyncSessionStatus())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/connect/session/restore") {
    return Promise.resolve(connectService.restoreSyncSession())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/connect/connections") {
    return Promise.resolve(connectService.listBrokerConnections())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/connect/accounts") {
    return Promise.resolve(connectService.listBrokerAccounts())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/connect/sync") {
    return Promise.resolve(connectService.syncBrokerData())
      .then(connectSyncBrokerDataResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/connect/sync/connections") {
    return Promise.resolve(connectService.syncBrokerConnections())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/connect/sync/accounts") {
    return Promise.resolve(connectService.syncBrokerAccounts())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/connect/sync/activities") {
    return Promise.resolve(connectService.syncBrokerActivities())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/connect/synced-accounts") {
    return Promise.resolve(connectService.getSyncedAccounts())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/connect/platforms") {
    return Promise.resolve(connectService.getPlatforms())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/connect/sync-states") {
    return Promise.resolve(connectService.getBrokerSyncStates())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/connect/import-runs") {
    const input = parseConnectImportRunsQuery(url);
    if (input instanceof Response) {
      return input;
    }
    return Promise.resolve(connectService.getImportRuns(input))
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/connect/broker-sync-profile") {
    const input = parseConnectBrokerSyncProfileQuery(url);
    if (input instanceof Response) {
      return input;
    }
    return Promise.resolve(connectService.getBrokerSyncProfile(input.accountId, input.sourceSystem))
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/connect/broker-sync-profile") {
    return handleJsonMutation(request, passThroughObject, (input) =>
      Promise.resolve(connectService.saveBrokerSyncProfileRules(input)),
    );
  }

  if (request.method === "GET" && url.pathname === "/api/v1/connect/plans") {
    return Promise.resolve(connectService.getSubscriptionPlans())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/connect/plans/public") {
    return Promise.resolve(connectService.getSubscriptionPlansPublic())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/connect/user") {
    return Promise.resolve(connectService.getUserInfo())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  return jsonResponse({ code: 404, message: "Not Found" }, 404);
}

function routeConnectDeviceSyncRequest(
  request: Request,
  url: URL,
  connectDeviceSyncService: ConnectDeviceSyncService,
): Promise<Response> | Response {
  if (request.method === "GET" && url.pathname === "/api/v1/connect/device/sync-state") {
    return Promise.resolve(connectDeviceSyncService.getDeviceSyncState())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/connect/device/enable") {
    return Promise.resolve(connectDeviceSyncService.enableDeviceSync())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "DELETE" && url.pathname === "/api/v1/connect/device/sync-data") {
    return Promise.resolve(connectDeviceSyncService.clearDeviceSyncData())
      .then(() => jsonResponse(null))
      .catch(domainErrorResponse);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/connect/device/reinitialize") {
    return Promise.resolve(connectDeviceSyncService.reinitializeDeviceSync())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/connect/device/engine-status") {
    return Promise.resolve(connectDeviceSyncService.getDeviceSyncEngineStatus())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/connect/device/pairing-source-status") {
    return Promise.resolve(connectDeviceSyncService.getDeviceSyncPairingSourceStatus())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (
    request.method === "GET" &&
    url.pathname === "/api/v1/connect/device/bootstrap-overwrite-check"
  ) {
    return Promise.resolve(connectDeviceSyncService.getDeviceSyncBootstrapOverwriteCheck())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/v1/connect/device/reconcile-ready-state"
  ) {
    return handleJsonMutation(request, parseConnectDeviceSyncReconcileReadyRequest, (input) =>
      Promise.resolve(connectDeviceSyncService.reconcileDeviceSyncReadyState(input)),
    );
  }

  if (request.method === "POST" && url.pathname === "/api/v1/connect/device/bootstrap-snapshot") {
    return Promise.resolve(connectDeviceSyncService.bootstrapDeviceSnapshot())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/connect/device/trigger-cycle") {
    return Promise.resolve(connectDeviceSyncService.triggerDeviceSyncCycle())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/connect/device/start-background") {
    return Promise.resolve(connectDeviceSyncService.startDeviceSyncBackgroundEngine())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/connect/device/stop-background") {
    return Promise.resolve(connectDeviceSyncService.stopDeviceSyncBackgroundEngine())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/connect/device/generate-snapshot") {
    return Promise.resolve(connectDeviceSyncService.generateDeviceSnapshotNow())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/connect/device/cancel-snapshot") {
    return Promise.resolve(connectDeviceSyncService.cancelDeviceSnapshotUpload())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  return jsonResponse({ code: 404, message: "Not Found" }, 404);
}

function routeDeviceSyncDeviceManagementRequest(
  request: Request,
  url: URL,
  deviceSyncService: DeviceSyncService,
): Promise<Response> | Response {
  if (request.method === "POST" && url.pathname === "/api/v1/sync/device/register") {
    return handleJsonMutation(request, parseRegisterDeviceRequest, (input) =>
      Promise.resolve(deviceSyncService.registerDevice(input)),
    );
  }

  if (request.method === "GET" && url.pathname === "/api/v1/sync/device/current") {
    return handleServiceJsonResponse(() => deviceSyncService.getCurrentDevice());
  }

  if (request.method === "GET" && url.pathname === "/api/v1/sync/devices") {
    return handleServiceJsonResponse(() =>
      deviceSyncService.listDevices(url.searchParams.get("scope") ?? undefined),
    );
  }

  const revokeDeviceId = deviceSyncRevokeDeviceIdFromPath(url.pathname);
  if (request.method === "POST" && revokeDeviceId !== undefined) {
    if (revokeDeviceId instanceof Response) {
      return revokeDeviceId;
    }
    return handleServiceJsonResponse(() => deviceSyncService.revokeDevice(revokeDeviceId));
  }

  const deviceId = deviceSyncDeviceIdFromPath(url.pathname);
  if (deviceId !== undefined) {
    if (deviceId instanceof Response) {
      return deviceId;
    }
    if (request.method === "GET") {
      return handleServiceJsonResponse(() => deviceSyncService.getDevice(deviceId));
    }
    if (request.method === "PATCH") {
      return handleJsonMutation(request, parseUpdateDeviceRequest, (input) =>
        Promise.resolve(deviceSyncService.updateDevice(deviceId, input)),
      );
    }
    if (request.method === "DELETE") {
      return handleServiceJsonResponse(() => deviceSyncService.deleteDevice(deviceId));
    }
  }

  return jsonResponse({ code: 404, message: "Not Found" }, 404);
}

function routeDeviceSyncTeamKeyRequest(
  request: Request,
  url: URL,
  deviceSyncService: DeviceSyncService,
): Promise<Response> | Response {
  if (request.method === "POST" && url.pathname === "/api/v1/sync/keys/initialize") {
    return deviceSyncService.initializeTeamKeys
      ? handleServiceJsonResponse(() => deviceSyncService.initializeTeamKeys?.())
      : jsonResponse({ code: 404, message: "Not Found" }, 404);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/sync/keys/initialize/commit") {
    return deviceSyncService.commitInitializeTeamKeys
      ? handleJsonMutation(request, parseCommitInitializeTeamKeysRequest, (input) =>
          Promise.resolve(deviceSyncService.commitInitializeTeamKeys?.(input)),
        )
      : jsonResponse({ code: 404, message: "Not Found" }, 404);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/sync/keys/rotate") {
    return deviceSyncService.rotateTeamKeys
      ? handleServiceJsonResponse(() => deviceSyncService.rotateTeamKeys?.())
      : jsonResponse({ code: 404, message: "Not Found" }, 404);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/sync/keys/rotate/commit") {
    return deviceSyncService.commitRotateTeamKeys
      ? handleJsonMutation(request, parseCommitRotateTeamKeysRequest, (input) =>
          Promise.resolve(deviceSyncService.commitRotateTeamKeys?.(input)),
        )
      : jsonResponse({ code: 404, message: "Not Found" }, 404);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/sync/team/reset") {
    return deviceSyncService.resetTeamSync
      ? handleJsonMutation(request, parseResetTeamSyncRequest, (input) =>
          Promise.resolve(deviceSyncService.resetTeamSync?.(input)),
        )
      : jsonResponse({ code: 404, message: "Not Found" }, 404);
  }

  return jsonResponse({ code: 404, message: "Not Found" }, 404);
}

function routeDeviceSyncPairingRequest(
  request: Request,
  url: URL,
  deviceSyncService: DeviceSyncService,
): Promise<Response> | Response {
  if (request.method === "POST" && url.pathname === "/api/v1/sync/pairing") {
    return deviceSyncService.createPairing
      ? handleJsonMutation(request, parseCreatePairingRequest, (input) =>
          Promise.resolve(deviceSyncService.createPairing?.(input)),
        )
      : jsonResponse({ code: 404, message: "Not Found" }, 404);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/sync/pairing/claim") {
    return deviceSyncService.claimPairing
      ? handleJsonMutation(request, parseClaimPairingRequest, (input) =>
          Promise.resolve(deviceSyncService.claimPairing?.(input)),
        )
      : jsonResponse({ code: 404, message: "Not Found" }, 404);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/sync/pairing/complete-with-transfer") {
    return deviceSyncService.completePairingWithTransfer
      ? handleJsonMutation(request, parseCompletePairingWithTransferRequest, (input) =>
          Promise.resolve(deviceSyncService.completePairingWithTransfer?.(input)),
        )
      : jsonResponse({ code: 404, message: "Not Found" }, 404);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/sync/pairing/confirm-with-bootstrap") {
    return deviceSyncService.confirmPairingWithBootstrap
      ? handleJsonMutation(request, parseConfirmPairingWithBootstrapRequest, (input) =>
          Promise.resolve(deviceSyncService.confirmPairingWithBootstrap?.(input)),
        )
      : jsonResponse({ code: 404, message: "Not Found" }, 404);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/sync/pairing/flow/begin") {
    return deviceSyncService.beginPairingConfirm
      ? handleJsonMutation(request, parseBeginPairingConfirmRequest, (input) =>
          Promise.resolve(deviceSyncService.beginPairingConfirm?.(input)),
        )
      : jsonResponse({ code: 404, message: "Not Found" }, 404);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/sync/pairing/flow/state") {
    return deviceSyncService.getPairingFlowState
      ? handleJsonMutation(request, parsePairingFlowIdRequest, (input) =>
          Promise.resolve(deviceSyncService.getPairingFlowState?.(input)),
        )
      : jsonResponse({ code: 404, message: "Not Found" }, 404);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/sync/pairing/flow/approve-overwrite") {
    return deviceSyncService.approvePairingOverwrite
      ? handleJsonMutation(request, parsePairingFlowIdRequest, (input) =>
          Promise.resolve(deviceSyncService.approvePairingOverwrite?.(input)),
        )
      : jsonResponse({ code: 404, message: "Not Found" }, 404);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/sync/pairing/flow/cancel") {
    return deviceSyncService.cancelPairingFlow
      ? handleJsonMutation(request, parsePairingFlowIdRequest, (input) =>
          Promise.resolve(deviceSyncService.cancelPairingFlow?.(input)),
        )
      : jsonResponse({ code: 404, message: "Not Found" }, 404);
  }

  const messagesPairingId = deviceSyncPairingMessagesIdFromPath(url.pathname);
  if (request.method === "GET" && messagesPairingId !== undefined) {
    if (messagesPairingId instanceof Response) {
      return messagesPairingId;
    }
    return deviceSyncService.getPairingMessages
      ? handleServiceJsonResponse(() => deviceSyncService.getPairingMessages?.(messagesPairingId))
      : jsonResponse({ code: 404, message: "Not Found" }, 404);
  }

  const approvePairingId = deviceSyncPairingApproveIdFromPath(url.pathname);
  if (request.method === "POST" && approvePairingId !== undefined) {
    if (approvePairingId instanceof Response) {
      return approvePairingId;
    }
    return deviceSyncService.approvePairing
      ? handleServiceJsonResponse(() => deviceSyncService.approvePairing?.(approvePairingId))
      : jsonResponse({ code: 404, message: "Not Found" }, 404);
  }

  const completePairingId = deviceSyncPairingCompleteIdFromPath(url.pathname);
  if (request.method === "POST" && completePairingId !== undefined) {
    if (completePairingId instanceof Response) {
      return completePairingId;
    }
    return deviceSyncService.completePairing
      ? handleJsonMutation(request, parseCompletePairingRequest, (input) =>
          Promise.resolve(deviceSyncService.completePairing?.(completePairingId, input)),
        )
      : jsonResponse({ code: 404, message: "Not Found" }, 404);
  }

  const cancelPairingId = deviceSyncPairingCancelIdFromPath(url.pathname);
  if (request.method === "POST" && cancelPairingId !== undefined) {
    if (cancelPairingId instanceof Response) {
      return cancelPairingId;
    }
    return deviceSyncService.cancelPairing
      ? handleServiceJsonResponse(() => deviceSyncService.cancelPairing?.(cancelPairingId))
      : jsonResponse({ code: 404, message: "Not Found" }, 404);
  }

  const confirmPairingId = deviceSyncPairingConfirmIdFromPath(url.pathname);
  if (request.method === "POST" && confirmPairingId !== undefined) {
    if (confirmPairingId instanceof Response) {
      return confirmPairingId;
    }
    return deviceSyncService.confirmPairing
      ? handleJsonMutation(request, parseConfirmPairingRequest, (input) =>
          Promise.resolve(deviceSyncService.confirmPairing?.(confirmPairingId, input)),
        )
      : jsonResponse({ code: 404, message: "Not Found" }, 404);
  }

  const pairingId = deviceSyncPairingIdFromPath(url.pathname);
  if (request.method === "GET" && pairingId !== undefined) {
    if (pairingId instanceof Response) {
      return pairingId;
    }
    return deviceSyncService.getPairing
      ? handleServiceJsonResponse(() => deviceSyncService.getPairing?.(pairingId))
      : jsonResponse({ code: 404, message: "Not Found" }, 404);
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

function routeAiChatRequest(
  request: Request,
  url: URL,
  config: BackendRuntimeConfig,
  aiChatService: AiChatService,
): Promise<Response> | Response {
  if (config.sidecarToken && !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/ai/chat/stream") {
    return handleAiChatStreamRequest(request, aiChatService);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/ai/threads") {
    const input = parseAiChatListThreadsQuery(url);
    if (input instanceof Response) {
      return input;
    }
    return Promise.resolve(aiChatService.listThreads(input))
      .then(jsonResponse)
      .catch(aiChatErrorResponse);
  }

  const messagesThreadId = aiThreadMessagesIdFromPath(url.pathname);
  if (request.method === "GET" && messagesThreadId !== undefined) {
    return Promise.resolve(aiChatService.getMessages(messagesThreadId))
      .then(jsonResponse)
      .catch(aiChatErrorResponse);
  }

  const tagRoute = aiThreadTagRouteFromPath(url.pathname);
  if (tagRoute !== undefined) {
    if (request.method === "GET" && tagRoute.tag === undefined) {
      return Promise.resolve(aiChatService.getTags(tagRoute.threadId))
        .then(jsonResponse)
        .catch(aiChatErrorResponse);
    }
    if (request.method === "POST" && tagRoute.tag === undefined) {
      return handleAiChatJsonMutationNoContent(request, parseAiChatTagRequest, (input) =>
        Promise.resolve(aiChatService.addTag(tagRoute.threadId, input.tag)).then(() => undefined),
      );
    }
    if (request.method === "DELETE" && tagRoute.tag !== undefined) {
      return Promise.resolve(aiChatService.removeTag(tagRoute.threadId, tagRoute.tag))
        .then(() => new Response(null, { status: 204 }))
        .catch(aiChatErrorResponse);
    }
  }

  const threadId = aiThreadIdFromPath(url.pathname);
  if (threadId !== undefined) {
    if (request.method === "GET") {
      return Promise.resolve(aiChatService.getThread(threadId))
        .then(jsonResponse)
        .catch(aiChatErrorResponse);
    }
    if (request.method === "PUT") {
      return handleAiChatJsonMutation(request, parseAiChatUpdateThreadRequest, (input) =>
        Promise.resolve(aiChatService.updateThread(threadId, input)),
      );
    }
    if (request.method === "DELETE") {
      return Promise.resolve(aiChatService.deleteThread(threadId))
        .then(() => new Response(null, { status: 204 }))
        .catch(aiChatErrorResponse);
    }
  }

  if (request.method === "PATCH" && url.pathname === "/api/v1/ai/tool-result") {
    return handleAiChatJsonMutation(request, parseAiChatUpdateToolResultRequest, (input) =>
      Promise.resolve(aiChatService.updateToolResult(input)),
    );
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
  portfolioJobService?: PortfolioJobService,
): Promise<Response> | Response {
  if (config.sidecarToken && !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/alternative-assets") {
    return handleJsonMutation(request, parseCreateAlternativeAssetRequest, async (input) => {
      const result = await alternativeAssetService.createAlternativeAsset(input);
      enqueueIncrementalPortfolioRecalculation(portfolioJobService, "Alternative asset mutation");
      return result;
    });
  }

  const valuationAssetId = alternativeAssetValuationIdFromPath(url.pathname);
  if (request.method === "PUT" && valuationAssetId !== undefined) {
    return handleJsonMutation(
      request,
      parseUpdateAlternativeAssetValuationRequest,
      async (input) => {
        const result = await alternativeAssetService.updateValuation(valuationAssetId, input);
        enqueueIncrementalPortfolioRecalculation(portfolioJobService, "Alternative asset mutation");
        return result;
      },
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
      .then(() => {
        enqueueIncrementalPortfolioRecalculation(portfolioJobService, "Alternative asset mutation");
        return new Response(null, { status: 204 });
      })
      .catch(domainErrorResponse);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/alternative-holdings") {
    return Promise.resolve(alternativeAssetService.getAlternativeHoldings())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  return jsonResponse({ code: 404, message: "Not Found" }, 404);
}

async function routeBackupDownloadRequest(
  filename: string,
  appUtilityService: AppUtilityService,
  appDataDir: string,
): Promise<Response> {
  if (!isValidBackupFilename(filename)) {
    return jsonResponse({ code: 400, message: "Invalid backup filename" }, 400);
  }

  try {
    const backups = await appUtilityService.listDatabaseBackups();
    const backup = backups.find((b) => b.filename === filename);
    if (!backup) {
      return jsonResponse({ code: 404, message: "Backup not found" }, 404);
    }

    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");

    const backupPath = resolve(appDataDir, "backups", filename);
    const fileContent = readFileSync(backupPath);

    return new Response(fileContent as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return jsonResponse(
      {
        code: 500,
        message: error instanceof Error ? error.message : "Failed to download backup",
      },
      500,
    );
  }
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

function routeDataExportRequest(
  request: Request,
  url: URL,
  dataExportService: DataExportService,
): Promise<Response> {
  const match = url.pathname.match(/^\/api\/v1\/utilities\/export\/([^/]+)\/([^/]+)$/);
  if (!match || request.method !== "GET") {
    return Promise.resolve(jsonResponse({ code: 404, message: "Not Found" }, 404));
  }

  const [, dataTypeParam, formatParam] = match;
  let dataType: ExportDataType;
  let format: ExportFileFormat;

  try {
    dataType = parseExportDataType(dataTypeParam);
    format = parseExportFileFormat(formatParam);
  } catch (error) {
    return Promise.resolve(
      jsonResponse(
        {
          code: 400,
          message: error instanceof Error ? error.message : "Invalid export parameters",
        },
        400,
      ),
    );
  }

  return dataExportService
    .exportData(dataType, format)
    .then((content) => {
      if (!content) {
        return new Response(null, { status: 204 });
      }
      const filename = exportFileName(dataType, format);
      return new Response(content as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": exportContentType(format),
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    })
    .catch((error) => {
      return jsonResponse(
        {
          code: 500,
          message: error instanceof Error ? error.message : "Export failed",
        },
        500,
      );
    });
}

function routeAppUtilityRequest(
  request: Request,
  url: URL,
  config: BackendRuntimeConfig,
  appUtilityService: AppUtilityService,
  appDataDir?: string,
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

  if (request.method === "GET" && url.pathname === "/api/v1/utilities/database/backups") {
    return Promise.resolve(appUtilityService.listDatabaseBackups())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  const backupFilenameMatch = url.pathname.match(
    /^\/api\/v1\/utilities\/database\/backups\/([^/]+)$/,
  );
  if (backupFilenameMatch && request.method === "DELETE") {
    const filename = decodeURIComponent(backupFilenameMatch[1]);
    return Promise.resolve(appUtilityService.deleteDatabaseBackup(filename))
      .then(() => new Response(null, { status: 204 }))
      .catch(domainErrorResponse);
  }

  const backupDownloadMatch = url.pathname.match(
    /^\/api\/v1\/utilities\/database\/backups\/([^/]+)\/download$/,
  );
  if (backupDownloadMatch && request.method === "GET") {
    const filename = decodeURIComponent(backupDownloadMatch[1]);
    if (!appDataDir) {
      return jsonResponse({ code: 500, message: "App data directory not configured" }, 500);
    }
    return routeBackupDownloadRequest(filename, appUtilityService, appDataDir);
  }

  return jsonResponse({ code: 404, message: "Not Found" }, 404);
}

function routePortfolioMetricsRequest(
  request: Request,
  url: URL,
  config: BackendRuntimeConfig,
  portfolioMetricsService: PortfolioMetricsService,
  portfolioService?: PortfolioService,
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

  if (request.method === "POST" && url.pathname === "/api/v1/income/summary/query") {
    return handleJsonMutation(request, parseIncomeSummaryQuery, (query) => {
      if (!query.filter || query.filter.type === "TotalSnapshot") {
        return Promise.resolve(portfolioMetricsService.getIncomeSummary());
      }
      if (query.filter.type === "Account") {
        return Promise.resolve(portfolioMetricsService.getIncomeSummary(query.filter.accountId));
      }
      const accountIds = resolveAccountScopeIds(query.filter, portfolioService);
      return Promise.resolve(portfolioMetricsService.getIncomeSummaryForAccounts(accountIds));
    });
  }

  return jsonResponse({ code: 404, message: "Not Found" }, 404);
}

function routeHoldingsRequest(
  request: Request,
  url: URL,
  config: BackendRuntimeConfig,
  holdingsService: HoldingsService,
  portfolioService?: PortfolioService,
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

  if (request.method === "POST" && url.pathname === "/api/v1/holdings/query") {
    return handleJsonMutation(request, parseHoldingsQuery, (query) => {
      if (query.filter.type === "TotalSnapshot") {
        return Promise.resolve(holdingsService.getHoldings(PORTFOLIO_TOTAL_ACCOUNT_ID));
      }
      if (query.filter.type === "Account") {
        return Promise.resolve(holdingsService.getHoldings(query.filter.accountId));
      }
      const accountIds = resolveAccountScopeIds(query.filter, portfolioService);
      return Promise.resolve(holdingsService.getHoldingsForAccounts(accountIds));
    });
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

  if (request.method === "GET" && url.pathname === "/api/v1/holdings/lots") {
    const assetId = parseRequiredQueryString(url, "assetId");
    if (assetId instanceof Response) {
      return assetId;
    }
    const includeSnapshotPositions =
      url.searchParams.get("includeSnapshotPositions")?.toLowerCase() === "true";
    return Promise.resolve(holdingsService.getAssetLots(assetId, includeSnapshotPositions))
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

  if (request.method === "POST" && url.pathname === "/api/v1/allocations/query") {
    return handleJsonMutation(request, parseHoldingsQuery, (query) => {
      if (query.filter.type === "TotalSnapshot") {
        return Promise.resolve(holdingsService.getPortfolioAllocations(PORTFOLIO_TOTAL_ACCOUNT_ID));
      }
      if (query.filter.type === "Account") {
        return Promise.resolve(holdingsService.getPortfolioAllocations(query.filter.accountId));
      }
      const accountIds = resolveAccountScopeIds(query.filter, portfolioService);
      return Promise.resolve(holdingsService.getPortfolioAllocationsForAccounts(accountIds));
    });
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

  if (request.method === "POST" && url.pathname === "/api/v1/allocations/holdings/query") {
    return handleJsonMutation(request, parseAllocationHoldingsQuery, (query) => {
      if (query.filter.type === "TotalSnapshot") {
        return Promise.resolve(
          holdingsService.getHoldingsByAllocation(
            PORTFOLIO_TOTAL_ACCOUNT_ID,
            query.taxonomyId,
            query.categoryId,
          ),
        );
      }
      if (query.filter.type === "Account") {
        return Promise.resolve(
          holdingsService.getHoldingsByAllocation(
            query.filter.accountId,
            query.taxonomyId,
            query.categoryId,
          ),
        );
      }
      const accountIds = resolveAccountScopeIds(query.filter, portfolioService);
      return Promise.resolve(
        holdingsService.getHoldingsByAllocationForAccounts(
          accountIds,
          query.taxonomyId,
          query.categoryId,
        ),
      );
    });
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

function routeSyncCryptoRequest(
  request: Request,
  url: URL,
  config: BackendRuntimeConfig,
  syncCryptoService: SyncCryptoService,
): Promise<Response> | Response {
  if (config.sidecarToken && !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  if (request.method !== "POST") {
    return jsonResponse({ code: 404, message: "Not Found" }, 404);
  }

  switch (url.pathname) {
    case "/api/v1/sync/crypto/generate-root-key":
      return Promise.resolve(syncCryptoService.generateRootKey())
        .then(jsonResponse)
        .catch(domainErrorResponse);
    case "/api/v1/sync/crypto/derive-dek":
      return handleJsonMutation(request, parseSyncDeriveDekRequest, (input) =>
        Promise.resolve(syncCryptoService.deriveDek(input.rootKey, input.version)),
      );
    case "/api/v1/sync/crypto/generate-keypair":
      return Promise.resolve(syncCryptoService.generateKeypair())
        .then(jsonResponse)
        .catch(domainErrorResponse);
    case "/api/v1/sync/crypto/compute-shared-secret":
      return handleJsonMutation(request, parseSyncComputeSharedSecretRequest, (input) =>
        Promise.resolve(syncCryptoService.computeSharedSecret(input.ourSecret, input.theirPublic)),
      );
    case "/api/v1/sync/crypto/derive-session-key":
      return handleJsonMutation(request, parseSyncDeriveSessionKeyRequest, (input) =>
        Promise.resolve(syncCryptoService.deriveSessionKey(input.sharedSecret, input.context)),
      );
    case "/api/v1/sync/crypto/encrypt":
      return handleJsonMutation(request, parseSyncEncryptRequest, (input) =>
        Promise.resolve(syncCryptoService.encrypt(input.key, input.plaintext)),
      );
    case "/api/v1/sync/crypto/decrypt":
      return handleJsonMutation(request, parseSyncDecryptRequest, (input) =>
        Promise.resolve(syncCryptoService.decrypt(input.key, input.ciphertext)),
      );
    case "/api/v1/sync/crypto/generate-pairing-code":
      return Promise.resolve(syncCryptoService.generatePairingCode())
        .then(jsonResponse)
        .catch(domainErrorResponse);
    case "/api/v1/sync/crypto/hash-pairing-code":
      return handleJsonMutation(request, parseSyncHashPairingCodeRequest, (input) =>
        Promise.resolve(syncCryptoService.hashPairingCode(input.code)),
      );
    case "/api/v1/sync/crypto/hmac-sha256":
      return handleJsonMutation(request, parseSyncHmacSha256Request, (input) =>
        Promise.resolve(syncCryptoService.hmacSha256(input.key, input.data)),
      );
    case "/api/v1/sync/crypto/compute-sas":
      return handleJsonMutation(request, parseSyncComputeSasRequest, (input) =>
        Promise.resolve(syncCryptoService.computeSas(input.sharedSecret)),
      );
    case "/api/v1/sync/crypto/generate-device-id":
      return Promise.resolve(syncCryptoService.generateDeviceId())
        .then(jsonResponse)
        .catch(domainErrorResponse);
    default:
      return jsonResponse({ code: 404, message: "Not Found" }, 404);
  }
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

function routePortfolioRequest(
  request: Request,
  url: URL,
  config: BackendRuntimeConfig,
  portfolioService: PortfolioService,
): Promise<Response> | Response {
  if (config.sidecarToken && !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/portfolios") {
    return handleServiceJsonResponse(() => portfolioService.listPortfolios());
  }

  if (request.method === "POST" && url.pathname === "/api/v1/portfolios") {
    return handleJsonMutation(request, parseNewPortfolio, (input) =>
      portfolioService.createPortfolio(input),
    );
  }

  const portfolioId = portfolioIdFromPath(url.pathname);
  if (portfolioId !== undefined) {
    if (portfolioId instanceof Response) {
      return portfolioId;
    }
    if (request.method === "GET") {
      return handleServiceJsonResponse(() => portfolioService.getPortfolio(portfolioId));
    }
    if (request.method === "PUT") {
      return handleJsonMutation(request, parsePortfolioUpdate, (input) =>
        portfolioService.updatePortfolio({ ...input, id: portfolioId }),
      );
    }
    if (request.method === "DELETE") {
      return Promise.resolve(portfolioService.deletePortfolio(portfolioId))
        .then(() => new Response(null, { status: 204 }))
        .catch(domainErrorResponse);
    }
  }

  return jsonResponse({ code: 404, message: "Not Found" }, 404);
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

function routeMarketDataRequest(
  request: Request,
  url: URL,
  config: BackendRuntimeConfig,
  marketDataService: MarketDataService,
  portfolioJobService?: PortfolioJobService,
): Promise<Response> | Response {
  if (config.sidecarToken && !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/exchanges") {
    return Promise.resolve(marketDataService.getExchanges())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/market-data/search") {
    const query = parseRequiredQueryString(url, "query");
    if (query instanceof Response) {
      return query;
    }
    return Promise.resolve(marketDataService.searchSymbol(query))
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/market-data/resolve-currency") {
    const input = parseResolveSymbolQuoteQuery(url);
    if (input instanceof Response) {
      return input;
    }
    return Promise.resolve(marketDataService.resolveSymbolQuote(input))
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/market-data/quotes/history") {
    const symbol = parseRequiredQueryString(url, "symbol");
    if (symbol instanceof Response) {
      return symbol;
    }
    return Promise.resolve(marketDataService.getQuoteHistory(symbol))
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/market-data/yahoo/dividends") {
    const symbol = parseRequiredQueryString(url, "symbol");
    if (symbol instanceof Response) {
      return symbol;
    }
    return Promise.resolve(marketDataService.fetchYahooDividends(symbol))
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/market-data/quotes/latest") {
    return handleJsonMutation(request, parseLatestQuotesRequest, (input) =>
      Promise.resolve(marketDataService.getLatestQuotes(input.assetIds)),
    );
  }

  const updateQuoteSymbol = marketDataQuoteSymbolFromPath(url.pathname);
  if (request.method === "PUT" && updateQuoteSymbol !== undefined) {
    return handleJsonMutationNoContent(
      request,
      (payload) => {
        return { symbol: updateQuoteSymbol, quote: { ...payload, asset_id: updateQuoteSymbol } };
      },
      async (input) => {
        await marketDataService.updateQuote(input.symbol, input.quote);
        enqueueFullPortfolioRecalculation(portfolioJobService, "Quote mutation");
      },
    );
  }

  const deleteQuoteId = marketDataQuoteIdFromPath(url.pathname);
  if (request.method === "DELETE" && deleteQuoteId !== undefined) {
    return Promise.resolve(marketDataService.deleteQuote(deleteQuoteId))
      .then(() => {
        enqueueFullPortfolioRecalculation(portfolioJobService, "Quote mutation");
        return new Response(null, { status: 204 });
      })
      .catch(domainErrorResponse);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/market-data/quotes/check") {
    return handleJsonMutation(request, parseQuotesCheckRequest, (input) =>
      Promise.resolve(marketDataService.checkQuotesImport(input.content, input.hasHeaderRow)),
    );
  }

  if (request.method === "POST" && url.pathname === "/api/v1/market-data/quotes/import") {
    return handleJsonMutation(request, parseQuotesImportRequest, async (input) => {
      const result = await marketDataService.importQuotesCsv(input.quotes, input.overwriteExisting);
      enqueueFullPortfolioRecalculation(portfolioJobService, "Quote mutation");
      return result;
    });
  }

  if (request.method === "POST" && url.pathname === "/api/v1/market-data/sync/history") {
    return Promise.resolve(marketDataService.syncHistoryQuotes())
      .then(() => new Response(null, { status: 204 }))
      .catch(domainErrorResponse);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/market-data/sync") {
    return handleJsonMutationNoContent(request, parseMarketDataSyncRequest, async (mode) => {
      if (portfolioJobService) {
        await portfolioJobService.enqueuePortfolioJob({
          accountIds: null,
          marketSyncMode: mode,
          snapshotMode: "incremental_from_last",
          valuationMode: "incremental_from_last",
          sinceDate: null,
        });
        return;
      }
      await marketDataService.syncMarketData(mode);
    });
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

  if (request.method === "GET" && url.pathname === "/api/v1/health/status") {
    return Promise.resolve(healthService.getHealthStatus(extractClientTimezone(request.headers)))
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/health/check") {
    return Promise.resolve(healthService.runHealthChecks(extractClientTimezone(request.headers)))
      .then(jsonResponse)
      .catch(domainErrorResponse);
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

  if (request.method === "POST" && url.pathname === "/api/v1/health/fix") {
    return handleHealthFixRequest(request, healthService);
  }

  return jsonResponse({ code: 404, message: "Not Found" }, 404);
}

async function handleHealthFixRequest(
  request: Request,
  healthService: HealthService,
): Promise<Response> {
  const payload = await parseJsonBody(request);
  if (payload instanceof Response) {
    return payload;
  }
  const action = parseHealthFixAction(payload);
  if (action instanceof Response) {
    return action;
  }

  try {
    await healthService.executeFix(action);
    return new Response(null, { status: 200 });
  } catch (error) {
    return domainErrorResponse(error);
  }
}

function extractClientTimezone(headers: Headers): string | undefined {
  const timezone = headers.get("x-client-timezone")?.trim();
  return timezone ? timezone : undefined;
}

function routeExchangeRateRequest(
  request: Request,
  url: URL,
  config: BackendRuntimeConfig,
  exchangeRateService: ExchangeRateService,
  portfolioJobService?: PortfolioJobService,
): Promise<Response> | Response {
  if (config.sidecarToken && !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/exchange-rates/latest") {
    return jsonResponse(exchangeRateService.getLatestExchangeRates());
  }

  if (request.method === "POST" && url.pathname === "/api/v1/exchange-rates") {
    return handleJsonMutation(request, parseNewExchangeRate, async (newRate) => {
      const result = await exchangeRateService.addExchangeRate(newRate);
      enqueueFullPortfolioRecalculation(portfolioJobService, "Exchange-rate mutation");
      return result;
    });
  }

  if (request.method === "PUT" && url.pathname === "/api/v1/exchange-rates") {
    return handleJsonMutation(request, parseExchangeRate, async (rate) => {
      const result = await exchangeRateService.updateExchangeRate(
        rate.fromCurrency,
        rate.toCurrency,
        rate.rate,
      );
      enqueueFullPortfolioRecalculation(portfolioJobService, "Exchange-rate mutation");
      return result;
    });
  }

  const rateId = exchangeRateIdFromPath(url.pathname);
  if (rateId && request.method === "DELETE") {
    return exchangeRateService
      .deleteExchangeRate(rateId)
      .then(() => {
        enqueueFullPortfolioRecalculation(portfolioJobService, "Exchange-rate mutation");
        return new Response(null, { status: 204 });
      })
      .catch(domainErrorResponse);
  }

  return jsonResponse({ code: 404, message: "Not Found" }, 404);
}

function routeGoalRequest(
  request: Request,
  url: URL,
  config: BackendRuntimeConfig,
  goalService: GoalService,
  goalValuationProvider?: GoalValuationProvider,
): Promise<Response> | Response {
  if (config.sidecarToken && !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  const fundingGoalId = goalFundingIdFromPath(url.pathname);
  if (fundingGoalId && request.method === "GET") {
    return jsonResponse(goalService.getGoalFunding(fundingGoalId));
  }
  if (fundingGoalId && request.method === "PUT") {
    return handleJsonArrayMutation(request, parseGoalFundingRuleInput, async (rules) => {
      const saved = await goalService.saveGoalFunding(fundingGoalId, rules);
      await refreshGoalSummaryAfterSave(goalService, goalValuationProvider, fundingGoalId);
      return saved;
    });
  }

  if (request.method === "POST" && url.pathname === "/api/v1/goals/plan") {
    return handleJsonMutation(request, parseSaveGoalPlan, async (plan) => {
      const normalizedPlan = normalizeGoalPlanCurrency(plan, goalService);
      const saved = await goalService.saveGoalPlan(normalizedPlan);
      await refreshGoalSummaryAfterSave(goalService, goalValuationProvider, normalizedPlan.goalId);
      return saved;
    });
  }

  if (request.method === "POST" && url.pathname === "/api/v1/goals/save-up/preview") {
    return handleJsonMutation(request, parseSaveUpInput, async (input) =>
      previewSaveUpOverview(input),
    );
  }

  if (request.method === "POST" && url.pathname === "/api/v1/goals/retirement/projection") {
    return handleRetirementProjectionRequest(request, goalService, goalValuationProvider);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/goals/retirement/monte-carlo") {
    return handleRetirementMonteCarloRequest(request, goalService, goalValuationProvider);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/goals/retirement/scenario-analysis") {
    return handleRetirementScenarioAnalysisRequest(request, goalService, goalValuationProvider);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/goals/retirement/stress-tests") {
    return handleRetirementStressTestsRequest(request, goalService, goalValuationProvider);
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/v1/goals/retirement/decision-sensitivity-map"
  ) {
    return handleRetirementDecisionSensitivityMapRequest(
      request,
      goalService,
      goalValuationProvider,
    );
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/v1/goals/retirement/sequence-of-returns"
  ) {
    return handleRetirementSorrRequest(request, goalService, goalValuationProvider);
  }

  const planGoalId = goalPlanIdFromPath(url.pathname);
  if (planGoalId && request.method === "GET") {
    return jsonResponse(goalService.getGoalPlan(planGoalId));
  }
  if (planGoalId && request.method === "DELETE") {
    return goalService
      .deleteGoalPlan(planGoalId)
      .then(() => new Response(null, { status: 204 }))
      .catch(domainErrorResponse);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/goals/refresh-summaries") {
    return handleGoalValuationRequest(goalValuationProvider, (valuationMap) =>
      refreshActiveGoalSummaries(goalService, valuationMap),
    );
  }

  const refreshGoalId = goalRefreshSummaryIdFromPath(url.pathname);
  if (refreshGoalId && request.method === "POST") {
    return handleGoalValuationRequest(goalValuationProvider, (valuationMap) =>
      goalService.refreshGoalSummary(refreshGoalId, valuationMap),
    );
  }

  const saveUpOverviewGoalId = goalSaveUpOverviewIdFromPath(url.pathname);
  if (saveUpOverviewGoalId && request.method === "GET") {
    return handleGoalValuationRequest(goalValuationProvider, (valuationMap) =>
      goalService.computeSaveUpOverview(saveUpOverviewGoalId, valuationMap),
    );
  }

  const retirementOverviewGoalId = goalRetirementOverviewIdFromPath(url.pathname);
  if (retirementOverviewGoalId && request.method === "GET") {
    return handleGoalValuationRequest(goalValuationProvider, (valuationMap) =>
      goalService.computeRetirementOverview(retirementOverviewGoalId, valuationMap),
    );
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

async function refreshGoalSummaryAfterSave(
  goalService: GoalService,
  provider: GoalValuationProvider | undefined,
  goalId: string,
): Promise<void> {
  if (!provider) {
    return;
  }
  let valuationMap: GoalValuationMap;
  try {
    valuationMap = await provider.getGoalValuationMap();
  } catch (error) {
    console.warn(
      `Failed to build valuation map after saving goal ${goalId}: ${errorMessage(error)}`,
    );
    return;
  }
  try {
    await goalService.refreshGoalSummary(goalId, valuationMap);
  } catch (error) {
    console.warn(`Failed to refresh goal summary after save for ${goalId}: ${errorMessage(error)}`);
  }
}

async function refreshActiveGoalSummaries(
  goalService: GoalService,
  valuationMap: GoalValuationMap,
): Promise<Goal[]> {
  const refreshed: Goal[] = [];
  for (const goal of goalService.getGoals().filter((item) => item.statusLifecycle === "active")) {
    try {
      refreshed.push(await goalService.refreshGoalSummary(goal.id, valuationMap));
    } catch (error) {
      console.debug(`Failed to refresh goal ${goal.id}: ${errorMessage(error)}`);
    }
  }
  return refreshed;
}

async function handleGoalValuationRequest<T>(
  provider: GoalValuationProvider | undefined,
  handle: (valuationMap: GoalValuationMap) => Promise<T>,
): Promise<Response> {
  if (!provider) {
    return jsonResponse(
      {
        code: "configuration_error",
        message: "Goal valuation provider is required for valuation-backed goal routes",
      },
      500,
    );
  }
  let valuationMap: GoalValuationMap;
  try {
    valuationMap = await provider.getGoalValuationMap();
  } catch (error) {
    return jsonResponse(
      { code: 503, message: error instanceof Error ? error.message : String(error) },
      503,
    );
  }
  try {
    return jsonResponse(await handle(valuationMap));
  } catch (error) {
    return domainErrorResponse(error);
  }
}

async function handleRetirementProjectionRequest(
  request: Request,
  goalService: GoalService,
  provider: GoalValuationProvider | undefined,
): Promise<Response> {
  const payload = await parseJsonBody(request);
  if (payload instanceof Response) {
    return payload;
  }
  const parsed = parseRetirementSimulationRequest(payload);
  if (parsed instanceof Response) {
    return parsed;
  }
  if (parsed.goalId) {
    const goalId = parsed.goalId;
    return handleGoalValuationRequest(provider, async (valuationMap) => {
      const prepared = await goalService.prepareRetirementInput(goalId, valuationMap);
      return projectRetirementWithMode(
        prepared.plan,
        prepared.currentPortfolio,
        prepared.plannerMode,
      );
    });
  }
  try {
    const plan = normalizedRetirementPlanFromPayload(parsed.plan);
    return jsonResponse(
      projectRetirementWithMode(plan, parsed.currentPortfolio, parsed.plannerMode ?? "fire"),
    );
  } catch (error) {
    return domainErrorResponse(error);
  }
}

async function handleRetirementMonteCarloRequest(
  request: Request,
  goalService: GoalService,
  provider: GoalValuationProvider | undefined,
): Promise<Response> {
  const payload = await parseJsonBody(request);
  if (payload instanceof Response) {
    return payload;
  }
  const parsed = parseRetirementMonteCarloRequest(payload);
  if (parsed instanceof Response) {
    return parsed;
  }
  if (parsed.goalId) {
    const goalId = parsed.goalId;
    return handleGoalValuationRequest(provider, async (valuationMap) => {
      const prepared = await goalService.prepareRetirementInput(goalId, valuationMap);
      return runMonteCarloWithModeAndSeed(
        prepared.plan,
        prepared.currentPortfolio,
        parsed.nSims,
        prepared.plannerMode,
        parsed.seed,
      );
    });
  }
  try {
    const plan = normalizedRetirementPlanFromPayload(parsed.plan);
    return jsonResponse(
      runMonteCarloWithModeAndSeed(
        plan,
        parsed.currentPortfolio,
        parsed.nSims,
        parsed.plannerMode ?? "fire",
        parsed.seed,
      ),
    );
  } catch (error) {
    return domainErrorResponse(error);
  }
}

async function handleRetirementScenarioAnalysisRequest(
  request: Request,
  goalService: GoalService,
  provider: GoalValuationProvider | undefined,
): Promise<Response> {
  const payload = await parseJsonBody(request);
  if (payload instanceof Response) {
    return payload;
  }
  const parsed = parseRetirementSimulationRequest(payload);
  if (parsed instanceof Response) {
    return parsed;
  }
  if (parsed.goalId) {
    const goalId = parsed.goalId;
    return handleGoalValuationRequest(provider, async (valuationMap) => {
      const prepared = await goalService.prepareRetirementInput(goalId, valuationMap);
      return runScenarioAnalysisWithMode(
        prepared.plan,
        prepared.currentPortfolio,
        prepared.plannerMode,
      );
    });
  }
  try {
    const plan = normalizedRetirementPlanFromPayload(parsed.plan);
    return jsonResponse(
      runScenarioAnalysisWithMode(plan, parsed.currentPortfolio, parsed.plannerMode ?? "fire"),
    );
  } catch (error) {
    return domainErrorResponse(error);
  }
}

async function handleRetirementStressTestsRequest(
  request: Request,
  goalService: GoalService,
  provider: GoalValuationProvider | undefined,
): Promise<Response> {
  const payload = await parseJsonBody(request);
  if (payload instanceof Response) {
    return payload;
  }
  const parsed = parseRetirementSimulationRequest(payload);
  if (parsed instanceof Response) {
    return parsed;
  }
  if (parsed.goalId) {
    const goalId = parsed.goalId;
    return handleGoalValuationRequest(provider, async (valuationMap) => {
      const prepared = await goalService.prepareRetirementInput(goalId, valuationMap);
      return runStressTestsWithMode(prepared.plan, prepared.currentPortfolio, prepared.plannerMode);
    });
  }
  try {
    const plan = normalizedRetirementPlanFromPayload(parsed.plan);
    return jsonResponse(
      runStressTestsWithMode(plan, parsed.currentPortfolio, parsed.plannerMode ?? "fire"),
    );
  } catch (error) {
    return domainErrorResponse(error);
  }
}

async function handleRetirementDecisionSensitivityMapRequest(
  request: Request,
  goalService: GoalService,
  provider: GoalValuationProvider | undefined,
): Promise<Response> {
  const payload = await parseJsonBody(request);
  if (payload instanceof Response) {
    return payload;
  }
  const parsed = parseRetirementDecisionSensitivityMapRequest(payload);
  if (parsed instanceof Response) {
    return parsed;
  }
  if (parsed.goalId) {
    const goalId = parsed.goalId;
    return handleGoalValuationRequest(provider, async (valuationMap) => {
      const prepared = await goalService.prepareRetirementInput(goalId, valuationMap);
      return runDecisionSensitivityMatrixWithMode(
        prepared.plan,
        prepared.currentPortfolio,
        prepared.plannerMode,
        parsed.map,
      );
    });
  }
  try {
    const plan = normalizedRetirementPlanFromPayload(parsed.plan);
    return jsonResponse(
      runDecisionSensitivityMatrixWithMode(
        plan,
        parsed.currentPortfolio,
        parsed.plannerMode ?? "fire",
        parsed.map,
      ),
    );
  } catch (error) {
    return domainErrorResponse(error);
  }
}

async function handleRetirementSorrRequest(
  request: Request,
  goalService: GoalService,
  provider: GoalValuationProvider | undefined,
): Promise<Response> {
  const payload = await parseJsonBody(request);
  if (payload instanceof Response) {
    return payload;
  }
  const parsed = parseRetirementSorrRequest(payload);
  if (parsed instanceof Response) {
    return parsed;
  }
  if (parsed.goalId) {
    const goalId = parsed.goalId;
    return handleGoalValuationRequest(provider, async (valuationMap) => {
      const prepared = await goalService.prepareRetirementInput(goalId, valuationMap);
      return runSorr(prepared.plan, parsed.portfolioAtFire, parsed.retirementStartAge);
    });
  }
  try {
    const plan = normalizedRetirementPlanFromPayload(parsed.plan);
    return jsonResponse(runSorr(plan, parsed.portfolioAtFire, parsed.retirementStartAge));
  } catch (error) {
    return domainErrorResponse(error);
  }
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

  if (request.method === "POST" && url.pathname === "/api/v1/custom-providers/test-source") {
    return handleJsonMutation(request, parseTestSourceRequest, (payload) =>
      customProviderService.testSource(payload),
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

  if (request.method === "GET" && url.pathname === "/api/v1/taxonomies/migration/status") {
    return Promise.resolve(taxonomyService.getMigrationStatus())
      .then(jsonResponse)
      .catch(domainErrorResponse);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/taxonomies/migration/run") {
    return Promise.resolve(taxonomyService.migrateLegacyClassifications())
      .then(jsonResponse)
      .catch(domainErrorResponse);
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
  healthService?: HealthService,
  portfolioJobService?: PortfolioJobService,
): Promise<Response> {
  if (config.sidecarToken && !sidecarTokenAuthorized(request.headers, config.sidecarToken)) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }
  if (request.method === "GET" && url.pathname === "/api/v1/settings") {
    return jsonResponse(settingsService.getSettings());
  }
  if (request.method === "PUT" && url.pathname === "/api/v1/settings") {
    const payload = await parseJsonBody(request);
    if (payload instanceof Response) {
      return payload;
    }
    const update = parseSettingsUpdate(payload);
    if (update instanceof Response) {
      return update;
    }
    try {
      const previous = settingsService.getSettings();
      const updated = await settingsService.updateSettings(update);
      clearHealthCacheBestEffort(healthService, "Settings update");
      enqueueSettingsPortfolioRecalculation(portfolioJobService, previous, updated);
      return jsonResponse(updated);
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

function enqueueSettingsPortfolioRecalculation(
  portfolioJobService: PortfolioJobService | undefined,
  previous: Pick<Settings, "baseCurrency" | "timezone">,
  updated: Pick<Settings, "baseCurrency" | "timezone">,
): void {
  if (updated.baseCurrency !== previous.baseCurrency) {
    enqueuePortfolioJobBestEffort(
      portfolioJobService,
      {
        accountIds: null,
        marketSyncMode: { type: "backfill_history", asset_ids: null, days: DEFAULT_HISTORY_DAYS },
        snapshotMode: "full",
        valuationMode: "full",
        sinceDate: null,
      },
      "Base currency change",
    );
    return;
  }

  if (updated.timezone !== previous.timezone) {
    enqueueFullPortfolioRecalculation(portfolioJobService, "Timezone change");
  }
}

function clearHealthCacheBestEffort(
  healthService: HealthService | undefined,
  context: string,
): void {
  if (!healthService) {
    return;
  }
  try {
    healthService.clearCache();
  } catch (error) {
    console.warn(`${context} health cache clear failed: ${errorMessage(error)}`);
  }
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

function activityIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/v1\/activities\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function isAiChatPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/v1/ai/chat") ||
    pathname.startsWith("/api/v1/ai/threads") ||
    pathname === "/api/v1/ai/tool-result"
  );
}

function aiThreadIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/v1\/ai\/threads\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function aiThreadMessagesIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/v1\/ai\/threads\/([^/]+)\/messages$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function aiThreadTagRouteFromPath(
  pathname: string,
): { threadId: string; tag?: string } | undefined {
  const itemMatch = /^\/api\/v1\/ai\/threads\/([^/]+)\/tags\/([^/]+)$/.exec(pathname);
  if (itemMatch) {
    return {
      threadId: decodeURIComponent(itemMatch[1]),
      tag: decodeURIComponent(itemMatch[2]),
    };
  }
  const listMatch = /^\/api\/v1\/ai\/threads\/([^/]+)\/tags$/.exec(pathname);
  return listMatch ? { threadId: decodeURIComponent(listMatch[1]) } : undefined;
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

function marketDataQuoteSymbolFromPath(pathname: string): string | undefined {
  const match = /^\/api\/v1\/market-data\/quotes\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function marketDataQuoteIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/v1\/market-data\/quotes\/id\/([^/]+)$/.exec(pathname);
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

function goalRefreshSummaryIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/v1\/goals\/([^/]+)\/refresh-summary$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function goalSaveUpOverviewIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/v1\/goals\/([^/]+)\/save-up\/overview$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function goalRetirementOverviewIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/v1\/goals\/([^/]+)\/retirement\/overview$/.exec(pathname);
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

async function serveStaticFile(
  staticDir: string,
  pathname: string,
  method: string,
): Promise<Response | null> {
  const root = path.resolve(staticDir);
  const requested = safeStaticPath(root, pathname);
  if (requested === null) {
    return null;
  }

  const direct = Bun.file(requested);
  if (await direct.exists()) {
    return staticFileResponse(direct, requested, method);
  }

  if (path.extname(requested) !== "") {
    return null;
  }

  const indexPath = path.join(root, "index.html");
  const index = Bun.file(indexPath);
  return (await index.exists()) ? staticFileResponse(index, indexPath, method) : null;
}

function safeStaticPath(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) {
    return null;
  }
  const relative = decoded.replace(/^\/+/, "") || "index.html";
  const resolved = path.resolve(root, relative);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
}

function staticFileResponse(file: Bun.BunFile, filePath: string, method: string): Response {
  const headers = new Headers();
  const contentType = contentTypeForPath(filePath);
  if (contentType) {
    headers.set("content-type", contentType);
  }
  return new Response(method === "HEAD" ? null : file, { headers });
}

function contentTypeForPath(filePath: string): string | null {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    default:
      return null;
  }
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
  if (isHttpStatusError(error)) {
    return jsonResponse({ code: error.code ?? error.status, message: error.message }, error.status);
  }
  return jsonResponse(
    { code: 400, message: error instanceof Error ? error.message : String(error) },
    400,
  );
}

function isHttpStatusError(error: unknown): error is Error & { status: number; code?: string } {
  return (
    error instanceof Error &&
    "status" in error &&
    typeof error.status === "number" &&
    Number.isInteger(error.status) &&
    error.status >= 400 &&
    error.status <= 599
  );
}

function handleServiceJsonResponse(
  operation: () => Promise<unknown> | unknown,
): Promise<Response> | Response {
  try {
    return Promise.resolve(operation()).then(jsonResponse).catch(domainErrorResponse);
  } catch (error) {
    return domainErrorResponse(error);
  }
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

async function handleAiChatJsonMutation<TInput, TOutput>(
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
    return aiChatErrorResponse(error);
  }
}

async function handleAiChatJsonMutationNoContent<TInput>(
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
    return aiChatErrorResponse(error);
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

function parseHealthFixAction(payload: Record<string, unknown>): HealthFixAction | Response {
  const id = parseRequiredString(payload.id, "id");
  if (id instanceof Response) {
    return id;
  }
  const label = parseRequiredString(payload.label, "label");
  if (label instanceof Response) {
    return label;
  }
  if (!Object.hasOwn(payload, "payload")) {
    return jsonResponse({ code: 400, message: "payload is required" }, 400);
  }
  return { id, label, payload: payload.payload };
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

type AccountScope =
  | { type: "TotalSnapshot" }
  | { type: "Account"; accountId: string }
  | { type: "Accounts"; accountIds: string[] }
  | { type: "Portfolio"; portfolioId: string };

const PORTFOLIO_TOTAL_ACCOUNT_ID = "TOTAL";

function normalizeAccountScope(filter: Record<string, unknown>): AccountScope | Response {
  const filterType = filter.type;

  if (filterType === "TotalSnapshot" || filterType === "all") {
    return { type: "TotalSnapshot" };
  }

  if (filterType === "Portfolio" || filterType === "portfolio") {
    const portfolioId = parseRequiredString(filter.portfolioId, "portfolioId for Portfolio scope");
    if (portfolioId instanceof Response) {
      return portfolioId;
    }
    return { type: "Portfolio", portfolioId };
  }

  if (filterType === "Account" || filterType === "account") {
    const accountId = parseRequiredString(filter.accountId, "accountId for Account scope");
    if (accountId instanceof Response) {
      return accountId;
    }
    return { type: "Account", accountId };
  }

  if (filterType === "Accounts" || filterType === "accounts") {
    if (!Array.isArray(filter.accountIds)) {
      return jsonResponse(
        { code: 400, message: "Missing or invalid 'accountIds' for Accounts scope" },
        400,
      );
    }
    const accountIds: string[] = [];
    for (const id of filter.accountIds) {
      if (typeof id !== "string") {
        return jsonResponse({ code: 400, message: "All 'accountIds' must be strings" }, 400);
      }
      accountIds.push(id);
    }
    return { type: "Accounts", accountIds };
  }

  return jsonResponse({ code: 400, message: `Unknown filter type: ${String(filterType)}` }, 400);
}

function resolveAccountScopeIds(
  filter: Extract<AccountScope, { type: "Accounts" | "Portfolio" }>,
  portfolioService?: PortfolioService,
): string[] {
  if (filter.type === "Accounts") {
    return filter.accountIds;
  }
  if (!portfolioService) {
    throw new Error("Portfolio service not available for portfolio account scope");
  }
  return portfolioService.getPortfolio(filter.portfolioId).accountIds;
}

interface IncomeSummaryQuery {
  filter?: AccountScope;
}

interface HoldingsQuery {
  filter: AccountScope;
}

interface AllocationHoldingsQuery {
  filter: AccountScope;
  taxonomyId: string;
  categoryId: string;
}

function parseIncomeSummaryQuery(payload: Record<string, unknown>): IncomeSummaryQuery | Response {
  if (payload.filter === undefined || payload.filter === null) {
    return {};
  }

  if (typeof payload.filter !== "object" || Array.isArray(payload.filter)) {
    return jsonResponse({ code: 400, message: "Invalid 'filter' field" }, 400);
  }

  const normalizedFilter = normalizeAccountScope(payload.filter as Record<string, unknown>);
  if (normalizedFilter instanceof Response) {
    return normalizedFilter;
  }

  return { filter: normalizedFilter };
}

function parseHoldingsQuery(payload: Record<string, unknown>): HoldingsQuery | Response {
  if (!payload.filter || typeof payload.filter !== "object" || Array.isArray(payload.filter)) {
    return jsonResponse({ code: 400, message: "Missing or invalid 'filter' field" }, 400);
  }

  const normalizedFilter = normalizeAccountScope(payload.filter as Record<string, unknown>);
  if (normalizedFilter instanceof Response) {
    return normalizedFilter;
  }

  return { filter: normalizedFilter };
}

function parseAllocationHoldingsQuery(
  payload: Record<string, unknown>,
): AllocationHoldingsQuery | Response {
  if (!payload.filter || typeof payload.filter !== "object" || Array.isArray(payload.filter)) {
    return jsonResponse({ code: 400, message: "Missing or invalid 'filter' field" }, 400);
  }

  const taxonomyId = parseRequiredString(payload.taxonomyId, "taxonomyId");
  if (taxonomyId instanceof Response) {
    return taxonomyId;
  }

  const categoryId = parseRequiredString(payload.categoryId, "categoryId");
  if (categoryId instanceof Response) {
    return categoryId;
  }

  const normalizedFilter = normalizeAccountScope(payload.filter as Record<string, unknown>);
  if (normalizedFilter instanceof Response) {
    return normalizedFilter;
  }

  return { filter: normalizedFilter, taxonomyId, categoryId };
}

function parseActivitySearchRequest(
  payload: Record<string, unknown>,
): ActivitySearchRequest | Response {
  const page = parseRequiredInteger(payload.page, "page");
  if (page instanceof Response) {
    return page;
  }
  const pageSize = parseRequiredInteger(payload.pageSize, "pageSize");
  if (pageSize instanceof Response) {
    return pageSize;
  }
  const accountIds = parseOptionalStringOrArray(payload.accountIdFilter, "accountIdFilter");
  if (accountIds instanceof Response) {
    return accountIds;
  }
  const activityTypes = parseOptionalStringOrArray(
    payload.activityTypeFilter,
    "activityTypeFilter",
  );
  if (activityTypes instanceof Response) {
    return activityTypes;
  }
  const instrumentTypes = parseOptionalStringOrArray(
    payload.instrumentTypeFilter,
    "instrumentTypeFilter",
  );
  if (instrumentTypes instanceof Response) {
    return instrumentTypes;
  }
  const assetIdKeyword = parseOptionalStringOrNull(payload.assetIdKeyword, "assetIdKeyword");
  if (assetIdKeyword instanceof Response) {
    return assetIdKeyword;
  }
  const sort = parseOptionalActivitySort(payload.sort, "sort");
  if (sort instanceof Response) {
    return sort;
  }
  const needsReview = parseOptionalBooleanOrNull(payload.needsReviewFilter, "needsReviewFilter");
  if (needsReview instanceof Response) {
    return needsReview;
  }
  const dateFrom = parseOptionalDateBody(payload.dateFrom, "dateFrom");
  if (dateFrom instanceof Response) {
    return dateFrom;
  }
  const dateTo = parseOptionalDateBody(payload.dateTo, "dateTo");
  if (dateTo instanceof Response) {
    return dateTo;
  }

  const parsed: ActivitySearchRequest = { page, pageSize };
  if (accountIds !== undefined) {
    parsed.accountIds = accountIds;
  }
  if (activityTypes !== undefined) {
    parsed.activityTypes = activityTypes;
  }
  if (instrumentTypes !== undefined) {
    parsed.instrumentTypes = instrumentTypes;
  }
  if (assetIdKeyword !== undefined && assetIdKeyword !== null) {
    parsed.assetIdKeyword = assetIdKeyword;
  }
  if (sort !== undefined) {
    parsed.sort = sort;
  }
  if (needsReview !== undefined && needsReview !== null) {
    parsed.needsReview = needsReview;
  }
  if (dateFrom !== undefined) {
    parsed.dateFrom = dateFrom;
  }
  if (dateTo !== undefined) {
    parsed.dateTo = dateTo;
  }
  return parsed;
}

function parseOptionalStringOrArray(
  value: unknown,
  field: string,
): string[] | undefined | Response {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    return [value];
  }
  const parsed = parseRequiredStringArray(value, field);
  if (parsed instanceof Response) {
    return parsed;
  }
  return parsed;
}

function parseOptionalActivitySort(
  value: unknown,
  field: string,
): ActivitySearchRequest["sort"] | undefined | Response {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (Array.isArray(value)) {
    const parsed = value.map((item, index) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        return jsonResponse({ code: 400, message: `${field}[${index}] must be an object` }, 400);
      }
      return parseActivitySort(item as Record<string, unknown>, `${field}[${index}]`);
    });
    const error = parsed.find((item) => item instanceof Response);
    if (error instanceof Response) {
      return error;
    }
    return parsed[0] as ActivitySearchRequest["sort"] | undefined;
  }
  if (typeof value !== "object") {
    return jsonResponse({ code: 400, message: `${field} must be an object or array` }, 400);
  }
  return parseActivitySort(value as Record<string, unknown>, field);
}

function parseActivitySort(
  payload: Record<string, unknown>,
  field: string,
): NonNullable<ActivitySearchRequest["sort"]> | Response {
  const id = parseRequiredString(payload.id, `${field}.id`);
  if (id instanceof Response) {
    return id;
  }
  const desc = parseRequiredBoolean(payload.desc, `${field}.desc`);
  if (desc instanceof Response) {
    return desc;
  }
  return { id, desc };
}

function passThroughObject(payload: Record<string, unknown>): Record<string, unknown> {
  return payload;
}

function parseTransferActivitiesRequest(
  payload: Record<string, unknown>,
): { activityAId: string; activityBId: string } | Response {
  const activityAId = parseRequiredString(payload.activityAId, "activityAId");
  if (activityAId instanceof Response) {
    return activityAId;
  }
  const activityBId = parseRequiredString(payload.activityBId, "activityBId");
  if (activityBId instanceof Response) {
    return activityBId;
  }
  return { activityAId, activityBId };
}

function parseActivitiesArrayRequest(
  payload: Record<string, unknown>,
): { activities: unknown[] } | Response {
  if (!Array.isArray(payload.activities)) {
    return jsonResponse({ code: 400, message: "activities must be an array" }, 400);
  }
  return { activities: payload.activities };
}

function parseImportCandidatesRequest(
  payload: Record<string, unknown>,
): { candidates: unknown[] } | Response {
  if (!Array.isArray(payload.candidates)) {
    return jsonResponse({ code: 400, message: "candidates must be an array" }, 400);
  }
  return { candidates: payload.candidates };
}

async function handleActivityCsvParseRequest(
  request: Request,
  parseCsv: (request: ActivityParseCsvRequest) => Promise<unknown> | unknown,
): Promise<Response> {
  const input = await parseActivityCsvParseRequest(request);
  if (input instanceof Response) {
    return input;
  }
  try {
    return jsonResponse(await parseCsv(input));
  } catch (error) {
    return domainErrorResponse(error);
  }
}

async function parseActivityCsvParseRequest(
  request: Request,
): Promise<ActivityParseCsvRequest | Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (error) {
    return jsonResponse(
      { code: 400, message: `Failed to read multipart request: ${errorMessage(error)}` },
      400,
    );
  }

  const file = formData.get("file");
  if (file === null) {
    return jsonResponse({ code: 400, message: "Missing file in multipart request" }, 400);
  }
  const content = await formDataValueBytes(file);
  const configValue = formData.get("config");
  if (configValue === null) {
    return { content, config: {} };
  }
  const configBytes = await formDataValueBytes(configValue);
  try {
    const config = JSON.parse(new TextDecoder().decode(configBytes));
    if (typeof config !== "object" || config === null || Array.isArray(config)) {
      return jsonResponse({ code: 400, message: "Invalid config JSON" }, 400);
    }
    return { content, config: config as Record<string, unknown> };
  } catch (error) {
    return jsonResponse({ code: 400, message: `Invalid config JSON: ${errorMessage(error)}` }, 400);
  }
}

async function formDataValueBytes(value: FormDataEntryValue): Promise<Uint8Array> {
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }
  return new Uint8Array(await value.arrayBuffer());
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseActivityImportMappingQuery(
  url: URL,
): { accountId: string; contextKind: string } | Response {
  const accountId = parseRequiredQueryString(url, "accountId");
  if (accountId instanceof Response) {
    return accountId;
  }
  return {
    accountId,
    contextKind: url.searchParams.get("contextKind") ?? ACTIVITY_IMPORT_CONTEXT_KIND,
  };
}

function isConnectBrokerPath(pathname: string): boolean {
  const connectPath = pathname === "/api/v1/connect" || pathname.startsWith("/api/v1/connect/");
  return connectPath && !isConnectDevicePath(pathname);
}

function isConnectDevicePath(pathname: string): boolean {
  return pathname === "/api/v1/connect/device" || pathname.startsWith("/api/v1/connect/device/");
}

function isDeviceSyncDeviceManagementPath(pathname: string): boolean {
  return pathname === "/api/v1/sync/devices" || pathname.startsWith("/api/v1/sync/device/");
}

function isDeviceSyncTeamKeyPath(pathname: string): boolean {
  return (
    pathname === "/api/v1/sync/keys/initialize" ||
    pathname === "/api/v1/sync/keys/initialize/commit" ||
    pathname === "/api/v1/sync/keys/rotate" ||
    pathname === "/api/v1/sync/keys/rotate/commit" ||
    pathname === "/api/v1/sync/team/reset"
  );
}

function isDeviceSyncPairingPath(pathname: string): boolean {
  return pathname === "/api/v1/sync/pairing" || pathname.startsWith("/api/v1/sync/pairing/");
}

function deviceSyncDeviceIdFromPath(pathname: string): string | Response | undefined {
  const match = /^\/api\/v1\/sync\/device\/([^/]+)$/.exec(pathname);
  if (!match || isReservedDeviceSyncDeviceId(match[1])) {
    return undefined;
  }
  return decodePathSegment(match[1]);
}

function deviceSyncRevokeDeviceIdFromPath(pathname: string): string | Response | undefined {
  const match = /^\/api\/v1\/sync\/device\/([^/]+)\/revoke$/.exec(pathname);
  if (!match || isReservedDeviceSyncDeviceId(match[1])) {
    return undefined;
  }
  return decodePathSegment(match[1]);
}

function isReservedDeviceSyncDeviceId(value: string): boolean {
  return value === "register" || value === "current";
}

function portfolioIdFromPath(pathname: string): string | Response | undefined {
  const match = /^\/api\/v1\/portfolios\/([^/]+)$/.exec(pathname);
  if (!match) {
    return undefined;
  }
  return decodePathSegment(match[1]);
}

function deviceSyncPairingIdFromPath(pathname: string): string | Response | undefined {
  const match = /^\/api\/v1\/sync\/pairing\/([^/]+)$/.exec(pathname);
  if (!match || isReservedDeviceSyncPairingId(match[1])) {
    return undefined;
  }
  return decodePathSegment(match[1]);
}

function deviceSyncPairingMessagesIdFromPath(pathname: string): string | Response | undefined {
  return deviceSyncPairingSubrouteIdFromPath(pathname, "messages");
}

function deviceSyncPairingApproveIdFromPath(pathname: string): string | Response | undefined {
  return deviceSyncPairingSubrouteIdFromPath(pathname, "approve");
}

function deviceSyncPairingCompleteIdFromPath(pathname: string): string | Response | undefined {
  return deviceSyncPairingSubrouteIdFromPath(pathname, "complete");
}

function deviceSyncPairingCancelIdFromPath(pathname: string): string | Response | undefined {
  return deviceSyncPairingSubrouteIdFromPath(pathname, "cancel");
}

function deviceSyncPairingConfirmIdFromPath(pathname: string): string | Response | undefined {
  return deviceSyncPairingSubrouteIdFromPath(pathname, "confirm");
}

function deviceSyncPairingSubrouteIdFromPath(
  pathname: string,
  subroute: string,
): string | Response | undefined {
  const match = new RegExp(`^/api/v1/sync/pairing/([^/]+)/${subroute}$`).exec(pathname);
  if (!match || isReservedDeviceSyncPairingId(match[1])) {
    return undefined;
  }
  return decodePathSegment(match[1]);
}

function isReservedDeviceSyncPairingId(value: string): boolean {
  return (
    value === "claim" ||
    value === "complete-with-transfer" ||
    value === "confirm-with-bootstrap" ||
    value === "flow"
  );
}

function decodePathSegment(value: string): string | Response {
  try {
    return decodeURIComponent(value);
  } catch {
    return jsonResponse({ code: 400, message: "Invalid path parameter encoding" }, 400);
  }
}

async function handleConnectStoreSessionRequest(
  request: Request,
  connectService: ConnectService,
): Promise<Response> {
  const payload = await parseJsonBody(request);
  if (payload instanceof Response) {
    return payload;
  }
  const refreshToken = parseRequiredString(payload.refreshToken, "refreshToken");
  if (refreshToken instanceof Response) {
    return refreshToken;
  }
  try {
    await connectService.storeSyncSession(refreshToken);
    return jsonResponse(null);
  } catch (error) {
    return domainErrorResponse(error);
  }
}

function connectSyncBrokerDataResponse(result: ConnectSyncBrokerDataResult): Response {
  const status = result.status;
  switch (status) {
    case "accepted":
      return new Response(null, { status: 202 });
    case "forbidden":
      return new Response(null, { status: 403 });
    case "not_implemented":
      return new Response(null, { status: 501 });
  }
  return jsonResponse(
    { code: 400, message: `Unsupported Connect sync status: ${String(status)}` },
    400,
  );
}

function parseConnectImportRunsQuery(url: URL): ConnectImportRunsRequest | Response {
  const limit = parseOptionalIntegerQuery(url, "limit");
  if (limit instanceof Response) {
    return limit;
  }
  const offset = parseOptionalIntegerQuery(url, "offset");
  if (offset instanceof Response) {
    return offset;
  }
  const runType = url.searchParams.has("runType") ? url.searchParams.get("runType") : undefined;
  return {
    runType: runType ?? undefined,
    limit: limit ?? 50,
    offset: offset ?? 0,
  };
}

function parseOptionalIntegerQuery(url: URL, field: string): number | undefined | Response {
  const value = url.searchParams.get(field);
  if (value === null) {
    return undefined;
  }
  if (!/^[-+]?\d+$/.test(value)) {
    return jsonResponse({ code: 400, message: `${field} must be an integer` }, 400);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    return jsonResponse({ code: 400, message: `${field} must be an integer` }, 400);
  }
  return parsed;
}

function parseConnectBrokerSyncProfileQuery(
  url: URL,
): { accountId: string; sourceSystem: string } | Response {
  const accountId = parseRequiredQueryString(url, "accountId");
  if (accountId instanceof Response) {
    return accountId;
  }
  const sourceSystem = parseRequiredQueryString(url, "sourceSystem");
  if (sourceSystem instanceof Response) {
    return sourceSystem;
  }
  return { accountId, sourceSystem };
}

function parseConnectDeviceSyncReconcileReadyRequest(
  payload: Record<string, unknown>,
): ConnectDeviceSyncReconcileReadyRequest | Response {
  const allowOverwrite = payload.allowOverwrite ?? false;
  if (typeof allowOverwrite !== "boolean") {
    return jsonResponse({ code: 400, message: "allowOverwrite must be a boolean" }, 400);
  }
  return { allowOverwrite };
}

function parseRegisterDeviceRequest(
  payload: Record<string, unknown>,
): RegisterDeviceRequest | Response {
  const displayName = parseRequiredString(payload.displayName, "displayName");
  if (displayName instanceof Response) {
    return displayName;
  }
  const platform = parseRequiredString(payload.platform, "platform");
  if (platform instanceof Response) {
    return platform;
  }
  const osVersion = parseOptionalStringOrNull(payload.osVersion, "osVersion");
  if (osVersion instanceof Response) {
    return osVersion;
  }
  const appVersion = parseOptionalStringOrNull(payload.appVersion, "appVersion");
  if (appVersion instanceof Response) {
    return appVersion;
  }
  const instanceId = parseRequiredString(payload.instanceId, "instanceId");
  if (instanceId instanceof Response) {
    return instanceId;
  }
  return {
    displayName,
    platform,
    osVersion: osVersion ?? undefined,
    appVersion: appVersion ?? undefined,
    instanceId,
  };
}

function parseUpdateDeviceRequest(
  payload: Record<string, unknown>,
): UpdateDeviceRequest | Response {
  const displayName = parseOptionalStringOrNull(payload.displayName, "displayName");
  if (displayName instanceof Response) {
    return displayName;
  }
  return { displayName: displayName ?? undefined };
}

function parseCommitInitializeTeamKeysRequest(
  payload: Record<string, unknown>,
): CommitInitializeTeamKeysRequest | Response {
  const keyVersion = parseRequiredI32(payload.keyVersion, "keyVersion");
  if (keyVersion instanceof Response) {
    return keyVersion;
  }
  const deviceKeyEnvelope = parseRequiredString(payload.deviceKeyEnvelope, "deviceKeyEnvelope");
  if (deviceKeyEnvelope instanceof Response) {
    return deviceKeyEnvelope;
  }
  const signature = parseRequiredString(payload.signature, "signature");
  if (signature instanceof Response) {
    return signature;
  }
  const challengeResponse = parseOptionalStringOrNull(
    payload.challengeResponse,
    "challengeResponse",
  );
  if (challengeResponse instanceof Response) {
    return challengeResponse;
  }
  const recoveryEnvelope = parseOptionalStringOrNull(payload.recoveryEnvelope, "recoveryEnvelope");
  if (recoveryEnvelope instanceof Response) {
    return recoveryEnvelope;
  }
  return {
    keyVersion,
    deviceKeyEnvelope,
    signature,
    challengeResponse: challengeResponse ?? undefined,
    recoveryEnvelope: recoveryEnvelope ?? undefined,
  };
}

function parseCommitRotateTeamKeysRequest(
  payload: Record<string, unknown>,
): CommitRotateTeamKeysRequest | Response {
  const newKeyVersion = parseRequiredI32(payload.newKeyVersion, "newKeyVersion");
  if (newKeyVersion instanceof Response) {
    return newKeyVersion;
  }
  if (!Array.isArray(payload.envelopes)) {
    return jsonResponse({ code: 400, message: "envelopes must be an array" }, 400);
  }
  const envelopes: CommitRotateTeamKeysRequest["envelopes"] = [];
  for (const [index, value] of payload.envelopes.entries()) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return jsonResponse({ code: 400, message: `envelopes[${index}] must be an object` }, 400);
    }
    const envelope = value as Record<string, unknown>;
    const deviceId = parseRequiredString(envelope.deviceId, `envelopes[${index}].deviceId`);
    if (deviceId instanceof Response) {
      return deviceId;
    }
    const deviceKeyEnvelope = parseRequiredString(
      envelope.deviceKeyEnvelope,
      `envelopes[${index}].deviceKeyEnvelope`,
    );
    if (deviceKeyEnvelope instanceof Response) {
      return deviceKeyEnvelope;
    }
    envelopes.push({ deviceId, deviceKeyEnvelope });
  }
  const signature = parseRequiredString(payload.signature, "signature");
  if (signature instanceof Response) {
    return signature;
  }
  const challengeResponse = parseOptionalStringOrNull(
    payload.challengeResponse,
    "challengeResponse",
  );
  if (challengeResponse instanceof Response) {
    return challengeResponse;
  }
  return {
    newKeyVersion,
    envelopes,
    signature,
    challengeResponse: challengeResponse ?? undefined,
  };
}

function parseResetTeamSyncRequest(
  payload: Record<string, unknown>,
): ResetTeamSyncRequest | Response {
  const reason = parseOptionalStringOrNull(payload.reason, "reason");
  if (reason instanceof Response) {
    return reason;
  }
  return { reason: reason ?? undefined };
}

function parseCreatePairingRequest(
  payload: Record<string, unknown>,
): CreatePairingRequest | Response {
  const codeHash = parseRequiredString(payload.codeHash, "codeHash");
  if (codeHash instanceof Response) {
    return codeHash;
  }
  const ephemeralPublicKey = parseRequiredString(payload.ephemeralPublicKey, "ephemeralPublicKey");
  if (ephemeralPublicKey instanceof Response) {
    return ephemeralPublicKey;
  }
  return { codeHash, ephemeralPublicKey };
}

function parseCompletePairingRequest(
  payload: Record<string, unknown>,
): CompletePairingRequest | Response {
  const encryptedKeyBundle = parseRequiredString(payload.encryptedKeyBundle, "encryptedKeyBundle");
  if (encryptedKeyBundle instanceof Response) {
    return encryptedKeyBundle;
  }
  const sasProof = parseRequiredJsonValue(payload, "sasProof");
  if (sasProof instanceof Response) {
    return sasProof;
  }
  const signature = parseRequiredString(payload.signature, "signature");
  if (signature instanceof Response) {
    return signature;
  }
  return { encryptedKeyBundle, sasProof, signature };
}

function parseClaimPairingRequest(
  payload: Record<string, unknown>,
): ClaimPairingRequest | Response {
  const code = parseRequiredString(payload.code, "code");
  if (code instanceof Response) {
    return code;
  }
  const ephemeralPublicKey = parseRequiredString(payload.ephemeralPublicKey, "ephemeralPublicKey");
  if (ephemeralPublicKey instanceof Response) {
    return ephemeralPublicKey;
  }
  return { code, ephemeralPublicKey };
}

function parseConfirmPairingRequest(
  payload: Record<string, unknown>,
): ConfirmPairingRequest | Response {
  const proof = parseRequiredString(payload.proof, "proof");
  if (proof instanceof Response) {
    return proof;
  }
  const minSnapshotCreatedAt = parseOptionalStringOrNull(
    payload.minSnapshotCreatedAt,
    "minSnapshotCreatedAt",
  );
  if (minSnapshotCreatedAt instanceof Response) {
    return minSnapshotCreatedAt;
  }
  return { proof, minSnapshotCreatedAt: minSnapshotCreatedAt ?? undefined };
}

function parseCompletePairingWithTransferRequest(
  payload: Record<string, unknown>,
): CompletePairingWithTransferRequest | Response {
  const pairingId = parseRequiredString(payload.pairingId, "pairingId");
  if (pairingId instanceof Response) {
    return pairingId;
  }
  const complete = parseCompletePairingRequest(payload);
  if (complete instanceof Response) {
    return complete;
  }
  return { pairingId, ...complete };
}

function parseConfirmPairingWithBootstrapRequest(
  payload: Record<string, unknown>,
): ConfirmPairingWithBootstrapRequest | Response {
  const pairingId = parseRequiredString(payload.pairingId, "pairingId");
  if (pairingId instanceof Response) {
    return pairingId;
  }
  const proof = parseOptionalStringOrNull(payload.proof, "proof");
  if (proof instanceof Response) {
    return proof;
  }
  const minSnapshotCreatedAt = parseOptionalStringOrNull(
    payload.minSnapshotCreatedAt,
    "minSnapshotCreatedAt",
  );
  if (minSnapshotCreatedAt instanceof Response) {
    return minSnapshotCreatedAt;
  }
  const allowOverwrite = parseRequiredBoolean(payload.allowOverwrite, "allowOverwrite");
  if (allowOverwrite instanceof Response) {
    return allowOverwrite;
  }
  return {
    pairingId,
    proof: proof ?? undefined,
    minSnapshotCreatedAt: minSnapshotCreatedAt ?? undefined,
    allowOverwrite,
  };
}

function parseBeginPairingConfirmRequest(
  payload: Record<string, unknown>,
): BeginPairingConfirmRequest | Response {
  const pairingId = parseRequiredString(payload.pairingId, "pairingId");
  if (pairingId instanceof Response) {
    return pairingId;
  }
  const proof = parseRequiredString(payload.proof, "proof");
  if (proof instanceof Response) {
    return proof;
  }
  const minSnapshotCreatedAt = parseOptionalStringOrNull(
    payload.minSnapshotCreatedAt,
    "minSnapshotCreatedAt",
  );
  if (minSnapshotCreatedAt instanceof Response) {
    return minSnapshotCreatedAt;
  }
  return { pairingId, proof, minSnapshotCreatedAt: minSnapshotCreatedAt ?? undefined };
}

function parsePairingFlowIdRequest(
  payload: Record<string, unknown>,
): PairingFlowIdRequest | Response {
  const flowId = parseRequiredString(payload.flowId, "flowId");
  if (flowId instanceof Response) {
    return flowId;
  }
  return { flowId };
}

function parseRequiredJsonValue(
  payload: Record<string, unknown>,
  field: string,
): unknown | Response {
  if (!Object.hasOwn(payload, field)) {
    return jsonResponse({ code: 400, message: `${field} is required` }, 400);
  }
  return payload[field];
}

function parseWrappedObject<TField extends string>(
  field: TField,
): (payload: Record<string, unknown>) => Record<TField, Record<string, unknown>> | Response {
  return (payload) => {
    const value = payload[field];
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return jsonResponse({ code: 400, message: `${field} must be an object` }, 400);
    }
    return { [field]: value as Record<string, unknown> } as Record<TField, Record<string, unknown>>;
  };
}

function parseLinkAccountTemplateRequest(
  payload: Record<string, unknown>,
): { accountId: string; templateId: string; contextKind: string } | Response {
  const accountId = parseRequiredString(payload.accountId, "accountId");
  if (accountId instanceof Response) {
    return accountId;
  }
  const templateId = parseRequiredString(payload.templateId, "templateId");
  if (templateId instanceof Response) {
    return templateId;
  }
  const contextKind = parseOptionalStringOrNull(payload.contextKind, "contextKind");
  if (contextKind instanceof Response) {
    return contextKind;
  }
  return { accountId, templateId, contextKind: contextKind ?? ACTIVITY_IMPORT_CONTEXT_KIND };
}

function parseCheckDuplicatesRequest(
  payload: Record<string, unknown>,
): { idempotencyKeys: string[] } | Response {
  const idempotencyKeys = parseRequiredStringArray(payload.idempotencyKeys, "idempotencyKeys");
  if (idempotencyKeys instanceof Response) {
    return idempotencyKeys;
  }
  return { idempotencyKeys };
}

async function handleAiChatStreamRequest(
  request: Request,
  aiChatService: AiChatService,
): Promise<Response> {
  const payload = await parseJsonBody(request);
  if (payload instanceof Response) {
    return payload;
  }
  try {
    const events = await aiChatService.sendMessage(payload);
    return new Response(createAiChatNdjsonStream(events), {
      status: 200,
      headers: {
        "cache-control": "no-cache",
        connection: "keep-alive",
        "content-type": "application/x-ndjson",
      },
    });
  } catch (error) {
    return aiChatErrorResponse(error);
  }
}

function createAiChatNdjsonStream(events: AsyncIterable<unknown>): ReadableStream<Uint8Array> {
  const iterator = events[Symbol.asyncIterator]();
  const encoder = new TextEncoder();
  let done = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (done) {
        return;
      }
      try {
        const result = await iterator.next();
        if (result.done) {
          done = true;
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(`${serializeAiChatStreamEvent(result.value)}\n`));
      } catch (error) {
        done = true;
        controller.enqueue(encoder.encode(`${serializeAiChatStreamErrorEvent(error)}\n`));
        controller.close();
      }
    },
    async cancel() {
      done = true;
      await iterator.return?.();
    },
  });
}

function serializeAiChatStreamEvent(event: unknown): string {
  try {
    const serialized = JSON.stringify(event);
    if (typeof serialized === "string") {
      return serialized;
    }
    return aiChatSerializationErrorEvent("Event serialized to undefined");
  } catch (error) {
    return aiChatSerializationErrorEvent(errorMessage(error));
  }
}

function aiChatSerializationErrorEvent(message: string): string {
  return JSON.stringify({
    type: "error",
    threadId: "",
    runId: "",
    messageId: null,
    code: "serialization_error",
    message,
  });
}

function serializeAiChatStreamErrorEvent(error: unknown): string {
  return JSON.stringify({
    type: "error",
    threadId: "",
    runId: "",
    messageId: null,
    code: aiChatErrorCode(error, "internal_error"),
    message: aiChatErrorMessage(error),
  });
}

function parseAiChatListThreadsQuery(url: URL): AiChatListThreadsRequest | Response {
  const limit = parseOptionalU32Query(url, "limit");
  if (limit instanceof Response) {
    return limit;
  }
  const request: AiChatListThreadsRequest = {};
  if (url.searchParams.has("cursor")) {
    request.cursor = url.searchParams.get("cursor") ?? "";
  }
  if (limit !== undefined) {
    request.limit = limit;
  }
  if (url.searchParams.has("search")) {
    request.search = url.searchParams.get("search") ?? "";
  }
  return request;
}

function parseOptionalU32Query(url: URL, field: string): number | undefined | Response {
  if (!url.searchParams.has(field)) {
    return undefined;
  }
  const value = url.searchParams.get(field) ?? "";
  if (!/^\d+$/.test(value)) {
    return jsonResponse({ code: 400, message: `${field} must be an unsigned integer` }, 400);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 4_294_967_295) {
    return jsonResponse({ code: 400, message: `${field} must be a u32 integer` }, 400);
  }
  return parsed;
}

function parseAiChatUpdateThreadRequest(
  payload: Record<string, unknown>,
): AiChatUpdateThreadRequest | Response {
  const title = parseOptionalStringOrNull(payload.title, "title");
  if (title instanceof Response) {
    return title;
  }
  const isPinned = parseOptionalBooleanOrNull(payload.isPinned, "isPinned");
  if (isPinned instanceof Response) {
    return isPinned;
  }
  const request: AiChatUpdateThreadRequest = {};
  if (title !== undefined && title !== null) {
    request.title = title;
  }
  if (isPinned !== undefined && isPinned !== null) {
    request.isPinned = isPinned;
  }
  return request;
}

function parseAiChatTagRequest(payload: Record<string, unknown>): { tag: string } | Response {
  const tag = parseRequiredString(payload.tag, "tag");
  if (tag instanceof Response) {
    return tag;
  }
  return { tag };
}

function parseAiChatUpdateToolResultRequest(
  payload: Record<string, unknown>,
): AiChatUpdateToolResultRequest | Response {
  const threadId = parseRequiredString(payload.threadId, "threadId");
  if (threadId instanceof Response) {
    return threadId;
  }
  const toolCallId = parseRequiredString(payload.toolCallId, "toolCallId");
  if (toolCallId instanceof Response) {
    return toolCallId;
  }
  if (!Object.hasOwn(payload, "resultPatch")) {
    return jsonResponse({ code: 400, message: "resultPatch is required" }, 400);
  }
  return { threadId, toolCallId, resultPatch: payload.resultPatch };
}

function aiChatErrorResponse(error: unknown): Response {
  const status = aiChatErrorStatus(error);
  return jsonResponse(
    {
      code: aiChatErrorCode(error, "bad_request"),
      error: aiChatErrorMessage(error),
    },
    status,
  );
}

function aiChatErrorStatus(error: unknown): number {
  const shaped = aiChatErrorShape(error);
  if (
    typeof shaped?.status === "number" &&
    Number.isInteger(shaped.status) &&
    shaped.status >= 400 &&
    shaped.status <= 599
  ) {
    return shaped.status;
  }
  const code = aiChatErrorCode(error, "");
  return AI_CHAT_ERROR_STATUS_BY_CODE[code] ?? 400;
}

function aiChatErrorCode(error: unknown, fallback: string): string {
  const shaped = aiChatErrorShape(error);
  return typeof shaped?.code === "string" && shaped.code ? shaped.code : fallback;
}

function aiChatErrorMessage(error: unknown): string {
  const shaped = aiChatErrorShape(error);
  if (typeof shaped?.error === "string") {
    return shaped.error;
  }
  if (typeof shaped?.message === "string") {
    return shaped.message;
  }
  return String(error);
}

function aiChatErrorShape(error: unknown): AiChatServiceErrorShape | undefined {
  return typeof error === "object" && error !== null
    ? (error as AiChatServiceErrorShape)
    : undefined;
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
    return parseRequiredByteArray(payload.zipData, "zipData");
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

function parseResolveSymbolQuoteQuery(url: URL): ResolveSymbolQuoteRequest | Response {
  const symbol = parseRequiredQueryString(url, "symbol");
  if (symbol instanceof Response) {
    return symbol;
  }
  const parsed: ResolveSymbolQuoteRequest = { symbol };
  const optionalFields = [
    ["exchangeMic", "exchangeMic"],
    ["instrumentType", "instrumentType"],
    ["quoteCcy", "quoteCcy"],
    ["providerId", "providerId"],
  ] as const;
  for (const [queryField, targetField] of optionalFields) {
    const value = url.searchParams.get(queryField);
    if (value !== null) {
      parsed[targetField] = value;
    }
  }
  return parsed;
}

function parseLatestQuotesRequest(
  payload: Record<string, unknown>,
): { assetIds: string[] } | Response {
  const assetIds = parseRequiredStringArray(payload.assetIds, "assetIds");
  if (assetIds instanceof Response) {
    return assetIds;
  }
  return { assetIds };
}

function parseQuotesCheckRequest(
  payload: Record<string, unknown>,
): { content: Uint8Array; hasHeaderRow: boolean } | Response {
  const content = parseRequiredByteArray(payload.content, "content");
  if (content instanceof Response) {
    return content;
  }
  const hasHeaderRow = parseRequiredBoolean(payload.hasHeaderRow, "hasHeaderRow");
  if (hasHeaderRow instanceof Response) {
    return hasHeaderRow;
  }
  return { content, hasHeaderRow };
}

function parseQuotesImportRequest(
  payload: Record<string, unknown>,
): { quotes: unknown[]; overwriteExisting: boolean } | Response {
  if (!Array.isArray(payload.quotes)) {
    return jsonResponse({ code: 400, message: "quotes must be an array" }, 400);
  }
  const overwriteExisting = parseRequiredBoolean(payload.overwriteExisting, "overwriteExisting");
  if (overwriteExisting instanceof Response) {
    return overwriteExisting;
  }
  return { quotes: payload.quotes, overwriteExisting };
}

function parseMarketDataSyncRequest(payload: Record<string, unknown>): MarketSyncMode | Response {
  const assetIds = parseOptionalStringArrayOrNull(payload.assetIds, "assetIds");
  if (assetIds instanceof Response) {
    return assetIds;
  }
  const refetchAll = parseRequiredBoolean(payload.refetchAll, "refetchAll");
  if (refetchAll instanceof Response) {
    return refetchAll;
  }
  const refetchRecentDays = parseOptionalIntegerOrNull(
    payload.refetchRecentDays,
    "refetchRecentDays",
  );
  if (refetchRecentDays instanceof Response) {
    return refetchRecentDays;
  }

  if (refetchRecentDays !== undefined && refetchRecentDays !== null) {
    return { type: "refetch_recent", asset_ids: assetIds ?? null, days: refetchRecentDays };
  }
  if (refetchAll) {
    return { type: "backfill_history", asset_ids: assetIds ?? null, days: DEFAULT_HISTORY_DAYS };
  }
  return { type: "incremental", asset_ids: assetIds ?? null };
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

function parseSyncDeriveDekRequest(
  payload: Record<string, unknown>,
): { rootKey: string; version: number } | Response {
  const rootKey = parseRequiredString(payload.rootKey, "rootKey");
  if (rootKey instanceof Response) {
    return rootKey;
  }
  const version = parseRequiredU32(payload.version, "version");
  if (version instanceof Response) {
    return version;
  }
  return { rootKey, version };
}

function parseSyncComputeSharedSecretRequest(
  payload: Record<string, unknown>,
): { ourSecret: string; theirPublic: string } | Response {
  const ourSecret = parseRequiredString(payload.ourSecret, "ourSecret");
  if (ourSecret instanceof Response) {
    return ourSecret;
  }
  const theirPublic = parseRequiredString(payload.theirPublic, "theirPublic");
  if (theirPublic instanceof Response) {
    return theirPublic;
  }
  return { ourSecret, theirPublic };
}

function parseSyncDeriveSessionKeyRequest(
  payload: Record<string, unknown>,
): { sharedSecret: string; context: string } | Response {
  const sharedSecret = parseRequiredString(payload.sharedSecret, "sharedSecret");
  if (sharedSecret instanceof Response) {
    return sharedSecret;
  }
  const context = parseRequiredString(payload.context, "context");
  if (context instanceof Response) {
    return context;
  }
  return { sharedSecret, context };
}

function parseSyncEncryptRequest(
  payload: Record<string, unknown>,
): { key: string; plaintext: string } | Response {
  const key = parseRequiredString(payload.key, "key");
  if (key instanceof Response) {
    return key;
  }
  const plaintext = parseRequiredString(payload.plaintext, "plaintext");
  if (plaintext instanceof Response) {
    return plaintext;
  }
  return { key, plaintext };
}

function parseSyncDecryptRequest(
  payload: Record<string, unknown>,
): { key: string; ciphertext: string } | Response {
  const key = parseRequiredString(payload.key, "key");
  if (key instanceof Response) {
    return key;
  }
  const ciphertext = parseRequiredString(payload.ciphertext, "ciphertext");
  if (ciphertext instanceof Response) {
    return ciphertext;
  }
  return { key, ciphertext };
}

function parseSyncHashPairingCodeRequest(
  payload: Record<string, unknown>,
): { code: string } | Response {
  const code = parseRequiredString(payload.code, "code");
  if (code instanceof Response) {
    return code;
  }
  return { code };
}

function parseSyncHmacSha256Request(
  payload: Record<string, unknown>,
): { key: string; data: string } | Response {
  const key = parseRequiredString(payload.key, "key");
  if (key instanceof Response) {
    return key;
  }
  const data = parseRequiredString(payload.data, "data");
  if (data instanceof Response) {
    return data;
  }
  return { key, data };
}

function parseSyncComputeSasRequest(
  payload: Record<string, unknown>,
): { sharedSecret: string } | Response {
  const sharedSecret = parseRequiredString(payload.sharedSecret, "sharedSecret");
  if (sharedSecret instanceof Response) {
    return sharedSecret;
  }
  return { sharedSecret };
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

function parseNewPortfolio(payload: Record<string, unknown>): NewPortfolio | Response {
  const name = parseRequiredString(payload.name, "name");
  if (name instanceof Response) {
    return name;
  }
  const description = parseOptionalStringOrNull(payload.description, "description");
  if (description instanceof Response) {
    return description;
  }
  const sortOrder = parseOptionalPortfolioSortOrder(payload.sortOrder);
  if (sortOrder instanceof Response) {
    return sortOrder;
  }
  const accountIds = parseRequiredStringArray(payload.accountIds, "accountIds");
  if (accountIds instanceof Response) {
    return accountIds;
  }
  return {
    name,
    description: description ?? null,
    sortOrder,
    accountIds,
  };
}

function parsePortfolioUpdate(
  payload: Record<string, unknown>,
): Omit<PortfolioUpdate, "id"> | Response {
  const parsed = parseNewPortfolio(payload);
  if (parsed instanceof Response) {
    return parsed;
  }
  return parsed;
}

function parseOptionalPortfolioSortOrder(value: unknown): number | Response {
  if (value === undefined) {
    return 0;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return jsonResponse({ code: 400, message: "sortOrder must be an integer" }, 400);
  }
  return value;
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

function parseSaveGoalPlan(payload: Record<string, unknown>): SaveGoalPlan | Response {
  const goalId = parseRequiredString(payload.goalId, "goalId");
  if (goalId instanceof Response) {
    return goalId;
  }
  const planKind = parseRequiredString(payload.planKind, "planKind");
  if (planKind instanceof Response) {
    return planKind;
  }
  const settingsJson = parseRequiredString(payload.settingsJson, "settingsJson");
  if (settingsJson instanceof Response) {
    return settingsJson;
  }
  const plannerMode = parseOptionalStringOrNull(payload.plannerMode, "plannerMode");
  if (plannerMode instanceof Response) {
    return plannerMode;
  }
  const summaryJson = parseOptionalStringOrNull(payload.summaryJson, "summaryJson");
  if (summaryJson instanceof Response) {
    return summaryJson;
  }
  return {
    goalId,
    planKind,
    plannerMode,
    settingsJson,
    summaryJson,
  };
}

function parseSaveUpInput(payload: Record<string, unknown>): SaveUpInput | Response {
  const currentValue = parseRequiredNumber(payload.currentValue, "currentValue");
  if (currentValue instanceof Response) {
    return currentValue;
  }
  const targetAmount = parseRequiredNumber(payload.targetAmount, "targetAmount");
  if (targetAmount instanceof Response) {
    return targetAmount;
  }
  const targetDate = parseOptionalStringOrNull(payload.targetDate, "targetDate");
  if (targetDate instanceof Response) {
    return targetDate;
  }
  const monthlyContribution = parseRequiredNumber(
    payload.monthlyContribution,
    "monthlyContribution",
  );
  if (monthlyContribution instanceof Response) {
    return monthlyContribution;
  }
  const expectedAnnualReturn = parseRequiredNumber(
    payload.expectedAnnualReturn,
    "expectedAnnualReturn",
  );
  if (expectedAnnualReturn instanceof Response) {
    return expectedAnnualReturn;
  }
  return {
    currentValue,
    targetAmount,
    targetDate: targetDate ?? null,
    monthlyContribution,
    expectedAnnualReturn,
  };
}

function parseRetirementSimulationRequest(
  payload: Record<string, unknown>,
): RetirementSimulationRequest | Response {
  const plan = parseRequiredRecord(payload.plan, "plan");
  if (plan instanceof Response) {
    return plan;
  }
  const currentPortfolio = parseRequiredNumber(payload.currentPortfolio, "currentPortfolio");
  if (currentPortfolio instanceof Response) {
    return currentPortfolio;
  }
  const goalId = parseOptionalStringOrNull(payload.goalId, "goalId");
  if (goalId instanceof Response) {
    return goalId;
  }
  const plannerMode = parseOptionalRetirementTimingMode(payload.plannerMode, "plannerMode");
  if (plannerMode instanceof Response) {
    return plannerMode;
  }
  return {
    plan,
    currentPortfolio,
    ...(goalId ? { goalId } : {}),
    ...(plannerMode ? { plannerMode } : {}),
  };
}

function parseRetirementMonteCarloRequest(
  payload: Record<string, unknown>,
): RetirementMonteCarloRequest | Response {
  const parsed = parseRetirementSimulationRequest(payload);
  if (parsed instanceof Response) {
    return parsed;
  }
  const nSims = parseOptionalU32(payload.nSims, "nSims");
  if (nSims instanceof Response) {
    return nSims;
  }
  const seed = parseOptionalU64Seed(payload.seed, "seed");
  if (seed instanceof Response) {
    return seed;
  }
  return {
    ...parsed,
    nSims: normalizeRetirementSimulationCount(nSims),
    ...(seed === undefined ? {} : { seed }),
  };
}

function parseRetirementSorrRequest(
  payload: Record<string, unknown>,
): RetirementSorrRequest | Response {
  const plan = parseRequiredRecord(payload.plan, "plan");
  if (plan instanceof Response) {
    return plan;
  }
  const portfolioAtFire = parseRequiredNumber(payload.portfolioAtFire, "portfolioAtFire");
  if (portfolioAtFire instanceof Response) {
    return portfolioAtFire;
  }
  const retirementStartAge = parseRequiredU32(payload.retirementStartAge, "retirementStartAge");
  if (retirementStartAge instanceof Response) {
    return retirementStartAge;
  }
  const goalId = parseOptionalStringOrNull(payload.goalId, "goalId");
  if (goalId instanceof Response) {
    return goalId;
  }
  return {
    plan,
    portfolioAtFire,
    retirementStartAge,
    ...(goalId ? { goalId } : {}),
  };
}

function parseRetirementDecisionSensitivityMapRequest(
  payload: Record<string, unknown>,
): RetirementDecisionSensitivityMapRequest | Response {
  const parsed = parseRetirementSimulationRequest(payload);
  if (parsed instanceof Response) {
    return parsed;
  }
  const map = parseDecisionSensitivityMap(payload.map, "map");
  if (map instanceof Response) {
    return map;
  }
  return { ...parsed, map };
}

function parseDecisionSensitivityMap(
  value: unknown,
  field: string,
): DecisionSensitivityMap | Response {
  if (value === "contribution-return" || value === "retirement-age-spending") {
    return value;
  }
  return jsonResponse(
    { code: 400, message: `${field} must be 'contribution-return' or 'retirement-age-spending'` },
    400,
  );
}

function parseOptionalRetirementTimingMode(
  value: unknown,
  field: string,
): RetirementTimingMode | undefined | Response {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value === "fire" || value === "traditional") {
    return value;
  }
  return jsonResponse({ code: 400, message: `${field} must be 'fire' or 'traditional'` }, 400);
}

function normalizedRetirementPlanFromPayload(payload: Record<string, unknown>): RetirementPlan {
  const normalized = parseValidateAndNormalizeRetirementPlanSettings(JSON.stringify(payload));
  if (!isRetirementPlanRecord(normalized.settings)) {
    throw new Error(
      "Invalid input: Invalid retirement plan JSON: retirement plan must be an object",
    );
  }
  return normalized.settings;
}

function isRetirementPlanRecord(value: unknown): value is RetirementPlan {
  return (
    isPlainRecord(value) &&
    isPlainRecord(value.personal) &&
    isPlainRecord(value.expenses) &&
    Array.isArray(value.incomeStreams) &&
    isPlainRecord(value.investment) &&
    (value.tax === undefined || value.tax === null || isPlainRecord(value.tax)) &&
    typeof value.currency === "string"
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function normalizeGoalPlanCurrency(plan: SaveGoalPlan, goalService: GoalService): SaveGoalPlan {
  const baseCurrency = goalService.getBaseCurrency();
  if (plan.planKind !== "retirement" || !baseCurrency) {
    return plan;
  }
  let settings: unknown;
  try {
    settings = JSON.parse(plan.settingsJson);
  } catch {
    return plan;
  }
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
    return plan;
  }
  return {
    ...plan,
    settingsJson: JSON.stringify({ ...settings, currency: baseCurrency }),
  };
}

function parseTestSourceRequest(payload: Record<string, unknown>): TestSourceRequest | Response {
  const format = parseRequiredString(payload.format, "format");
  if (format instanceof Response) {
    return format;
  }
  const url = parseRequiredString(payload.url, "url");
  if (url instanceof Response) {
    return url;
  }
  const pricePath = parseRequiredString(payload.pricePath, "pricePath");
  if (pricePath instanceof Response) {
    return pricePath;
  }
  const symbol = parseRequiredString(payload.symbol, "symbol");
  if (symbol instanceof Response) {
    return symbol;
  }
  const datePath = parseOptionalStringOrNull(payload.datePath, "datePath");
  if (datePath instanceof Response) {
    return datePath;
  }
  const dateFormat = parseOptionalStringOrNull(payload.dateFormat, "dateFormat");
  if (dateFormat instanceof Response) {
    return dateFormat;
  }
  const currencyPath = parseOptionalStringOrNull(payload.currencyPath, "currencyPath");
  if (currencyPath instanceof Response) {
    return currencyPath;
  }
  const factor = parseOptionalNumberOrNull(payload.factor, "factor");
  if (factor instanceof Response) {
    return factor;
  }
  const invert = parseOptionalBooleanOrNull(payload.invert, "invert");
  if (invert instanceof Response) {
    return invert;
  }
  const locale = parseOptionalStringOrNull(payload.locale, "locale");
  if (locale instanceof Response) {
    return locale;
  }
  const headers = parseOptionalStringOrNull(payload.headers, "headers");
  if (headers instanceof Response) {
    return headers;
  }
  const currency = parseOptionalStringOrNull(payload.currency, "currency");
  if (currency instanceof Response) {
    return currency;
  }
  const from = parseOptionalStringOrNull(payload.from, "from");
  if (from instanceof Response) {
    return from;
  }
  const to = parseOptionalStringOrNull(payload.to, "to");
  if (to instanceof Response) {
    return to;
  }
  const openPath = parseOptionalStringOrNull(payload.openPath, "openPath");
  if (openPath instanceof Response) {
    return openPath;
  }
  const highPath = parseOptionalStringOrNull(payload.highPath, "highPath");
  if (highPath instanceof Response) {
    return highPath;
  }
  const lowPath = parseOptionalStringOrNull(payload.lowPath, "lowPath");
  if (lowPath instanceof Response) {
    return lowPath;
  }
  const volumePath = parseOptionalStringOrNull(payload.volumePath, "volumePath");
  if (volumePath instanceof Response) {
    return volumePath;
  }
  const defaultPrice = parseOptionalNumberOrNull(payload.defaultPrice, "defaultPrice");
  if (defaultPrice instanceof Response) {
    return defaultPrice;
  }
  const dateTimezone = parseOptionalStringOrNull(payload.dateTimezone, "dateTimezone");
  if (dateTimezone instanceof Response) {
    return dateTimezone;
  }

  return {
    format: format as TestSourceRequest["format"],
    url,
    pricePath,
    datePath,
    dateFormat,
    currencyPath,
    factor,
    invert,
    locale,
    headers,
    symbol,
    currency,
    from,
    to,
    openPath,
    highPath,
    lowPath,
    volumePath,
    defaultPrice,
    dateTimezone,
  };
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

function parseRequiredRecord(value: unknown, field: string): Record<string, unknown> | Response {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return jsonResponse({ code: 400, message: `${field} must be an object` }, 400);
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

function parseRequiredStringArray(value: unknown, field: string): string[] | Response {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return jsonResponse({ code: 400, message: `${field} must be an array of strings` }, 400);
  }
  return value;
}

function parseRequiredByteArray(value: unknown, field: string): Uint8Array | Response {
  if (
    !Array.isArray(value) ||
    value.some(
      (byte) => typeof byte !== "number" || !Number.isInteger(byte) || byte < 0 || byte > 255,
    )
  ) {
    return jsonResponse({ code: 400, message: `${field} must be an array of bytes` }, 400);
  }
  return new Uint8Array(value);
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

function parseOptionalU32(value: unknown, field: string): number | undefined | Response {
  if (value === undefined || value === null) {
    return undefined;
  }
  const parsed = parseRequiredU32(value, field);
  if (parsed instanceof Response) {
    return parsed;
  }
  return parsed;
}

function parseOptionalU64Seed(value: unknown, field: string): bigint | undefined | Response {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > Number.MAX_SAFE_INTEGER
  ) {
    return jsonResponse(
      { code: 400, message: `${field} must be a non-negative safe integer` },
      400,
    );
  }
  return BigInt(value);
}

function normalizeRetirementSimulationCount(value: number | undefined): number {
  return Math.min(
    Math.max(value ?? DEFAULT_RETIREMENT_MONTE_CARLO_SIMULATIONS, 1),
    MAX_RETIREMENT_MONTE_CARLO_SIMULATIONS,
  );
}

function parseRequiredU32(value: unknown, field: string): number | Response {
  const parsed = parseRequiredInteger(value, field);
  if (parsed instanceof Response) {
    return parsed;
  }
  if (parsed < 0 || parsed > 4_294_967_295) {
    return jsonResponse({ code: 400, message: `${field} must be a u32 integer` }, 400);
  }
  return parsed;
}

function parseRequiredI32(value: unknown, field: string): number | Response {
  const parsed = parseRequiredInteger(value, field);
  if (parsed instanceof Response) {
    return parsed;
  }
  if (parsed < -2_147_483_648 || parsed > 2_147_483_647) {
    return jsonResponse({ code: 400, message: `${field} must be an i32 integer` }, 400);
  }
  return parsed;
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
