import { startTsBackendSidecar, type SidecarHandle, type StartSidecarOptions } from "./sidecar";

export type ElectronBackendRuntimeKind = "ts";

export interface StartElectronBackendRuntimeOptions extends StartSidecarOptions {
  runtime?: ElectronBackendRuntimeKind;
  env?: NodeJS.ProcessEnv;
}

export function resolveElectronBackendRuntimeKind(
  env: NodeJS.ProcessEnv = process.env,
): ElectronBackendRuntimeKind {
  const raw = env.WF_BACKEND_RUNTIME?.trim().toLowerCase();
  if (!raw) {
    return "ts";
  }
  if (raw === "rust" || raw === "rust-sidecar") {
    throw new Error("WF_BACKEND_RUNTIME=rust is no longer supported; use the TypeScript backend.");
  }
  if (raw === "ts" || raw === "typescript" || raw === "bun") {
    return "ts";
  }
  throw new Error(`Unsupported WF_BACKEND_RUNTIME "${env.WF_BACKEND_RUNTIME}".`);
}

export async function startElectronBackendRuntime(
  options: StartElectronBackendRuntimeOptions,
): Promise<SidecarHandle> {
  if ((options.runtime ?? resolveElectronBackendRuntimeKind(options.env)) !== "ts") {
    throw new Error("Electron only supports the TypeScript backend runtime.");
  }
  return await startTsBackendSidecar(options);
}
