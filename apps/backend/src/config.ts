export interface ListenAddress {
  host: string;
  port: number;
}

export interface CorsConfig {
  allowOrigins: string[];
}

export interface BackendRuntimeConfig {
  listen: ListenAddress;
  cors: CorsConfig;
  requestTimeoutMs: number;
  secretKey: Uint8Array;
  sidecarToken?: string;
  authPasswordHash?: string;
}

const DEFAULT_LISTEN_ADDR = "0.0.0.0:8088";
const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;

export function loadBackendConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): BackendRuntimeConfig {
  const listen = parseListenAddress(env.WF_LISTEN_ADDR ?? DEFAULT_LISTEN_ADDR);
  const cors = parseCors(env.WF_CORS_ALLOW_ORIGINS);
  const requestTimeoutMs = parseRequestTimeoutMs(env.WF_REQUEST_TIMEOUT_MS);
  const secretKey = decodeSecretKey(parseRequiredNonEmpty(env.WF_SECRET_KEY, "WF_SECRET_KEY"));
  const sidecarToken = parseOptionalNonEmpty(env.WF_SIDECAR_TOKEN, "WF_SIDECAR_TOKEN");
  const authPasswordHash = parseOptionalNonEmpty(
    env.WF_AUTH_PASSWORD_HASH,
    "WF_AUTH_PASSWORD_HASH",
  );
  const authRequired = env.WF_AUTH_REQUIRED?.trim().toLowerCase() !== "false";

  if (sidecarToken && !isLoopbackHost(listen.host)) {
    throw new Error(
      `WF_SIDECAR_TOKEN requires a loopback WF_LISTEN_ADDR; got ${formatListen(listen)}`,
    );
  }
  if (authPasswordHash && cors.allowOrigins.includes("*")) {
    throw new Error(
      'WF_CORS_ALLOW_ORIGINS cannot be "*" when authentication is enabled. Set explicit origins.',
    );
  }
  if (!authPasswordHash && !isLoopbackHost(listen.host) && authRequired) {
    throw new Error(
      `Refusing to start: listening on non-loopback address ${formatListen(
        listen,
      )} without authentication.`,
    );
  }

  return {
    listen,
    cors,
    requestTimeoutMs,
    secretKey,
    sidecarToken,
    authPasswordHash,
  };
}

export function parseListenAddress(value: string): ListenAddress {
  const trimmed = value.trim();
  const separator = trimmed.lastIndexOf(":");
  if (separator <= 0 || separator === trimmed.length - 1) {
    throw new Error(`Invalid WF_LISTEN_ADDR "${value}". Expected host:port.`);
  }

  const host = stripIpv6Brackets(trimmed.slice(0, separator));
  const port = Number(trimmed.slice(separator + 1));
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid WF_LISTEN_ADDR port "${trimmed.slice(separator + 1)}".`);
  }
  return { host, port };
}

function parseCors(value: string | undefined): CorsConfig {
  return {
    allowOrigins: (value?.trim() ? value : "*")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
}

function parseRequestTimeoutMs(value: string | undefined): number {
  if (!value?.trim()) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }
  const timeout = Number(value);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_REQUEST_TIMEOUT_MS;
}

function parseOptionalNonEmpty(value: string | undefined, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${name} must not be empty when set`);
  }
  return trimmed;
}

function parseRequiredNonEmpty(value: string | undefined, name: string): string {
  if (value === undefined) {
    throw new Error(`${name} must be set and contain a 32-byte key`);
  }
  const parsed = parseOptionalNonEmpty(value, name);
  if (parsed === undefined) {
    throw new Error(`${name} must be set and contain a 32-byte key`);
  }
  return parsed;
}

function decodeSecretKey(value: string): Uint8Array {
  if (value.length === 32) {
    return new TextEncoder().encode(value);
  }

  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32) {
    throw new Error("WF_SECRET_KEY must be base64 encoded or a 32-byte ASCII string");
  }
  return new Uint8Array(decoded);
}

function stripIpv6Brackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "::1" || host.startsWith("127.");
}

function formatListen(listen: ListenAddress): string {
  return `${listen.host}:${listen.port}`;
}
