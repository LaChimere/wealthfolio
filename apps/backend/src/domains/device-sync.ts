import { randomUUID } from "node:crypto";

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
const DEFAULT_DEVICE_SYNC_API_URL = "https://api.wealthfolio.app";

export interface LocalDeviceSyncServiceDependencies {
  connectService?: Pick<ConnectService, "restoreSyncSession">;
  secretService?: SecretService;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
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
  env = process.env,
  fetch: fetchImpl = fetch,
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
    async listDevices(scope) {
      if (!connectService) {
        throw deviceSyncDisabled();
      }
      const accessToken = await restoreAccessToken(connectService);
      const path =
        scope === undefined
          ? "/api/v1/sync/team/devices"
          : `/api/v1/sync/team/devices?scope=${encodeURIComponent(scope)}`;
      return await fetchDeviceSyncJson(accessToken, env, fetchImpl, path).then(devicesFromCloud);
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

async function restoreAccessToken(
  connectService: Pick<ConnectService, "restoreSyncSession">,
): Promise<string> {
  const session = await connectService.restoreSyncSession();
  if (
    !isRecord(session) ||
    typeof session.accessToken !== "string" ||
    !session.accessToken.trim()
  ) {
    throw new DeviceSyncServiceError(
      "internal_error",
      "Failed to restore Connect access token",
      500,
    );
  }
  return session.accessToken;
}

async function fetchDeviceSyncJson(
  accessToken: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  path: string,
): Promise<unknown> {
  const clientRequestId = `app:${randomUUID()}`;
  let response: Response;
  try {
    response = await fetchImpl(`${normalizeDeviceSyncApiUrl(env.CONNECT_API_URL)}${path}`, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "x-wf-client-request-id": clientRequestId,
      },
    });
  } catch (error) {
    throw new DeviceSyncServiceError("internal_error", errorMessage(error), 500);
  }
  const requestId = response.headers.get("x-request-id")?.trim() || "none";
  const metadata = `(clientRequestId=${clientRequestId}, requestId=${requestId})`;
  let bodyText: string;
  try {
    bodyText = await response.text();
  } catch (error) {
    throw new DeviceSyncServiceError("internal_error", errorMessage(error), 500);
  }
  if (!response.ok) {
    throw deviceSyncApiError(response.status, bodyText, metadata);
  }
  try {
    return JSON.parse(bodyText) as unknown;
  } catch (error) {
    throw new DeviceSyncServiceError(
      "internal_error",
      `Failed to parse response: ${errorMessage(error)} ${metadata}`,
      500,
    );
  }
}

function devicesFromCloud(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new DeviceSyncServiceError("internal_error", "Failed to parse devices response", 500);
  }
  return value.map(deviceFromCloud);
}

function deviceFromCloud(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new DeviceSyncServiceError("internal_error", "Failed to parse device response", 500);
  }
  const trustState = requiredTrustState(value.trustState ?? value.trust_state);
  return {
    id: requiredString(value.id, "device response"),
    userId: requiredString(value.userId ?? value.user_id, "device response"),
    displayName: requiredString(value.displayName ?? value.display_name, "device response"),
    platform: requiredString(value.platform, "device response"),
    devicePublicKey: optionalDeviceString(
      value.devicePublicKey ?? value.device_public_key,
      "device response",
    ),
    trustState,
    trustedKeyVersion: optionalNumber(value.trustedKeyVersion ?? value.trusted_key_version),
    osVersion: optionalDeviceString(value.osVersion ?? value.os_version, "device response"),
    appVersion: optionalDeviceString(value.appVersion ?? value.app_version, "device response"),
    lastSeenAt: optionalDeviceString(value.lastSeenAt ?? value.last_seen_at, "device response"),
    createdAt: requiredString(value.createdAt ?? value.created_at, "device response"),
  };
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

function deviceSyncApiError(
  status: number,
  bodyText: string,
  metadata: string,
): DeviceSyncServiceError {
  const trimmed = bodyText.trim();
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (isRecord(parsed)) {
        const code = optionalString(parsed.code) ?? optionalString(parsed.error) ?? "";
        const message = optionalString(parsed.message) ?? `HTTP ${status}`;
        return new DeviceSyncServiceError(
          "internal_error",
          `API error (${status}): ${code}: ${message} ${metadata}`,
          500,
        );
      }
    } catch {
      return new DeviceSyncServiceError(
        "internal_error",
        `API error (${status}): Request failed: ${trimmed} ${metadata}`,
        500,
      );
    }
  }
  return new DeviceSyncServiceError(
    "internal_error",
    `API error (${status}): Request failed ${metadata}`,
    500,
  );
}

function requiredString(value: unknown, context: string): string {
  if (typeof value !== "string") {
    throw new DeviceSyncServiceError("internal_error", `Failed to parse ${context}`, 500);
  }
  return value;
}

function requiredTrustState(value: unknown): string {
  if (value !== "untrusted" && value !== "trusted" && value !== "revoked") {
    throw new DeviceSyncServiceError("internal_error", "Failed to parse device response", 500);
  }
  return value;
}

function optionalNumber(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number") {
    throw new DeviceSyncServiceError("internal_error", "Failed to parse device response", 500);
  }
  return value;
}

function optionalDeviceString(value: unknown, context: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new DeviceSyncServiceError("internal_error", `Failed to parse ${context}`, 500);
  }
  return value;
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

function normalizeDeviceSyncApiUrl(value: string | undefined): string {
  const trimmed = value?.trim().replace(/\/+$/, "");
  return trimmed || DEFAULT_DEVICE_SYNC_API_URL;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deviceSyncDisabled(): DeviceSyncNotImplementedError {
  return new DeviceSyncNotImplementedError(DEVICE_SYNC_DISABLED_MESSAGE);
}
