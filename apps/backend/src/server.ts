import type { BackendRuntimeConfig } from "./config";
import { createBackendRequestHandler, type BackendRequestHandlerOptions } from "./http";

export interface BackendServerHandle {
  baseUrl: string;
  stop(): void;
}

export function startBackendServer(
  config: BackendRuntimeConfig,
  options: BackendRequestHandlerOptions = {},
): BackendServerHandle {
  const server = Bun.serve({
    hostname: config.listen.host,
    idleTimeout: backendIdleTimeoutSeconds(config.requestTimeoutMs),
    port: config.listen.port,
    fetch: createBackendRequestHandler(config, options),
  });

  return {
    baseUrl: server.url.origin,
    stop() {
      server.stop(true);
    },
  };
}

export function backendIdleTimeoutSeconds(requestTimeoutMs: number): number {
  return Math.max(1, Math.min(255, Math.ceil(requestTimeoutMs / 1000)));
}
