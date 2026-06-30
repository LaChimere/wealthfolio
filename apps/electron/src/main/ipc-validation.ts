import { isElectronCommand, type ElectronCommand, type ElectronInvokeRequest } from "../shared/ipc";

export interface ValidatedElectronInvokeRequest {
  command: ElectronCommand;
  payload?: Record<string, unknown>;
}

export function validateElectronInvokeRequest(request: unknown): ValidatedElectronInvokeRequest {
  if (!request || typeof request !== "object") {
    throw new Error("Invalid Electron command request.");
  }

  const candidate = request as Partial<ElectronInvokeRequest>;
  if (typeof candidate.command !== "string") {
    throw new Error("Invalid Electron command request.");
  }
  if (
    candidate.payload !== undefined &&
    (candidate.payload === null ||
      typeof candidate.payload !== "object" ||
      Array.isArray(candidate.payload))
  ) {
    throw new Error("Invalid Electron command payload.");
  }

  if (!isElectronCommand(candidate.command)) {
    throw new Error(`Electron command bridge is not connected yet: ${candidate.command}`);
  }

  return {
    command: candidate.command,
    payload: candidate.payload,
  };
}
