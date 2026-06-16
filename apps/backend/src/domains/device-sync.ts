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
    async registerDevice() {
      await restoreSessionOrDisabled(connectService);
      throw deviceSyncDisabled();
    },
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
    async getDevice() {
      await restoreSessionOrDisabled(connectService);
      throw deviceSyncDisabled();
    },
    async updateDevice() {
      await restoreSessionOrDisabled(connectService);
      throw deviceSyncDisabled();
    },
    async deleteDevice() {
      await restoreSessionOrDisabled(connectService);
      throw deviceSyncDisabled();
    },
    async revokeDevice() {
      await restoreSessionOrDisabled(connectService);
      throw deviceSyncDisabled();
    },
    async initializeTeamKeys() {
      await requireSessionDeviceIdOrDisabled(connectService, secretService);
      throw deviceSyncDisabled();
    },
    async commitInitializeTeamKeys() {
      await requireSessionDeviceIdOrDisabled(connectService, secretService);
      throw deviceSyncDisabled();
    },
    async rotateTeamKeys() {
      await requireSessionDeviceIdOrDisabled(connectService, secretService);
      throw deviceSyncDisabled();
    },
    async commitRotateTeamKeys() {
      await requireSessionDeviceIdOrDisabled(connectService, secretService);
      throw deviceSyncDisabled();
    },
    async resetTeamSync() {
      await restoreSessionOrDisabled(connectService);
      throw deviceSyncDisabled();
    },
    async createPairing() {
      await requireSessionDeviceIdOrDisabled(connectService, secretService);
      throw deviceSyncDisabled();
    },
    async getPairing() {
      await requireSessionDeviceIdOrDisabled(connectService, secretService);
      throw deviceSyncDisabled();
    },
    async approvePairing() {
      await requireSessionDeviceIdOrDisabled(connectService, secretService);
      throw deviceSyncDisabled();
    },
    async completePairing() {
      await requireSessionDeviceIdOrDisabled(connectService, secretService);
      throw deviceSyncDisabled();
    },
    async cancelPairing() {
      await requireSessionDeviceIdOrDisabled(connectService, secretService);
      throw deviceSyncDisabled();
    },
    async claimPairing() {
      await requireSessionDeviceIdOrDisabled(connectService, secretService);
      throw deviceSyncDisabled();
    },
    async getPairingMessages() {
      await requireSessionDeviceIdOrDisabled(connectService, secretService);
      throw deviceSyncDisabled();
    },
    async confirmPairing() {
      await requireSessionDeviceIdOrDisabled(connectService, secretService);
      throw deviceSyncDisabled();
    },
    async completePairingWithTransfer() {
      await requireCompositePairingPrerequisitesOrDisabled(connectService, secretService);
      throw deviceSyncDisabled();
    },
    async confirmPairingWithBootstrap() {
      await requireCompositePairingPrerequisitesOrDisabled(connectService, secretService);
      throw deviceSyncDisabled();
    },
    async beginPairingConfirm() {
      await requireCompositePairingPrerequisitesOrDisabled(connectService, secretService);
      throw deviceSyncDisabled();
    },
    async getPairingFlowState() {
      throw new DeviceSyncServiceError("internal_error", "Flow not found", 500);
    },
    async approvePairingOverwrite() {
      throw new DeviceSyncServiceError("internal_error", "Flow not found", 500);
    },
    cancelPairingFlow(request) {
      return {
        flowId: request.flowId,
        phase: { phase: "success" },
      };
    },
  };
}

async function requireCompositePairingPrerequisitesOrDisabled(
  connectService: Pick<ConnectService, "restoreSyncSession"> | undefined,
  secretService: SecretService | undefined,
): Promise<string> {
  if (!secretService) {
    throw deviceSyncDisabled();
  }
  const deviceId = await getLocalSyncIdentityDeviceId(secretService);
  if (deviceId === undefined) {
    throw new DeviceSyncServiceError("internal_error", "No sync identity configured", 500);
  }
  if (deviceId === null) {
    throw new DeviceSyncServiceError("internal_error", "No device ID configured", 500);
  }
  await restoreSessionOrDisabled(connectService);
  return deviceId;
}

async function requireSessionDeviceIdOrDisabled(
  connectService: Pick<ConnectService, "restoreSyncSession"> | undefined,
  secretService: SecretService | undefined,
): Promise<string> {
  await restoreSessionOrDisabled(connectService);
  if (!secretService) {
    throw deviceSyncDisabled();
  }
  const deviceId = await getLocalDeviceId(secretService);
  if (!deviceId) {
    throw new DeviceSyncServiceError("bad_request", "No device ID configured", 400);
  }
  return deviceId;
}

async function restoreSessionOrDisabled(
  connectService: Pick<ConnectService, "restoreSyncSession"> | undefined,
): Promise<void> {
  if (!connectService) {
    throw deviceSyncDisabled();
  }
  await connectService.restoreSyncSession();
}

async function getLocalDeviceId(secretService: SecretService): Promise<string | null> {
  const rawIdentity = await secretService.getSecret(DEVICE_SYNC_IDENTITY_KEY);
  if (rawIdentity) {
    try {
      return (
        parseStoredSyncIdentity(rawIdentity).deviceId ??
        (await secretService.getSecret(DEVICE_SYNC_DEVICE_ID_KEY))
      );
    } catch {
      // Match Rust get_device_id: parse failures still fall back to the legacy key.
    }
  }
  return await secretService.getSecret(DEVICE_SYNC_DEVICE_ID_KEY);
}

async function getLocalSyncIdentityDeviceId(
  secretService: SecretService,
): Promise<string | null | undefined> {
  const rawIdentity = await secretService.getSecret(DEVICE_SYNC_IDENTITY_KEY);
  if (!rawIdentity) {
    return undefined;
  }
  try {
    return parseStoredSyncIdentity(rawIdentity).deviceId;
  } catch {
    return undefined;
  }
}

function parseStoredSyncIdentity(rawIdentity: string): {
  deviceId: string | null;
} {
  assertNoDuplicateSyncIdentityFields(rawIdentity);
  assertRawI32Token(rawIdentity, "version", false);
  assertRawI32Token(rawIdentity, "keyVersion", true);
  const parsed = JSON.parse(rawIdentity) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("invalid sync identity");
  }
  assertDefaultedI32Field(parsed, "version");
  assertOptionalStringField(parsed, "deviceNonce");
  assertOptionalStringField(parsed, "deviceId");
  assertOptionalStringField(parsed, "rootKey");
  assertOptionalI32Field(parsed, "keyVersion");
  assertOptionalStringField(parsed, "deviceSecretKey");
  assertOptionalStringField(parsed, "devicePublicKey");
  return { deviceId: optionalString(parsed.deviceId) };
}

const SYNC_IDENTITY_FIELDS = new Set([
  "version",
  "deviceNonce",
  "deviceId",
  "rootKey",
  "keyVersion",
  "deviceSecretKey",
  "devicePublicKey",
]);

function assertNoDuplicateSyncIdentityFields(rawJson: string): void {
  const seen = new Set<string>();
  for (const key of topLevelJsonKeys(rawJson)) {
    if (!SYNC_IDENTITY_FIELDS.has(key)) {
      continue;
    }
    if (seen.has(key)) {
      throw new Error("invalid sync identity");
    }
    seen.add(key);
  }
}

function assertOptionalStringField(record: Record<string, unknown>, key: string): void {
  const value = record[key];
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw new Error("invalid sync identity");
  }
}

function assertDefaultedI32Field(record: Record<string, unknown>, key: string): void {
  const value = record[key];
  if (value !== undefined && !isI32Integer(value)) {
    throw new Error("invalid sync identity");
  }
}

function assertOptionalI32Field(record: Record<string, unknown>, key: string): void {
  const value = record[key];
  if (value !== undefined && value !== null && !isI32Integer(value)) {
    throw new Error("invalid sync identity");
  }
}

function isI32Integer(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= -2_147_483_648 &&
    value <= 2_147_483_647
  );
}

function assertRawI32Token(rawJson: string, key: string, allowNull: boolean): void {
  for (const token of topLevelJsonValueTokens(rawJson, key)) {
    if (token === "null") {
      if (allowNull) {
        continue;
      }
      throw new Error("invalid sync identity");
    }
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token) && /[.eE]/.test(token)) {
      throw new Error("invalid sync identity");
    }
  }
}

function topLevelJsonValueTokens(rawJson: string, targetKey: string): string[] {
  const tokens: string[] = [];
  for (const entry of topLevelJsonEntries(rawJson)) {
    if (entry.key === targetKey) {
      tokens.push(entry.valueToken);
    }
  }
  return tokens;
}

function topLevelJsonKeys(rawJson: string): string[] {
  return topLevelJsonEntries(rawJson).map((entry) => entry.key);
}

function topLevelJsonEntries(rawJson: string): Array<{ key: string; valueToken: string }> {
  const entries: Array<{ key: string; valueToken: string }> = [];
  let index = skipJsonWhitespace(rawJson, 0);
  if (rawJson[index] !== "{") {
    return entries;
  }
  index += 1;
  while (index < rawJson.length) {
    index = skipJsonWhitespace(rawJson, index);
    if (rawJson[index] === "}") {
      break;
    }
    if (rawJson[index] !== '"') {
      return entries;
    }
    const keyStart = index;
    index = skipJsonString(rawJson, index);
    if (index < 0) {
      return entries;
    }
    let key: string;
    try {
      key = JSON.parse(rawJson.slice(keyStart, index)) as string;
    } catch {
      return entries;
    }
    index = skipJsonWhitespace(rawJson, index);
    if (rawJson[index] !== ":") {
      return entries;
    }
    index = skipJsonWhitespace(rawJson, index + 1);
    const valueStart = index;
    index = skipJsonValue(rawJson, index);
    if (index < 0) {
      return entries;
    }
    entries.push({ key, valueToken: rawJson.slice(valueStart, index).trim() });
    index = skipJsonWhitespace(rawJson, index);
    if (rawJson[index] === ",") {
      index += 1;
      continue;
    }
    if (rawJson[index] === "}") {
      break;
    }
    return entries;
  }
  return entries;
}

function skipJsonWhitespace(rawJson: string, index: number): number {
  while (/\s/.test(rawJson[index] ?? "")) {
    index += 1;
  }
  return index;
}

function skipJsonString(rawJson: string, index: number): number {
  index += 1;
  while (index < rawJson.length) {
    const char = rawJson[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === '"') {
      return index + 1;
    }
    index += 1;
  }
  return -1;
}

function skipJsonValue(rawJson: string, index: number): number {
  const char = rawJson[index];
  if (char === '"') {
    return skipJsonString(rawJson, index);
  }
  if (char === "{" || char === "[") {
    return skipJsonComposite(rawJson, index);
  }
  while (index < rawJson.length && rawJson[index] !== "," && rawJson[index] !== "}") {
    index += 1;
  }
  return index;
}

function skipJsonComposite(rawJson: string, index: number): number {
  const stack: string[] = [];
  while (index < rawJson.length) {
    const char = rawJson[index];
    if (char === '"') {
      index = skipJsonString(rawJson, index);
      if (index < 0) {
        return -1;
      }
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push(char === "{" ? "}" : "]");
    } else if (char === "}" || char === "]") {
      if (stack.pop() !== char) {
        return -1;
      }
      if (stack.length === 0) {
        return index + 1;
      }
    }
    index += 1;
  }
  return -1;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deviceSyncDisabled(): DeviceSyncNotImplementedError {
  return new DeviceSyncNotImplementedError(DEVICE_SYNC_DISABLED_MESSAGE);
}
