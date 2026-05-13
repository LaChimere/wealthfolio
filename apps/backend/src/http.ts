import type { BackendRuntimeConfig } from "./config";
import type { AccountService, AccountUpdate, NewAccount } from "./domains/accounts";
import { parseTrackingMode } from "./domains/accounts";
import type { ContributionLimitService, NewContributionLimit } from "./domains/contribution-limits";
import type {
  CustomProviderService,
  NewCustomProvider,
  NewCustomProviderSource,
  UpdateCustomProvider,
} from "./domains/custom-providers";
import type { Goal, GoalFundingRuleInput, GoalService, NewGoal } from "./domains/goals";
import type { SettingsService, SettingsUpdate } from "./domains/settings";
import type {
  NewAssetTaxonomyAssignment,
  NewTaxonomy,
  NewTaxonomyCategory,
  Taxonomy,
  TaxonomyCategory,
  TaxonomyService,
} from "./domains/taxonomies";
import { sidecarTokenAuthorized } from "./sidecar-auth";

export interface BackendRequestHandlerOptions {
  includeDebugRoutes?: boolean;
  debugDelayMs?: number;
  accountService?: AccountService;
  contributionLimitService?: ContributionLimitService;
  customProviderService?: CustomProviderService;
  goalService?: GoalService;
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

  if (options.goalService && url.pathname.startsWith("/api/v1/goals")) {
    return routeGoalRequest(request, url, config, options.goalService);
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
  if (request.method === "GET" && url.pathname === "/api/v1/settings/auto-update") {
    return jsonResponse(settingsService.isAutoUpdateCheckEnabled());
  }
  return jsonResponse({ code: 404, message: "Not Found" }, 404);
}

function accountIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/v1\/accounts\/([^/]+)$/.exec(pathname);
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
