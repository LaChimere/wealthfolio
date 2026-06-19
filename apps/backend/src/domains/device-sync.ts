import { randomUUID } from "node:crypto";

import type { Database } from "bun:sqlite";

import type { ConnectService } from "./connect";
import { localOverwriteRiskSummary } from "./device-sync-overwrite-risk";
import { normalizeSyncDatetime } from "./device-sync-time";
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
  db?: Database;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  onPairingComplete?: () => Promise<unknown> | unknown;
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
  db,
  env = process.env,
  fetch: fetchImpl = fetch,
  onPairingComplete,
}: LocalDeviceSyncServiceDependencies): DeviceSyncService {
  const disabledService = createDisabledDeviceSyncService();
  const pairingFlows = new Map<string, { pairingId: string; phase: Record<string, unknown> }>();

  return {
    ...disabledService,
    async registerDevice(request) {
      const accessToken = await restoreAccessTokenOrDisabled(connectService);
      if (!secretService) {
        throw deviceSyncDisabled();
      }
      const result = enrollDeviceResponseFromCloud(
        await fetchDeviceSyncJson(accessToken, env, fetchImpl, "/api/v1/sync/team/devices", {
          method: "POST",
          body: {
            device_nonce: request.instanceId,
            display_name: request.displayName,
            platform: request.platform,
            os_version: request.osVersion,
            app_version: request.appVersion,
          },
        }),
      );
      try {
        await secretService.setSecret(
          DEVICE_SYNC_DEVICE_ID_KEY,
          requiredString(result.device_id, "enroll response"),
        );
      } catch (error) {
        throw new DeviceSyncServiceError(
          "internal_error",
          `Failed to store device ID: ${errorMessage(error)}`,
          500,
        );
      }
      return result;
    },
    async getCurrentDevice() {
      if (!connectService || !secretService) {
        throw deviceSyncDisabled();
      }
      const accessToken = await restoreAccessToken(connectService);
      const deviceId = await getLocalDeviceId(secretService);
      if (!deviceId) {
        throw new DeviceSyncServiceError("bad_request", "No device ID configured", 400);
      }
      return await fetchDeviceFromCloud(accessToken, env, fetchImpl, deviceId);
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
    async getDevice(deviceId) {
      const accessToken = await restoreAccessTokenOrDisabled(connectService);
      return await fetchDeviceFromCloud(accessToken, env, fetchImpl, deviceId);
    },
    async updateDevice(deviceId, request) {
      const accessToken = await restoreAccessTokenOrDisabled(connectService);
      return await fetchDeviceSyncJson(
        accessToken,
        env,
        fetchImpl,
        `/api/v1/sync/team/devices/${encodeURIComponent(deviceId)}`,
        {
          method: "PATCH",
          body: {
            display_name: request.displayName,
          },
        },
      ).then(successResponseFromCloud);
    },
    async deleteDevice(deviceId) {
      const accessToken = await restoreAccessTokenOrDisabled(connectService);
      return await fetchDeviceSyncJson(
        accessToken,
        env,
        fetchImpl,
        `/api/v1/sync/team/devices/${encodeURIComponent(deviceId)}`,
        { method: "DELETE" },
      ).then(successResponseFromCloud);
    },
    async revokeDevice(deviceId) {
      const accessToken = await restoreAccessTokenOrDisabled(connectService);
      return await fetchDeviceSyncJson(
        accessToken,
        env,
        fetchImpl,
        `/api/v1/sync/team/devices/${encodeURIComponent(deviceId)}/revoke`,
        { method: "POST" },
      ).then(successResponseFromCloud);
    },
    async initializeTeamKeys() {
      const { accessToken, deviceId } = await requireSessionDeviceIdWithTokenOrDisabled(
        connectService,
        secretService,
      );
      return await fetchDeviceSyncJson(
        accessToken,
        env,
        fetchImpl,
        "/api/v1/sync/team/keys/initialize",
        {
          method: "POST",
          deviceId,
          body: { device_id: deviceId },
        },
      ).then(initializeKeysResultFromCloud);
    },
    async commitInitializeTeamKeys(request) {
      const { accessToken, deviceId } = await requireSessionDeviceIdWithTokenOrDisabled(
        connectService,
        secretService,
      );
      return await fetchDeviceSyncJson(
        accessToken,
        env,
        fetchImpl,
        "/api/v1/sync/team/keys/initialize/commit",
        {
          method: "POST",
          deviceId,
          body: {
            device_id: deviceId,
            key_version: request.keyVersion,
            device_key_envelope: request.deviceKeyEnvelope,
            signature: request.signature,
            challenge_response: request.challengeResponse,
            recovery_envelope: request.recoveryEnvelope,
          },
        },
      ).then(commitInitializeKeysResponseFromCloud);
    },
    async rotateTeamKeys() {
      const { accessToken, deviceId } = await requireSessionDeviceIdWithTokenOrDisabled(
        connectService,
        secretService,
      );
      return await fetchDeviceSyncJson(
        accessToken,
        env,
        fetchImpl,
        "/api/v1/sync/team/keys/rotate",
        {
          method: "POST",
          deviceId,
          body: { initiator_device_id: deviceId },
        },
      ).then(rotateKeysResponseFromCloud);
    },
    async commitRotateTeamKeys(request) {
      const { accessToken, deviceId } = await requireSessionDeviceIdWithTokenOrDisabled(
        connectService,
        secretService,
      );
      return await fetchDeviceSyncJson(
        accessToken,
        env,
        fetchImpl,
        "/api/v1/sync/team/keys/rotate/commit",
        {
          method: "POST",
          deviceId,
          body: {
            new_key_version: request.newKeyVersion,
            envelopes: request.envelopes.map((envelope) => ({
              device_id: envelope.deviceId,
              device_key_envelope: envelope.deviceKeyEnvelope,
            })),
            signature: request.signature,
            challenge_response: request.challengeResponse,
          },
        },
      ).then(commitRotateKeysResponseFromCloud);
    },
    async resetTeamSync(request) {
      const accessToken = await restoreAccessTokenOrDisabled(connectService);
      return await fetchDeviceSyncJson(
        accessToken,
        env,
        fetchImpl,
        "/api/v1/sync/team/keys/reset",
        {
          method: "POST",
          body: request.reason === undefined ? {} : { reason: request.reason },
        },
      ).then(resetTeamSyncResponseFromCloud);
    },
    async createPairing(request) {
      const { accessToken, deviceId } = await requireSessionDeviceIdWithTokenOrDisabled(
        connectService,
        secretService,
      );
      return await fetchDeviceSyncJson(
        accessToken,
        env,
        fetchImpl,
        `/api/v1/sync/team/devices/${encodeURIComponent(deviceId)}/pairings`,
        {
          method: "POST",
          deviceId,
          body: {
            code_hash: request.codeHash,
            ephemeral_public_key: request.ephemeralPublicKey,
          },
        },
      ).then(createPairingResponseFromCloud);
    },
    async getPairing(pairingId) {
      const { accessToken, deviceId } = await requireSessionDeviceIdWithTokenOrDisabled(
        connectService,
        secretService,
      );
      return await fetchPairingFromCloud(accessToken, env, fetchImpl, deviceId, pairingId);
    },
    async approvePairing(pairingId) {
      const { accessToken, deviceId } = await requireSessionDeviceIdWithTokenOrDisabled(
        connectService,
        secretService,
      );
      return await fetchDeviceSyncJson(
        accessToken,
        env,
        fetchImpl,
        `/api/v1/sync/team/devices/${encodeURIComponent(deviceId)}/pairings/${encodeURIComponent(pairingId)}/approve`,
        { method: "POST", deviceId },
      ).then(successResponseFromCloud);
    },
    async completePairing(pairingId, request) {
      const { accessToken, deviceId } = await requireSessionDeviceIdWithTokenOrDisabled(
        connectService,
        secretService,
      );
      const result = await fetchDeviceSyncJson(
        accessToken,
        env,
        fetchImpl,
        `/api/v1/sync/team/devices/${encodeURIComponent(deviceId)}/pairings/${encodeURIComponent(pairingId)}/complete`,
        {
          method: "POST",
          deviceId,
          body: {
            encrypted_key_bundle: request.encryptedKeyBundle,
            sas_proof: request.sasProof,
            signature: request.signature,
          },
        },
      ).then(completePairingResponseFromCloud);
      void notifyPairingComplete(onPairingComplete);
      return result;
    },
    async cancelPairing(pairingId) {
      const { accessToken, deviceId } = await requireSessionDeviceIdWithTokenOrDisabled(
        connectService,
        secretService,
      );
      return await fetchDeviceSyncJson(
        accessToken,
        env,
        fetchImpl,
        `/api/v1/sync/team/devices/${encodeURIComponent(deviceId)}/pairings/${encodeURIComponent(pairingId)}/cancel`,
        { method: "POST", deviceId },
      ).then(successResponseFromCloud);
    },
    async claimPairing(request) {
      const { accessToken, deviceId } = await requireSessionDeviceIdWithTokenOrDisabled(
        connectService,
        secretService,
      );
      return await fetchDeviceSyncJson(
        accessToken,
        env,
        fetchImpl,
        `/api/v1/sync/team/devices/${encodeURIComponent(deviceId)}/pairings/claim`,
        {
          method: "POST",
          deviceId,
          body: {
            code: request.code,
            ephemeral_public_key: request.ephemeralPublicKey,
          },
        },
      ).then(claimPairingResponseFromCloud);
    },
    async getPairingMessages(pairingId) {
      const { accessToken, deviceId } = await requireSessionDeviceIdWithTokenOrDisabled(
        connectService,
        secretService,
      );
      return await fetchDeviceSyncJson(
        accessToken,
        env,
        fetchImpl,
        `/api/v1/sync/team/devices/${encodeURIComponent(deviceId)}/pairings/${encodeURIComponent(pairingId)}/messages`,
        { deviceId },
      ).then(pairingMessagesFromCloud);
    },
    async confirmPairing(pairingId, request) {
      const { accessToken, deviceId } = await requireSessionDeviceIdWithTokenOrDisabled(
        connectService,
        secretService,
      );
      const result = await fetchDeviceSyncJson(
        accessToken,
        env,
        fetchImpl,
        `/api/v1/sync/team/devices/${encodeURIComponent(deviceId)}/pairings/${encodeURIComponent(pairingId)}/confirm`,
        {
          method: "POST",
          deviceId,
          body: { proof: request.proof },
        },
      ).then(confirmPairingResponseFromCloud);
      applyMinSnapshotCreatedAtBestEffort(db, deviceId, request.minSnapshotCreatedAt);
      return result;
    },
    async completePairingWithTransfer(request) {
      const { accessToken, deviceId } =
        await requireCompositePairingPrerequisitesWithTokenOrDisabled(
          connectService,
          secretService,
        );
      const result = await fetchDeviceSyncJson(
        accessToken,
        env,
        fetchImpl,
        `/api/v1/sync/team/devices/${encodeURIComponent(deviceId)}/pairings/${encodeURIComponent(request.pairingId)}/complete`,
        {
          method: "POST",
          deviceId,
          body: {
            encrypted_key_bundle: request.encryptedKeyBundle,
            sas_proof: request.sasProof,
            signature: request.signature,
          },
        },
      ).then(completePairingResponseFromCloud);
      void notifyPairingComplete(onPairingComplete);
      return result;
    },
    async confirmPairingWithBootstrap(request) {
      const { accessToken, deviceId } =
        await requireCompositePairingPrerequisitesWithTokenOrDisabled(
          connectService,
          secretService,
        );
      try {
        await fetchDeviceSyncJson(
          accessToken,
          env,
          fetchImpl,
          `/api/v1/sync/team/devices/${encodeURIComponent(deviceId)}/pairings/${encodeURIComponent(request.pairingId)}/confirm`,
          {
            method: "POST",
            deviceId,
            body: request.proof === undefined ? {} : { proof: request.proof },
          },
        ).then(confirmPairingResponseFromCloud);
      } catch (error) {
        if (!isPairingAlreadyConfirmedError(error)) {
          throw error;
        }
      }
      applyMinSnapshotCreatedAtBestEffort(db, deviceId, request.minSnapshotCreatedAt);
      if (!db) {
        return {
          status: "already_complete",
          message: "No bootstrap needed",
          localRows: null,
          nonEmptyTables: null,
        };
      }
      if (db && !localBootstrapRequired(db, deviceId)) {
        return {
          status: "already_complete",
          message: "No bootstrap needed",
          localRows: null,
          nonEmptyTables: null,
        };
      }
      if (db && !request.allowOverwrite) {
        const summary = localOverwriteRiskSummary(db);
        if (summary.totalRows > 0) {
          return {
            status: "overwrite_required",
            message: `Local data (${summary.totalRows} rows) will be replaced by remote snapshot`,
            localRows: summary.totalRows,
            nonEmptyTables: summary.nonEmptyTables,
          };
        }
      }
      if (await latestSnapshotIsMissing(accessToken, env, fetchImpl, deviceId)) {
        return {
          status: "waiting_snapshot",
          message: request.minSnapshotCreatedAt
            ? "Waiting for a snapshot generated after pairing confirmation"
            : "Snapshot is not available yet. Waiting for upload from a trusted device.",
          localRows: null,
          nonEmptyTables: null,
        };
      }
      throw deviceSyncDisabled();
    },
    async beginPairingConfirm(request) {
      const { accessToken, deviceId } =
        await requireCompositePairingPrerequisitesWithTokenOrDisabled(
          connectService,
          secretService,
        );
      try {
        await fetchDeviceSyncJson(
          accessToken,
          env,
          fetchImpl,
          `/api/v1/sync/team/devices/${encodeURIComponent(deviceId)}/pairings/${encodeURIComponent(request.pairingId)}/confirm`,
          {
            method: "POST",
            deviceId,
            body: { proof: request.proof },
          },
        ).then(confirmPairingResponseFromCloud);
      } catch (error) {
        if (!isPairingAlreadyConfirmedError(error)) {
          throw error;
        }
      }
      applyMinSnapshotCreatedAtBestEffort(db, deviceId, request.minSnapshotCreatedAt);
      if (!db) {
        return {
          flowId: randomUUID(),
          phase: { phase: "success" },
        };
      }
      if (db && !localBootstrapRequired(db, deviceId)) {
        return {
          flowId: randomUUID(),
          phase: { phase: "success" },
        };
      }
      if (db) {
        const summary = localOverwriteRiskSummary(db);
        if (summary.totalRows > 0) {
          const flowId = randomUUID();
          const phase = {
            phase: "overwrite_required",
            info: {
              localRows: summary.totalRows,
              nonEmptyTables: summary.nonEmptyTables,
            },
          };
          pairingFlows.set(flowId, { pairingId: request.pairingId, phase });
          return { flowId, phase };
        }
      }
      if (await latestSnapshotIsMissing(accessToken, env, fetchImpl, deviceId)) {
        const flowId = randomUUID();
        const phase = { phase: "syncing", detail: "waiting_snapshot" };
        pairingFlows.set(flowId, { pairingId: request.pairingId, phase });
        return { flowId, phase };
      }
      throw deviceSyncDisabled();
    },
    async getPairingFlowState(request) {
      const flow = pairingFlows.get(request.flowId);
      if (!flow) {
        throw new DeviceSyncServiceError("internal_error", "Flow not found", 500);
      }
      return { flowId: request.flowId, phase: flow.phase };
    },
    async approvePairingOverwrite(request) {
      const flow = pairingFlows.get(request.flowId);
      if (!flow) {
        throw new DeviceSyncServiceError("internal_error", "Flow not found", 500);
      }
      throw deviceSyncDisabled();
    },
    async cancelPairingFlow(request) {
      const flow = pairingFlows.get(request.flowId);
      try {
        if (flow) {
          await abortPairingFlowLocalState({
            connectService,
            secretService,
            db,
            env,
            fetchImpl,
            pairingId: flow.pairingId,
          });
        }
      } catch (error) {
        console.warn(`[DeviceSync] Failed to clean up pairing flow: ${errorMessage(error)}`);
      } finally {
        pairingFlows.delete(request.flowId);
      }
      return {
        flowId: request.flowId,
        phase: { phase: "success" },
      };
    },
  };
}

async function requireCompositePairingPrerequisitesWithTokenOrDisabled(
  connectService: Pick<ConnectService, "restoreSyncSession"> | undefined,
  secretService: SecretService | undefined,
): Promise<{ accessToken: string; deviceId: string }> {
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
  const accessToken = await restoreAccessTokenOrDisabled(connectService);
  return { accessToken, deviceId };
}

async function requireSessionDeviceIdWithTokenOrDisabled(
  connectService: Pick<ConnectService, "restoreSyncSession"> | undefined,
  secretService: SecretService | undefined,
): Promise<{ accessToken: string; deviceId: string }> {
  const accessToken = await restoreAccessTokenOrDisabled(connectService);
  if (!secretService) {
    throw deviceSyncDisabled();
  }
  const deviceId = await getLocalDeviceId(secretService);
  if (!deviceId) {
    throw new DeviceSyncServiceError("bad_request", "No device ID configured", 400);
  }
  return { accessToken, deviceId };
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

async function restoreAccessTokenOrDisabled(
  connectService: Pick<ConnectService, "restoreSyncSession"> | undefined,
): Promise<string> {
  if (!connectService) {
    throw deviceSyncDisabled();
  }
  return await restoreAccessToken(connectService);
}

async function fetchDeviceFromCloud(
  accessToken: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  deviceId: string,
): Promise<Record<string, unknown>> {
  return deviceFromCloud(
    await fetchDeviceSyncJson(
      accessToken,
      env,
      fetchImpl,
      `/api/v1/sync/team/devices/${encodeURIComponent(deviceId)}`,
    ),
  );
}

async function fetchPairingFromCloud(
  accessToken: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  deviceId: string,
  pairingId: string,
): Promise<Record<string, unknown>> {
  return pairingFromCloud(
    await fetchDeviceSyncJson(
      accessToken,
      env,
      fetchImpl,
      `/api/v1/sync/team/devices/${encodeURIComponent(deviceId)}/pairings/${encodeURIComponent(pairingId)}`,
      { deviceId },
    ),
  );
}

async function fetchDeviceSyncJson(
  accessToken: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  path: string,
  options: { method?: string; body?: unknown; deviceId?: string } = {},
): Promise<unknown> {
  const clientRequestId = deviceSyncClientRequestId(options.deviceId);
  let response: Response;
  try {
    const headers: Record<string, string> = {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "x-wf-client-request-id": clientRequestId,
    };
    if (options.deviceId !== undefined) {
      headers["x-wf-device-id"] = options.deviceId;
    }
    response = await fetchImpl(`${normalizeDeviceSyncApiUrl(env.CONNECT_API_URL)}${path}`, {
      method: options.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
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

async function latestSnapshotIsMissing(
  accessToken: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  deviceId: string,
): Promise<boolean> {
  const clientRequestId = deviceSyncClientRequestId(deviceId);
  let response: Response;
  try {
    response = await fetchImpl(
      `${normalizeDeviceSyncApiUrl(env.CONNECT_API_URL)}/api/v1/sync/snapshots/latest`,
      {
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          "x-wf-client-request-id": clientRequestId,
          "x-wf-device-id": deviceId,
        },
      },
    );
  } catch (error) {
    throw new DeviceSyncServiceError("internal_error", errorMessage(error), 500);
  }
  let bodyText: string;
  try {
    bodyText = await response.text();
  } catch (error) {
    throw new DeviceSyncServiceError("internal_error", errorMessage(error), 500);
  }
  if (response.status === 404) {
    return true;
  }
  if (!response.ok) {
    const requestId = response.headers.get("x-request-id")?.trim() || "none";
    throw deviceSyncApiError(
      response.status,
      bodyText,
      `(clientRequestId=${clientRequestId}, requestId=${requestId})`,
    );
  }
  return false;
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

function enrollDeviceResponseFromCloud(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new DeviceSyncServiceError("internal_error", "Failed to parse enroll response", 500);
  }
  const mode = requiredString(value.mode, "enroll response");
  if (mode === "BOOTSTRAP") {
    return {
      mode,
      device_id: requiredString(value.deviceId ?? value.device_id, "enroll response"),
      e2ee_key_version: requiredI32(
        value.e2eeKeyVersion ?? value.e2ee_key_version,
        "enroll response",
      ),
    };
  }
  if (mode === "PAIR") {
    return {
      mode,
      device_id: requiredString(value.deviceId ?? value.device_id, "enroll response"),
      e2ee_key_version: requiredI32(
        value.e2eeKeyVersion ?? value.e2ee_key_version,
        "enroll response",
      ),
      require_sas: requiredBoolean(value.requireSas ?? value.require_sas, "enroll response"),
      pairing_ttl_seconds: requiredI32(
        value.pairingTtlSeconds ?? value.pairing_ttl_seconds,
        "enroll response",
      ),
      trusted_devices: trustedDevicesFromCloud(value.trustedDevices ?? value.trusted_devices),
    };
  }
  if (mode === "READY") {
    return {
      mode,
      device_id: requiredString(value.deviceId ?? value.device_id, "enroll response"),
      e2ee_key_version: requiredI32(
        value.e2eeKeyVersion ?? value.e2ee_key_version,
        "enroll response",
      ),
      trust_state: requiredTrustState(value.trustState ?? value.trust_state),
    };
  }
  throw new DeviceSyncServiceError("internal_error", "Failed to parse enroll response", 500);
}

function successResponseFromCloud(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || typeof value.success !== "boolean") {
    throw new DeviceSyncServiceError("internal_error", "Failed to parse success response", 500);
  }
  return { success: value.success };
}

function createPairingResponseFromCloud(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new DeviceSyncServiceError("internal_error", "Failed to parse pairing response", 500);
  }
  return {
    pairingId: requiredString(value.pairingId ?? value.pairing_id, "pairing response"),
    expiresAt: requiredString(value.expiresAt ?? value.expires_at, "pairing response"),
    keyVersion: requiredI32(value.keyVersion ?? value.key_version, "pairing response"),
    requireSas: requiredBoolean(value.requireSas ?? value.require_sas, "pairing response"),
  };
}

function pairingFromCloud(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new DeviceSyncServiceError("internal_error", "Failed to parse pairing response", 500);
  }
  return {
    pairingId: requiredString(value.pairingId ?? value.pairing_id, "pairing response"),
    status: requiredPairingStatus(value.status),
    claimerDeviceId: optionalDeviceString(
      value.claimerDeviceId ?? value.claimer_device_id,
      "pairing response",
    ),
    claimerEphemeralPub: optionalDeviceString(
      value.claimerEphemeralPub ?? value.claimer_ephemeral_pub,
      "pairing response",
    ),
    expiresAt: requiredString(value.expiresAt ?? value.expires_at, "pairing response"),
  };
}

function completePairingResponseFromCloud(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || typeof value.success !== "boolean") {
    throw new DeviceSyncServiceError(
      "internal_error",
      "Failed to parse complete pairing response",
      500,
    );
  }
  const remoteSeedPresent = value.remoteSeedPresent ?? value.remote_seed_present;
  if (
    remoteSeedPresent !== undefined &&
    remoteSeedPresent !== null &&
    typeof remoteSeedPresent !== "boolean"
  ) {
    throw new DeviceSyncServiceError(
      "internal_error",
      "Failed to parse complete pairing response",
      500,
    );
  }
  return {
    success: value.success,
    remoteSeedPresent: remoteSeedPresent ?? null,
  };
}

function confirmPairingResponseFromCloud(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || typeof value.success !== "boolean") {
    throw new DeviceSyncServiceError(
      "internal_error",
      "Failed to parse confirm pairing response",
      500,
    );
  }
  const remoteSeedPresent = value.remoteSeedPresent ?? value.remote_seed_present;
  if (
    remoteSeedPresent !== undefined &&
    remoteSeedPresent !== null &&
    typeof remoteSeedPresent !== "boolean"
  ) {
    throw new DeviceSyncServiceError(
      "internal_error",
      "Failed to parse confirm pairing response",
      500,
    );
  }
  return {
    success: value.success,
    keyVersion: requiredI32(value.keyVersion ?? value.key_version, "confirm pairing response"),
    remoteSeedPresent: remoteSeedPresent ?? null,
  };
}

function claimPairingResponseFromCloud(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new DeviceSyncServiceError(
      "internal_error",
      "Failed to parse claim pairing response",
      500,
    );
  }
  return {
    sessionId: requiredString(value.sessionId ?? value.session_id, "claim pairing response"),
    issuerEphemeralPub: requiredString(
      value.issuerEphemeralPub ?? value.issuer_ephemeral_pub,
      "claim pairing response",
    ),
    e2eeKeyVersion: requiredI32(
      value.e2eeKeyVersion ?? value.e2ee_key_version,
      "claim pairing response",
    ),
    requireSas: requiredBoolean(value.requireSas ?? value.require_sas, "claim pairing response"),
    expiresAt: requiredString(value.expiresAt ?? value.expires_at, "claim pairing response"),
  };
}

function pairingMessagesFromCloud(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || !Array.isArray(value.messages)) {
    throw new DeviceSyncServiceError(
      "internal_error",
      "Failed to parse pairing messages response",
      500,
    );
  }
  return {
    sessionStatus: requiredPairingStatus(value.sessionStatus ?? value.session_status),
    messages: value.messages.map(pairingMessageFromCloud),
  };
}

function pairingMessageFromCloud(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new DeviceSyncServiceError(
      "internal_error",
      "Failed to parse pairing messages response",
      500,
    );
  }
  return {
    id: requiredString(value.id, "pairing messages response"),
    payloadType: requiredString(
      value.payloadType ?? value.payload_type,
      "pairing messages response",
    ),
    payload: requiredString(value.payload, "pairing messages response"),
    createdAt: requiredString(value.createdAt ?? value.created_at, "pairing messages response"),
  };
}

function initializeKeysResultFromCloud(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new DeviceSyncServiceError(
      "internal_error",
      "Failed to parse initialize keys response",
      500,
    );
  }
  const mode = requiredString(value.mode, "initialize keys response");
  if (mode === "BOOTSTRAP") {
    return {
      mode,
      challenge: requiredString(value.challenge, "initialize keys response"),
      nonce: requiredString(value.nonce, "initialize keys response"),
      key_version: requiredI32(value.keyVersion ?? value.key_version, "initialize keys response"),
    };
  }
  if (mode === "PAIRING_REQUIRED") {
    return {
      mode,
      e2ee_key_version: requiredI32(
        value.e2eeKeyVersion ?? value.e2ee_key_version,
        "initialize keys response",
      ),
      require_sas: requiredBoolean(
        value.requireSas ?? value.require_sas,
        "initialize keys response",
      ),
      pairing_ttl_seconds: requiredI32(
        value.pairingTtlSeconds ?? value.pairing_ttl_seconds,
        "initialize keys response",
      ),
      trusted_devices: trustedDevicesFromCloud(value.trustedDevices ?? value.trusted_devices),
    };
  }
  if (mode === "READY") {
    return {
      mode,
      e2ee_key_version: requiredI32(
        value.e2eeKeyVersion ?? value.e2ee_key_version,
        "initialize keys response",
      ),
    };
  }
  throw new DeviceSyncServiceError(
    "internal_error",
    "Failed to parse initialize keys response",
    500,
  );
}

function rotateKeysResponseFromCloud(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new DeviceSyncServiceError("internal_error", "Failed to parse rotate keys response", 500);
  }
  return {
    challenge: requiredString(value.challenge, "rotate keys response"),
    nonce: requiredString(value.nonce, "rotate keys response"),
    newKeyVersion: requiredI32(
      value.newKeyVersion ?? value.new_key_version,
      "rotate keys response",
    ),
  };
}

function commitInitializeKeysResponseFromCloud(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || typeof value.success !== "boolean") {
    throw new DeviceSyncServiceError(
      "internal_error",
      "Failed to parse commit initialize keys response",
      500,
    );
  }
  const keyState = requiredKeyState(
    value.keyState ?? value.key_state,
    "commit initialize keys response",
  );
  return {
    success: value.success,
    keyState,
  };
}

function commitRotateKeysResponseFromCloud(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || typeof value.success !== "boolean") {
    throw new DeviceSyncServiceError(
      "internal_error",
      "Failed to parse commit rotate keys response",
      500,
    );
  }
  return {
    success: value.success,
    keyVersion: requiredI32(value.keyVersion ?? value.key_version, "commit rotate keys response"),
  };
}

function resetTeamSyncResponseFromCloud(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || typeof value.success !== "boolean") {
    throw new DeviceSyncServiceError(
      "internal_error",
      "Failed to parse reset team sync response",
      500,
    );
  }
  return {
    success: value.success,
    keyVersion: requiredI32(value.keyVersion ?? value.key_version, "reset team sync response"),
    resetAt: optionalDeviceString(value.resetAt ?? value.reset_at, "reset team sync response"),
  };
}

function trustedDevicesFromCloud(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    throw new DeviceSyncServiceError(
      "internal_error",
      "Failed to parse initialize keys response",
      500,
    );
  }
  return value.map((entry) => {
    if (!isRecord(entry)) {
      throw new DeviceSyncServiceError(
        "internal_error",
        "Failed to parse initialize keys response",
        500,
      );
    }
    return {
      id: requiredString(entry.id, "initialize keys response"),
      name: requiredString(entry.name, "initialize keys response"),
      platform: requiredString(entry.platform, "initialize keys response"),
      lastSeenAt: optionalDeviceString(
        entry.lastSeenAt ?? entry.last_seen_at,
        "initialize keys response",
      ),
    };
  });
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
  deviceNonce: string | null;
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
  return {
    deviceId: optionalString(parsed.deviceId),
    deviceNonce: optionalString(parsed.deviceNonce),
  };
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

function isPairingAlreadyConfirmedError(error: unknown): boolean {
  if (!(error instanceof DeviceSyncServiceError)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    /api error \((400|409)\)/.test(message) &&
    (message.includes("already_confirmed") ||
      message.includes("already confirmed") ||
      message.includes("already completed"))
  );
}

function requiredBoolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") {
    throw new DeviceSyncServiceError("internal_error", `Failed to parse ${context}`, 500);
  }
  return value;
}

function requiredI32(value: unknown, context: string): number {
  if (!isI32Integer(value)) {
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

function requiredKeyState(value: unknown, context: string): string {
  if (value !== "ACTIVE" && value !== "PENDING") {
    throw new DeviceSyncServiceError("internal_error", `Failed to parse ${context}`, 500);
  }
  return value;
}

function requiredPairingStatus(value: unknown): string {
  if (
    value !== "open" &&
    value !== "claimed" &&
    value !== "approved" &&
    value !== "completed" &&
    value !== "cancelled" &&
    value !== "expired"
  ) {
    throw new DeviceSyncServiceError("internal_error", "Failed to parse pairing response", 500);
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

function applyMinSnapshotCreatedAtBestEffort(
  db: Database | undefined,
  deviceId: string,
  value: string | undefined,
): void {
  if (!db || value === undefined) {
    return;
  }
  const normalized = normalizeSyncDatetime(value);
  if (normalized === null) {
    console.warn(`[DeviceSync] Ignoring invalid minSnapshotCreatedAt value: ${value}`);
    return;
  }
  const parsedTime = new Date(normalized).getTime();
  if (parsedTime > Date.now() + 10 * 60 * 1000) {
    console.warn(`[DeviceSync] Ignoring minSnapshotCreatedAt too far in the future: ${value}`);
    return;
  }
  if (!sqliteColumnExists(db, "sync_device_config", "min_snapshot_created_at")) {
    return;
  }
  try {
    db.prepare(
      `
        INSERT INTO sync_device_config (
          device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
        ) VALUES (?, NULL, 'untrusted', NULL, ?)
        ON CONFLICT(device_id) DO UPDATE SET
          min_snapshot_created_at = excluded.min_snapshot_created_at
      `,
    ).run(deviceId, normalized);
  } catch (error) {
    console.warn(`[DeviceSync] Failed to persist freshness gate to SQLite: ${errorMessage(error)}`);
  }
}

function localBootstrapRequired(db: Database, deviceId: string): boolean {
  try {
    const row = db
      .query<{ last_bootstrap_at: string | null }, [string]>(
        `
          SELECT last_bootstrap_at
          FROM sync_device_config
          WHERE device_id = ?
        `,
      )
      .get(deviceId);
    if (!row || row.last_bootstrap_at === null) {
      return true;
    }
    const cycleStatus = db
      .query<
        { last_cycle_status: string | null },
        []
      >("SELECT last_cycle_status FROM sync_engine_state WHERE id = 1")
      .get()?.last_cycle_status;
    return cycleStatus === "stale_cursor";
  } catch {
    return true;
  }
}

async function abortPairingFlowLocalState({
  connectService,
  secretService,
  db,
  env,
  fetchImpl,
  pairingId,
}: {
  connectService: Pick<ConnectService, "restoreSyncSession"> | undefined;
  secretService: SecretService | undefined;
  db: Database | undefined;
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
  pairingId: string;
}): Promise<void> {
  let deviceId: string | null | undefined;
  if (secretService) {
    try {
      deviceId = await getLocalSyncIdentityDeviceId(secretService);
    } catch (error) {
      console.warn(`[DeviceSync] Failed to read sync identity while cancelling flow: ${error}`);
    }
  }

  if (deviceId && connectService) {
    try {
      const accessToken = await restoreAccessTokenOrDisabled(connectService);
      try {
        await fetchDeviceSyncJson(
          accessToken,
          env,
          fetchImpl,
          `/api/v1/sync/team/devices/${encodeURIComponent(deviceId)}/pairings/${encodeURIComponent(pairingId)}/cancel`,
          { method: "POST", deviceId },
        );
      } catch {
        // Rust intentionally ignores cloud pairing-cancel failures during flow abort.
      }
      try {
        await fetchDeviceSyncJson(
          accessToken,
          env,
          fetchImpl,
          `/api/v1/sync/team/devices/${encodeURIComponent(deviceId)}`,
          { method: "DELETE" },
        );
      } catch (error) {
        console.warn(
          `[DeviceSync] Failed to delete confirmed pairing device while cancelling flow: ${errorMessage(error)}`,
        );
      }
    } catch {
      // Match Rust's best-effort abort: local cleanup still proceeds if token minting fails.
    }
  }

  if (secretService) {
    try {
      await clearLocalSyncIdentityBestEffort(secretService);
    } catch (error) {
      console.warn(`[DeviceSync] Failed to clear sync identity while cancelling flow: ${error}`);
    }
    try {
      await secretService.deleteSecret(DEVICE_SYNC_DEVICE_ID_KEY);
    } catch (error) {
      console.warn(`[DeviceSync] Failed to delete sync device ID while cancelling flow: ${error}`);
    }
  }
  if (db) {
    try {
      resetLocalSyncSession(db);
    } catch (error) {
      console.warn(
        `[DeviceSync] Failed to reset local sync session while cancelling flow: ${error}`,
      );
    }
  }
}

async function clearLocalSyncIdentityBestEffort(secretService: SecretService): Promise<void> {
  let deviceNonce: string | null = null;
  const rawIdentity = await secretService.getSecret(DEVICE_SYNC_IDENTITY_KEY);
  if (rawIdentity) {
    try {
      deviceNonce = parseStoredSyncIdentity(rawIdentity).deviceNonce;
    } catch (error) {
      console.warn(`[DeviceSync] Failed to parse sync identity while cancelling flow: ${error}`);
    }
  }
  await secretService.setSecret(
    DEVICE_SYNC_IDENTITY_KEY,
    JSON.stringify({
      version: 2,
      deviceNonce,
      deviceId: null,
      rootKey: null,
      keyVersion: null,
      deviceSecretKey: null,
      devicePublicKey: null,
    }),
  );
}

function resetLocalSyncSession(db: Database): void {
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const tableName of [
      "sync_outbox",
      "sync_entity_metadata",
      "sync_applied_events",
      "sync_table_state",
      "sync_device_config",
    ]) {
      if (sqliteTableExists(db, tableName)) {
        db.prepare(`DELETE FROM "${tableName}"`).run();
      }
    }
    if (sqliteTableExists(db, "sync_cursor")) {
      db.prepare(
        `
          INSERT INTO sync_cursor (id, cursor, updated_at)
          VALUES (1, 0, ?)
          ON CONFLICT(id) DO UPDATE SET
            cursor = excluded.cursor,
            updated_at = excluded.updated_at
        `,
      ).run(now);
    }
    if (sqliteTableExists(db, "sync_engine_state")) {
      db.prepare(
        `
          INSERT INTO sync_engine_state (
            id, lock_version, last_push_at, last_pull_at, last_error,
            consecutive_failures, next_retry_at, last_cycle_status, last_cycle_duration_ms
          )
          VALUES (1, 0, NULL, NULL, NULL, 0, NULL, NULL, NULL)
          ON CONFLICT(id) DO UPDATE SET
            lock_version = excluded.lock_version,
            last_push_at = excluded.last_push_at,
            last_pull_at = excluded.last_pull_at,
            last_error = excluded.last_error,
            consecutive_failures = excluded.consecutive_failures,
            next_retry_at = excluded.next_retry_at,
            last_cycle_status = excluded.last_cycle_status,
            last_cycle_duration_ms = excluded.last_cycle_duration_ms
        `,
      ).run();
    }
  })();
}

async function notifyPairingComplete(
  onPairingComplete: (() => Promise<unknown> | unknown) | undefined,
): Promise<void> {
  if (!onPairingComplete) {
    return;
  }
  try {
    await onPairingComplete();
  } catch (error) {
    console.warn(`[DeviceSync] Post-pairing engine start failed: ${errorMessage(error)}`);
  }
}

function sqliteColumnExists(db: Database, tableName: string, columnName: string): boolean {
  return db
    .query<{ name: string }, []>(`PRAGMA table_info(${tableName})`)
    .all()
    .some((column) => column.name === columnName);
}

function sqliteTableExists(db: Database, tableName: string): boolean {
  return (
    db
      .query<
        { name: string },
        [string]
      >("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName) !== null
  );
}

function deviceSyncClientRequestId(deviceId: string | undefined): string {
  const requestUuid = randomUUID();
  const trimmedDeviceId = deviceId?.trim();
  if (trimmedDeviceId && isLogSafeRequestId(trimmedDeviceId)) {
    const candidate = `${trimmedDeviceId}:${requestUuid}`;
    if (isLogSafeRequestId(candidate)) {
      return candidate;
    }
  }
  return `app:${requestUuid}`;
}

function isLogSafeRequestId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 128 &&
    [...value].every((char) => /[A-Za-z0-9._:-]/.test(char))
  );
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
