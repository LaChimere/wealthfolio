import {
  startRustSidecar,
  startTsBackendSidecar,
  type SidecarHandle,
  type StartSidecarOptions,
} from "./sidecar";

export type ElectronBackendRuntimeKind = "rust" | "ts";

export interface StartElectronBackendRuntimeOptions extends StartSidecarOptions {
  runtime?: ElectronBackendRuntimeKind;
  env?: NodeJS.ProcessEnv;
}

export function resolveElectronBackendRuntimeKind(
  env: NodeJS.ProcessEnv = process.env,
): ElectronBackendRuntimeKind {
  const raw = env.WF_BACKEND_RUNTIME?.trim().toLowerCase();
  if (!raw || raw === "rust" || raw === "rust-sidecar") {
    return "rust";
  }
  if (raw === "ts" || raw === "typescript" || raw === "bun") {
    return "ts";
  }
  throw new Error(`Unsupported WF_BACKEND_RUNTIME "${env.WF_BACKEND_RUNTIME}".`);
}

export async function startElectronBackendRuntime(
  options: StartElectronBackendRuntimeOptions,
): Promise<SidecarHandle> {
  const runtime = options.runtime ?? resolveElectronBackendRuntimeKind(options.env);
  return runtime === "ts" ? await startTsBackendSidecar(options) : await startRustSidecar(options);
}
