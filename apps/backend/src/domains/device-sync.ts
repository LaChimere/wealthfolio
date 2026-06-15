import type { ConnectService } from "./connect";
import type { SecretService } from "./secrets";

export interface RegisterDeviceRequest {
  displayName: string;
  platform: string;
  osVersion?: string;
  appVersion?: string;
  instanceId: string;
}

export interface UpdateDeviceRequest {
  displayName?: string;
}

export interface CommitInitializeTeamKeysRequest {
  keyVersion: number;
  deviceKeyEnvelope: string;
  signature: string;
  challengeResponse?: string;
  recoveryEnvelope?: string;
}

export interface CommitRotateTeamKeysEnvelope {
  deviceId: string;
  deviceKeyEnvelope: string;
}

export interface CommitRotateTeamKeysRequest {
  newKeyVersion: number;
  envelopes: CommitRotateTeamKeysEnvelope[];
  signature: string;
  challengeResponse?: string;
}

export interface ResetTeamSyncRequest {
  reason?: string;
}

export interface CreatePairingRequest {
  codeHash: string;
  ephemeralPublicKey: string;
}

export interface CompletePairingRequest {
  encryptedKeyBundle: string;
  sasProof: unknown;
  signature: string;
}

export interface ClaimPairingRequest {
  code: string;
  ephemeralPublicKey: string;
}

export interface ConfirmPairingRequest {
  proof: string;
  minSnapshotCreatedAt?: string;
}

export interface CompletePairingWithTransferRequest extends CompletePairingRequest {
  pairingId: string;
}

export interface ConfirmPairingWithBootstrapRequest {
  pairingId: string;
  proof?: string;
  minSnapshotCreatedAt?: string;
  allowOverwrite: boolean;
}

export interface BeginPairingConfirmRequest {
  pairingId: string;
  proof: string;
  minSnapshotCreatedAt?: string;
}

export interface PairingFlowIdRequest {
  flowId: string;
}

export interface DeviceSyncService {
  /**
   * Response shapes should mirror Rust/device-sync serde output verbatim. The
   * service owns token, cloud, device-id secret, and related side effects.
   */
  registerDevice(request: RegisterDeviceRequest): Promise<unknown> | unknown;
  getCurrentDevice(): Promise<unknown> | unknown;
  getDevice(deviceId: string): Promise<unknown> | unknown;
  listDevices(scope?: string): Promise<unknown[]> | unknown[];
  updateDevice(deviceId: string, request: UpdateDeviceRequest): Promise<unknown> | unknown;
  deleteDevice(deviceId: string): Promise<unknown> | unknown;
  revokeDevice(deviceId: string): Promise<unknown> | unknown;
  initializeTeamKeys?(): Promise<unknown> | unknown;
  commitInitializeTeamKeys?(request: CommitInitializeTeamKeysRequest): Promise<unknown> | unknown;
  rotateTeamKeys?(): Promise<unknown> | unknown;
  commitRotateTeamKeys?(request: CommitRotateTeamKeysRequest): Promise<unknown> | unknown;
  resetTeamSync?(request: ResetTeamSyncRequest): Promise<unknown> | unknown;
  createPairing?(request: CreatePairingRequest): Promise<unknown> | unknown;
  getPairing?(pairingId: string): Promise<unknown> | unknown;
  approvePairing?(pairingId: string): Promise<unknown> | unknown;
  completePairing?(pairingId: string, request: CompletePairingRequest): Promise<unknown> | unknown;
  cancelPairing?(pairingId: string): Promise<unknown> | unknown;
  claimPairing?(request: ClaimPairingRequest): Promise<unknown> | unknown;
  getPairingMessages?(pairingId: string): Promise<unknown> | unknown;
  confirmPairing?(pairingId: string, request: ConfirmPairingRequest): Promise<unknown> | unknown;
  completePairingWithTransfer?(
    request: CompletePairingWithTransferRequest,
  ): Promise<unknown> | unknown;
  confirmPairingWithBootstrap?(
    request: ConfirmPairingWithBootstrapRequest,
  ): Promise<unknown> | unknown;
  beginPairingConfirm?(request: BeginPairingConfirmRequest): Promise<unknown> | unknown;
  getPairingFlowState?(request: PairingFlowIdRequest): Promise<unknown> | unknown;
  approvePairingOverwrite?(request: PairingFlowIdRequest): Promise<unknown> | unknown;
  cancelPairingFlow?(request: PairingFlowIdRequest): Promise<unknown> | unknown;
}

export class DeviceSyncNotImplementedError extends Error {
  readonly status = 501;
  readonly code = "not_implemented";

  constructor(message: string) {
    super(message);
    this.name = "DeviceSyncNotImplementedError";
  }
}

export class DeviceSyncServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "DeviceSyncServiceError";
    this.code = code;
    this.status = status;
  }
}

const DEVICE_SYNC_DISABLED_MESSAGE = "Device sync feature is disabled in this build.";
const DEVICE_SYNC_IDENTITY_KEY = "sync_identity";
const DEVICE_SYNC_DEVICE_ID_KEY = "sync_device_id";

export interface LocalDeviceSyncServiceDependencies {
  connectService?: Pick<ConnectService, "restoreSyncSession">;
  secretService?: SecretService;
}

export function createDisabledDeviceSyncService(): DeviceSyncService {
  return {
    async registerDevice() {
      throw deviceSyncDisabled();
    },
    async getCurrentDevice() {
      throw deviceSyncDisabled();
    },
    async getDevice() {
      throw deviceSyncDisabled();
    },
    async listDevices() {
      throw deviceSyncDisabled();
    },
    async updateDevice() {
      throw deviceSyncDisabled();
    },
    async deleteDevice() {
      throw deviceSyncDisabled();
    },
    async revokeDevice() {
      throw deviceSyncDisabled();
    },
    async initializeTeamKeys() {
      throw deviceSyncDisabled();
    },
    async commitInitializeTeamKeys() {
      throw deviceSyncDisabled();
    },
    async rotateTeamKeys() {
      throw deviceSyncDisabled();
    },
    async commitRotateTeamKeys() {
      throw deviceSyncDisabled();
    },
    async resetTeamSync() {
      throw deviceSyncDisabled();
    },
    async createPairing() {
      throw deviceSyncDisabled();
    },
    async getPairing() {
      throw deviceSyncDisabled();
    },
    async approvePairing() {
      throw deviceSyncDisabled();
    },
    async completePairing() {
      throw deviceSyncDisabled();
    },
    async cancelPairing() {
      throw deviceSyncDisabled();
    },
    async claimPairing() {
      throw deviceSyncDisabled();
    },
    async getPairingMessages() {
      throw deviceSyncDisabled();
    },
    async confirmPairing() {
      throw deviceSyncDisabled();
    },
    async completePairingWithTransfer() {
      throw deviceSyncDisabled();
    },
    async confirmPairingWithBootstrap() {
      throw deviceSyncDisabled();
    },
    async beginPairingConfirm() {
      throw deviceSyncDisabled();
    },
    async getPairingFlowState() {
      throw deviceSyncDisabled();
    },
    async approvePairingOverwrite() {
      throw deviceSyncDisabled();
    },
    async cancelPairingFlow() {
      throw deviceSyncDisabled();
    },
  };
}

export function createLocalDeviceSyncService({
  connectService,
  secretService,
}: LocalDeviceSyncServiceDependencies): DeviceSyncService {
  const disabledService = createDisabledDeviceSyncService();
  return {
    ...disabledService,
    async getCurrentDevice() {
      if (!connectService || !secretService) {
        throw deviceSyncDisabled();
      }
      await connectService.restoreSyncSession();
      const deviceId = await getLocalDeviceId(secretService);
      if (!deviceId) {
        throw new DeviceSyncServiceError("bad_request", "No device ID configured", 400);
      }
      throw deviceSyncDisabled();
    },
    async listDevices() {
      if (!connectService) {
        throw deviceSyncDisabled();
      }
      await connectService.restoreSyncSession();
      throw deviceSyncDisabled();
    },
  };
}

async function getLocalDeviceId(secretService: SecretService): Promise<string | null> {
  const rawIdentity = await secretService.getSecret(DEVICE_SYNC_IDENTITY_KEY);
  if (rawIdentity) {
    try {
      const parsed = JSON.parse(rawIdentity) as unknown;
      if (isRecord(parsed) && typeof parsed.deviceId === "string") {
        return parsed.deviceId;
      }
    } catch {
      // Match Rust get_device_id: parse failures still fall back to the legacy key.
    }
  }
  return await secretService.getSecret(DEVICE_SYNC_DEVICE_ID_KEY);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deviceSyncDisabled(): DeviceSyncNotImplementedError {
  return new DeviceSyncNotImplementedError(DEVICE_SYNC_DISABLED_MESSAGE);
}
