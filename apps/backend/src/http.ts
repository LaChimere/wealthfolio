import type { BackendRuntimeConfig } from "./config";
import type { SettingsService, SettingsUpdate } from "./domains/settings";
import { sidecarTokenAuthorized } from "./sidecar-auth";

export interface BackendRequestHandlerOptions {
  includeDebugRoutes?: boolean;
  debugDelayMs?: number;
  settingsService?: SettingsService;
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
