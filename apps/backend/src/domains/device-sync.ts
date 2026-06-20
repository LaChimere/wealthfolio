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
const SNAPSHOT_FRESHNESS_CLOCK_SKEW_LEEWAY_MS = 120_000;
const WAITING_FOR_TRUSTED_SNAPSHOT_MESSAGE =
  "Snapshot is not available yet. Waiting for upload from a trusted device.";
const WAITING_FOR_FRESH_SNAPSHOT_MESSAGE =
  "Waiting for a snapshot generated after pairing confirmation";
const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

type I64Value = number | bigint;

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
  const pairingOverwriteApprovals = new Set<string>();

  return {
    ...disabledService,
    async registerDevice(request) {
      const accessToken = await restoreAccessTokenOrDisabled(connectService);
      if (!secretService) {
        throw deviceSyncDisabled();
      }
      const enrollResponse = await fetchDeviceSyncJsonRaw(
        accessToken,
        env,
        fetchImpl,
        "/api/v1/sync/team/devices",
        {
          method: "POST",
          body: {
            device_nonce: request.instanceId,
            display_name: request.displayName,
            platform: request.platform,
            os_version: request.osVersion,
            app_version: request.appVersion,
          },
        },
      );
      const result = enrollDeviceResponseFromCloud(enrollResponse.value, enrollResponse.bodyText);
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
      const devicesResponse = await fetchDeviceSyncJsonRaw(accessToken, env, fetchImpl, path);
      return devicesFromCloud(devicesResponse.value, devicesResponse.bodyText);
    },
    async getDevice(deviceId) {
      const accessToken = await restoreAccessTokenOrDisabled(connectService);
      return await fetchDeviceFromCloud(accessToken, env, fetchImpl, deviceId);
    },
    async updateDevice(deviceId, request) {
      const accessToken = await restoreAccessTokenOrDisabled(connectService);
      const updateResponse = await fetchDeviceSyncJsonRaw(
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
      );
      return successResponseFromCloud(updateResponse.value, updateResponse.bodyText);
    },
    async deleteDevice(deviceId) {
      const accessToken = await restoreAccessTokenOrDisabled(connectService);
      const deleteResponse = await fetchDeviceSyncJsonRaw(
        accessToken,
        env,
        fetchImpl,
        `/api/v1/sync/team/devices/${encodeURIComponent(deviceId)}`,
        { method: "DELETE" },
      );
      return successResponseFromCloud(deleteResponse.value, deleteResponse.bodyText);
    },
    async revokeDevice(deviceId) {
      const accessToken = await restoreAccessTokenOrDisabled(connectService);
      const revokeResponse = await fetchDeviceSyncJsonRaw(
        accessToken,
        env,
        fetchImpl,
        `/api/v1/sync/team/devices/${encodeURIComponent(deviceId)}/revoke`,
        { method: "POST" },
      );
      return successResponseFromCloud(revokeResponse.value, revokeResponse.bodyText);
    },
    async initializeTeamKeys() {
      const { accessToken, deviceId } = await requireSessionDeviceIdWithTokenOrDisabled(
        connectService,
        secretService,
      );
      const initializeResponse = await fetchDeviceSyncJsonRaw(
        accessToken,
        env,
        fetchImpl,
        "/api/v1/sync/team/keys/initialize",
        {
          method: "POST",
          deviceId,
          body: { device_id: deviceId },
        },
      );
      return initializeKeysResultFromCloud(initializeResponse.value, initializeResponse.bodyText);
    },
    async commitInitializeTeamKeys(request) {
      const { accessToken, deviceId } = await requireSessionDeviceIdWithTokenOrDisabled(
        connectService,
        secretService,
      );
      const commitInitializeResponse = await fetchDeviceSyncJsonRaw(
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
      );
      return commitInitializeKeysResponseFromCloud(
        commitInitializeResponse.value,
        commitInitializeResponse.bodyText,
      );
    },
    async rotateTeamKeys() {
      const { accessToken, deviceId } = await requireSessionDeviceIdWithTokenOrDisabled(
        connectService,
        secretService,
      );
      const rotateResponse = await fetchDeviceSyncJsonRaw(
        accessToken,
        env,
        fetchImpl,
        "/api/v1/sync/team/keys/rotate",
        {
          method: "POST",
          deviceId,
          body: { initiator_device_id: deviceId },
        },
      );
      return rotateKeysResponseFromCloud(rotateResponse.value, rotateResponse.bodyText);
    },
    async commitRotateTeamKeys(request) {
      const { accessToken, deviceId } = await requireSessionDeviceIdWithTokenOrDisabled(
        connectService,
        secretService,
      );
      const commitRotateResponse = await fetchDeviceSyncJsonRaw(
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
      );
      return commitRotateKeysResponseFromCloud(
        commitRotateResponse.value,
        commitRotateResponse.bodyText,
      );
    },
    async resetTeamSync(request) {
      const accessToken = await restoreAccessTokenOrDisabled(connectService);
      const resetResponse = await fetchDeviceSyncJsonRaw(
        accessToken,
        env,
        fetchImpl,
        "/api/v1/sync/team/keys/reset",
        {
          method: "POST",
          body: request.reason === undefined ? {} : { reason: request.reason },
        },
      );
      return resetTeamSyncResponseFromCloud(resetResponse.value, resetResponse.bodyText);
    },
    async createPairing(request) {
      const { accessToken, deviceId } = await requireSessionDeviceIdWithTokenOrDisabled(
        connectService,
        secretService,
      );
      const createPairingResponse = await fetchDeviceSyncJsonRaw(
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
      );
      return createPairingResponseFromCloud(
        createPairingResponse.value,
        createPairingResponse.bodyText,
      );
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
      const approveResponse = await fetchDeviceSyncJsonRaw(
        accessToken,
        env,
        fetchImpl,
        `/api/v1/sync/team/devices/${encodeURIComponent(deviceId)}/pairings/${encodeURIComponent(pairingId)}/approve`,
        { method: "POST", deviceId },
      );
      return successResponseFromCloud(approveResponse.value, approveResponse.bodyText);
    },
    async completePairing(pairingId, request) {
      const { accessToken, deviceId } = await requireSessionDeviceIdWithTokenOrDisabled(
        connectService,
        secretService,
      );
      const completeResponse = await fetchDeviceSyncJsonRaw(
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
      );
      const result = completePairingResponseFromCloud(
        completeResponse.value,
        completeResponse.bodyText,
      );
      void notifyPairingComplete(onPairingComplete);
      return result;
    },
    async cancelPairing(pairingId) {
      const { accessToken, deviceId } = await requireSessionDeviceIdWithTokenOrDisabled(
        connectService,
        secretService,
      );
      const cancelResponse = await fetchDeviceSyncJsonRaw(
        accessToken,
        env,
        fetchImpl,
        `/api/v1/sync/team/devices/${encodeURIComponent(deviceId)}/pairings/${encodeURIComponent(pairingId)}/cancel`,
        { method: "POST", deviceId },
      );
      return successResponseFromCloud(cancelResponse.value, cancelResponse.bodyText);
    },
    async claimPairing(request) {
      const { accessToken, deviceId } = await requireSessionDeviceIdWithTokenOrDisabled(
        connectService,
        secretService,
      );
      const claimResponse = await fetchDeviceSyncJsonRaw(
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
      );
      return claimPairingResponseFromCloud(claimResponse.value, claimResponse.bodyText);
    },
    async getPairingMessages(pairingId) {
      const { accessToken, deviceId } = await requireSessionDeviceIdWithTokenOrDisabled(
        connectService,
        secretService,
      );
      const messagesResponse = await fetchDeviceSyncJsonRaw(
        accessToken,
        env,
        fetchImpl,
        `/api/v1/sync/team/devices/${encodeURIComponent(deviceId)}/pairings/${encodeURIComponent(pairingId)}/messages`,
        { deviceId },
      );
      return pairingMessagesFromCloud(messagesResponse.value, messagesResponse.bodyText);
    },
    async confirmPairing(pairingId, request) {
      const { accessToken, deviceId } = await requireSessionDeviceIdWithTokenOrDisabled(
        connectService,
        secretService,
      );
      const confirmResponse = await fetchDeviceSyncJsonRaw(
        accessToken,
        env,
        fetchImpl,
        `/api/v1/sync/team/devices/${encodeURIComponent(deviceId)}/pairings/${encodeURIComponent(pairingId)}/confirm`,
        {
          method: "POST",
          deviceId,
          body: { proof: request.proof },
        },
      );
      const result = confirmPairingResponseFromCloud(
        confirmResponse.value,
        confirmResponse.bodyText,
      );
      applyMinSnapshotCreatedAtBestEffort(db, deviceId, request.minSnapshotCreatedAt);
      return result;
    },
    async completePairingWithTransfer(request) {
      const { accessToken, deviceId } =
        await requireCompositePairingPrerequisitesWithTokenOrDisabled(
          connectService,
          secretService,
        );
      if (db && localBootstrapRequired(db, deviceId)) {
        throw deviceSyncDisabled();
      }
      try {
        await fetchDeviceSyncJsonRaw(
          accessToken,
          env,
          fetchImpl,
          `/api/v1/sync/team/devices/${encodeURIComponent(deviceId)}/pairings/${encodeURIComponent(request.pairingId)}/approve`,
          { method: "POST", deviceId },
        ).then(({ value, bodyText }) => successResponseFromCloud(value, bodyText));
      } catch (error) {
        if (!isPairingAlreadyApprovedError(error)) {
          throw error;
        }
      }
      await fetchDeviceSyncJsonRaw(
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
      ).then(({ value, bodyText }) => completePairingResponseFromCloud(value, bodyText));
      void notifyPairingComplete(onPairingComplete);
      return { success: true };
    },
    async confirmPairingWithBootstrap(request) {
      const { accessToken, deviceId } =
        await requireCompositePairingPrerequisitesWithTokenOrDisabled(
          connectService,
          secretService,
        );
      try {
        await fetchDeviceSyncJsonRaw(
          accessToken,
          env,
          fetchImpl,
          `/api/v1/sync/team/devices/${encodeURIComponent(deviceId)}/pairings/${encodeURIComponent(request.pairingId)}/confirm`,
          {
            method: "POST",
            deviceId,
            body: request.proof === undefined ? {} : { proof: request.proof },
          },
        ).then(({ value, bodyText }) => confirmPairingResponseFromCloud(value, bodyText));
      } catch (error) {
        if (!isPairingAlreadyConfirmedError(error)) {
          throw error;
        }
      }
      applyMinSnapshotCreatedAtBestEffort(db, deviceId, request.minSnapshotCreatedAt);
      if (!db) {
        pairingOverwriteApprovals.delete(request.pairingId);
        return {
          status: "already_complete",
          message: "No bootstrap needed",
          localRows: null,
          nonEmptyTables: null,
        };
      }
      if (db && !localBootstrapRequired(db, deviceId)) {
        pairingOverwriteApprovals.delete(request.pairingId);
        return {
          status: "already_complete",
          message: "No bootstrap needed",
          localRows: null,
          nonEmptyTables: null,
        };
      }
      if (request.allowOverwrite) {
        pairingOverwriteApprovals.add(request.pairingId);
      }
      const overwriteApproved =
        request.allowOverwrite || pairingOverwriteApprovals.has(request.pairingId);
      if (db && !overwriteApproved) {
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
      const bootstrapWait = await latestSnapshotBootstrapWaitState(
        accessToken,
        env,
        fetchImpl,
        deviceId,
        db,
      );
      if (bootstrapWait.waiting) {
        return {
          status: "waiting_snapshot",
          message: bootstrapWait.message,
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
        await fetchDeviceSyncJsonRaw(
          accessToken,
          env,
          fetchImpl,
          `/api/v1/sync/team/devices/${encodeURIComponent(deviceId)}/pairings/${encodeURIComponent(request.pairingId)}/confirm`,
          {
            method: "POST",
            deviceId,
            body: { proof: request.proof },
          },
        ).then(({ value, bodyText }) => confirmPairingResponseFromCloud(value, bodyText));
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
      const bootstrapWait = await latestSnapshotBootstrapWaitState(
        accessToken,
        env,
        fetchImpl,
        deviceId,
        db,
      );
      if (bootstrapWait.waiting) {
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
      if (flow.phase.phase === "syncing" && flow.phase.detail === "waiting_snapshot") {
        try {
          const { accessToken, deviceId } =
            await requireCompositePairingPrerequisitesWithTokenOrDisabled(
              connectService,
              secretService,
            );
          const bootstrapWait = await latestSnapshotBootstrapWaitState(
            accessToken,
            env,
            fetchImpl,
            deviceId,
            db,
          );
          if (bootstrapWait.waiting) {
            return { flowId: request.flowId, phase: flow.phase };
          }
          const phase = { phase: "error", message: DEVICE_SYNC_DISABLED_MESSAGE };
          pairingFlows.delete(request.flowId);
          pairingOverwriteApprovals.delete(flow.pairingId);
          return { flowId: request.flowId, phase };
        } catch (error) {
          const phase = { phase: "error", message: errorMessage(error) };
          pairingFlows.delete(request.flowId);
          pairingOverwriteApprovals.delete(flow.pairingId);
          return { flowId: request.flowId, phase };
        }
      }
      return { flowId: request.flowId, phase: flow.phase };
    },
    async approvePairingOverwrite(request) {
      const flow = pairingFlows.get(request.flowId);
      if (!flow) {
        throw new DeviceSyncServiceError("internal_error", "Flow not found", 500);
      }
      if (flow.phase.phase !== "overwrite_required") {
        throw new DeviceSyncServiceError(
          "internal_error",
          "Flow is not in overwrite_required phase",
          500,
        );
      }
      const { accessToken, deviceId } =
        await requireCompositePairingPrerequisitesWithTokenOrDisabled(
          connectService,
          secretService,
        );
      pairingOverwriteApprovals.add(flow.pairingId);
      try {
        const bootstrapWait = await latestSnapshotBootstrapWaitState(
          accessToken,
          env,
          fetchImpl,
          deviceId,
          db,
        );
        if (bootstrapWait.waiting) {
          const phase = { phase: "syncing", detail: "waiting_snapshot" };
          pairingFlows.set(request.flowId, { ...flow, phase });
          return { flowId: request.flowId, phase };
        }
      } catch (error) {
        const phase = { phase: "error", message: errorMessage(error) };
        pairingFlows.delete(request.flowId);
        pairingOverwriteApprovals.delete(flow.pairingId);
        return { flowId: request.flowId, phase };
      }
      const phase = { phase: "error", message: DEVICE_SYNC_DISABLED_MESSAGE };
      pairingFlows.delete(request.flowId);
      pairingOverwriteApprovals.delete(flow.pairingId);
      return { flowId: request.flowId, phase };
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
        if (flow) {
          pairingOverwriteApprovals.delete(flow.pairingId);
        }
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
  const deviceResponse = await fetchDeviceSyncJsonRaw(
    accessToken,
    env,
    fetchImpl,
    `/api/v1/sync/team/devices/${encodeURIComponent(deviceId)}`,
  );
  return deviceFromCloud(deviceResponse.value, deviceResponse.bodyText);
}

async function fetchPairingFromCloud(
  accessToken: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  deviceId: string,
  pairingId: string,
): Promise<Record<string, unknown>> {
  const pairingResponse = await fetchDeviceSyncJsonRaw(
    accessToken,
    env,
    fetchImpl,
    `/api/v1/sync/team/devices/${encodeURIComponent(deviceId)}/pairings/${encodeURIComponent(pairingId)}`,
    { deviceId },
  );
  return pairingFromCloud(pairingResponse.value, pairingResponse.bodyText);
}

async function fetchDeviceSyncJson(
  accessToken: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  path: string,
  options: { method?: string; body?: unknown; deviceId?: string } = {},
): Promise<unknown> {
  return (await fetchDeviceSyncJsonRaw(accessToken, env, fetchImpl, path, options)).value;
}

async function fetchDeviceSyncJsonRaw(
  accessToken: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  path: string,
  options: { method?: string; body?: unknown; deviceId?: string } = {},
): Promise<{ value: unknown; bodyText: string }> {
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
    return { value: JSON.parse(bodyText) as unknown, bodyText };
  } catch (error) {
    throw new DeviceSyncServiceError(
      "internal_error",
      `Failed to parse response: ${errorMessage(error)} ${metadata}`,
      500,
    );
  }
}

async function latestSnapshotBootstrapWaitState(
  accessToken: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  deviceId: string,
  db: Database | undefined,
): Promise<{ waiting: boolean; message: string }> {
  const freshnessGate = getLocalMinSnapshotCreatedAt(db, deviceId);
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
    return {
      waiting: true,
      message: freshnessGate
        ? WAITING_FOR_FRESH_SNAPSHOT_MESSAGE
        : WAITING_FOR_TRUSTED_SNAPSHOT_MESSAGE,
    };
  }
  if (!response.ok) {
    const requestId = response.headers.get("x-request-id")?.trim() || "none";
    throw deviceSyncApiError(
      response.status,
      bodyText,
      `(clientRequestId=${clientRequestId}, requestId=${requestId})`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText) as unknown;
  } catch (error) {
    throw new DeviceSyncServiceError(
      "internal_error",
      `Failed to parse response: ${errorMessage(error)}`,
      500,
    );
  }
  const latest = latestSnapshotBootstrapMetadata(parsed, bodyText);
  if (latest.schemaVersion > 1) {
    throw new DeviceSyncServiceError(
      "internal_error",
      `Snapshot schema version ${latest.schemaVersion} is newer than local version 1. Please update the app.`,
      500,
    );
  }
  if (!latest.snapshotId.trim()) {
    throw new DeviceSyncServiceError(
      "internal_error",
      "Latest snapshot metadata had empty snapshot_id. No valid snapshot available.",
      500,
    );
  }
  if (!freshnessGate) {
    return { waiting: false, message: "" };
  }
  if (
    latest.createdAt.getTime() + SNAPSHOT_FRESHNESS_CLOCK_SKEW_LEEWAY_MS >
    freshnessGate.getTime()
  ) {
    return { waiting: false, message: "" };
  }
  const remoteCursor = await readRemoteCursorForFreshnessGate(
    accessToken,
    env,
    fetchImpl,
    deviceId,
  );
  if (remoteCursor !== null && compareI64Values(latest.oplogSeq, remoteCursor) >= 0) {
    return { waiting: false, message: "" };
  }
  return { waiting: true, message: WAITING_FOR_FRESH_SNAPSHOT_MESSAGE };
}

function latestSnapshotBootstrapMetadata(
  value: unknown,
  rawJson: string,
): {
  snapshotId: string;
  schemaVersion: number;
  coversTables: string[];
  createdAt: Date;
  oplogSeq: I64Value;
  sizeBytes: I64Value;
  checksum: string;
} {
  assertLatestSnapshotRawShape(rawJson);
  if (!isRecord(value)) {
    throw latestSnapshotParseError();
  }
  const rawSnapshotId = value.snapshotId ?? value.snapshot_id;
  if (typeof rawSnapshotId !== "string") {
    throw latestSnapshotParseError();
  }
  const rawSchemaVersion = value.schemaVersion ?? value.schema_version;
  if (!isI32Integer(rawSchemaVersion)) {
    throw latestSnapshotParseError();
  }
  const rawCoversTables = value.coversTables ?? value.covers_tables;
  if (
    !Array.isArray(rawCoversTables) ||
    rawCoversTables.some((entry) => typeof entry !== "string")
  ) {
    throw latestSnapshotParseError();
  }
  const rawCreatedAt = value.createdAt ?? value.created_at;
  if (typeof rawCreatedAt !== "string") {
    throw latestSnapshotParseError();
  }
  const normalizedCreatedAt = normalizeSyncDatetime(rawCreatedAt);
  if (normalizedCreatedAt === null) {
    throw new DeviceSyncServiceError(
      "internal_error",
      "Invalid snapshot created_at in metadata",
      500,
    );
  }
  const rawOplogSeq = requiredI64FromRawJson(rawJson, ["oplogSeq", "oplog_seq"]);
  const rawSizeBytes = requiredI64FromRawJson(rawJson, ["sizeBytes", "size_bytes"]);
  const rawChecksum = value.checksum;
  if (typeof rawChecksum !== "string") {
    throw latestSnapshotParseError();
  }
  return {
    snapshotId: rawSnapshotId,
    schemaVersion: rawSchemaVersion,
    coversTables: rawCoversTables,
    createdAt: new Date(normalizedCreatedAt),
    oplogSeq: rawOplogSeq,
    sizeBytes: rawSizeBytes,
    checksum: rawChecksum,
  };
}

function assertLatestSnapshotRawShape(rawJson: string): void {
  const entries = topLevelJsonEntries(rawJson);
  for (const aliases of [
    ["snapshotId", "snapshot_id"],
    ["schemaVersion", "schema_version"],
    ["coversTables", "covers_tables"],
    ["createdAt", "created_at"],
    ["oplogSeq", "oplog_seq"],
    ["sizeBytes", "size_bytes"],
    ["checksum"],
  ]) {
    if (entries.filter((entry) => aliases.includes(entry.key)).length > 1) {
      throw latestSnapshotParseError();
    }
  }
  assertRawIntegerToken(rawJson, "schemaVersion");
  assertRawIntegerToken(rawJson, "schema_version");
  assertRawIntegerToken(rawJson, "oplogSeq");
  assertRawIntegerToken(rawJson, "oplog_seq");
  assertRawIntegerToken(rawJson, "sizeBytes");
  assertRawIntegerToken(rawJson, "size_bytes");
}

function assertRawIntegerToken(rawJson: string, key: string): void {
  for (const token of topLevelJsonValueTokens(rawJson, key)) {
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token) && /[.eE]/.test(token)) {
      throw latestSnapshotParseError();
    }
  }
}

function latestSnapshotParseError(): DeviceSyncServiceError {
  return new DeviceSyncServiceError(
    "internal_error",
    "Failed to parse latest snapshot response",
    500,
  );
}

async function readRemoteCursorForFreshnessGate(
  accessToken: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  deviceId: string,
): Promise<I64Value | null> {
  try {
    const cursorResponse = await fetchDeviceSyncJsonRaw(
      accessToken,
      env,
      fetchImpl,
      "/api/v1/sync/events/cursor",
      { deviceId },
    );
    if (!validSyncCursorRawShape(cursorResponse.bodyText)) {
      return null;
    }
    if (!isRecord(cursorResponse.value)) {
      return null;
    }
    return requiredI64FromRawJson(cursorResponse.bodyText, ["cursor"]);
  } catch {
    return null;
  }
}

function requiredI64FromRawJson(
  rawJson: string,
  aliases: string[],
  parseError: () => Error = latestSnapshotParseError,
): I64Value {
  const tokens = rawTokensForAliases(rawJson, aliases);
  if (tokens.length !== 1 || !rawJsonI64TokenIsValid(tokens[0] ?? "")) {
    throw parseError();
  }
  const parsed = BigInt(tokens[0] ?? "0");
  if (parsed >= MIN_SAFE_BIGINT && parsed <= MAX_SAFE_BIGINT) {
    return Number(parsed);
  }
  return parsed;
}

function compareI64Values(left: I64Value, right: I64Value): number {
  const leftBigInt = typeof left === "bigint" ? left : BigInt(left);
  const rightBigInt = typeof right === "bigint" ? right : BigInt(right);
  if (leftBigInt === rightBigInt) {
    return 0;
  }
  return leftBigInt > rightBigInt ? 1 : -1;
}

function validSyncCursorRawShape(rawJson: string): boolean {
  const cursorTokens = rawTokensForAliases(rawJson, ["cursor"]);
  const gcWatermarkTokens = rawTokensForAliases(rawJson, ["gcWatermark", "gc_watermark"]);
  const latestSnapshotTokens = rawTokensForAliases(rawJson, ["latestSnapshot", "latest_snapshot"]);
  return (
    cursorTokens.length === 1 &&
    rawJsonI64TokenIsValid(cursorTokens[0] ?? "") &&
    gcWatermarkTokens.length <= 1 &&
    (gcWatermarkTokens.length === 0 || rawJsonI64OptionTokenIsValid(gcWatermarkTokens[0] ?? "")) &&
    latestSnapshotTokens.length <= 1 &&
    (latestSnapshotTokens.length === 0 ||
      rawJsonLatestSnapshotRefTokenIsValid(latestSnapshotTokens[0] ?? ""))
  );
}

function rawJsonLatestSnapshotRefTokenIsValid(token: string): boolean {
  const trimmed = token.trim();
  if (trimmed === "null") {
    return true;
  }
  const entries = topLevelJsonEntries(trimmed);
  if (entries.length === 0) {
    return false;
  }
  const snapshotIdTokens = rawTokensForAliases(trimmed, ["snapshotId", "snapshot_id"]);
  const schemaVersionTokens = rawTokensForAliases(trimmed, ["schemaVersion", "schema_version"]);
  const oplogSeqTokens = rawTokensForAliases(trimmed, ["oplogSeq", "oplog_seq"]);
  return (
    snapshotIdTokens.length === 1 &&
    rawJsonStringTokenIsValid(snapshotIdTokens[0] ?? "") &&
    schemaVersionTokens.length === 1 &&
    rawJsonI32TokenIsValid(schemaVersionTokens[0] ?? "") &&
    oplogSeqTokens.length === 1 &&
    rawJsonI64TokenIsValid(oplogSeqTokens[0] ?? "")
  );
}

function rawJsonI32TokenIsValid(token: string): boolean {
  return rawJsonIntegerTokenIsInRange(token, -2_147_483_648n, 2_147_483_647n);
}

function rawJsonI64TokenIsValid(token: string): boolean {
  return rawJsonIntegerTokenIsInRange(
    token,
    -9_223_372_036_854_775_808n,
    9_223_372_036_854_775_807n,
  );
}

function rawJsonI64OptionTokenIsValid(token: string): boolean {
  const trimmed = token.trim();
  return trimmed === "null" || rawJsonI64TokenIsValid(trimmed);
}

function rawJsonIntegerTokenIsInRange(token: string, min: bigint, max: bigint): boolean {
  const trimmed = token.trim();
  if (!/^-?(?:0|[1-9]\d*)$/.test(trimmed)) {
    return false;
  }
  const parsed = BigInt(trimmed);
  return parsed >= min && parsed <= max;
}

function devicesFromCloud(value: unknown, rawJson: string | null = null): unknown[] {
  if (!Array.isArray(value)) {
    throw new DeviceSyncServiceError("internal_error", "Failed to parse devices response", 500);
  }
  const rawDeviceTokens = rawJson === null ? [] : topLevelArrayObjectTokens(rawJson);
  return value.map((entry, index) => deviceFromCloud(entry, rawDeviceTokens[index] ?? null));
}

function deviceFromCloud(value: unknown, rawJson: string | null = null): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new DeviceSyncServiceError("internal_error", "Failed to parse device response", 500);
  }
  if (rawJson !== null) {
    assertDeviceRawShape(rawJson);
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

function assertDeviceRawShape(rawJson: string): void {
  for (const aliases of [
    ["id"],
    ["userId", "user_id"],
    ["displayName", "display_name"],
    ["platform"],
    ["devicePublicKey", "device_public_key"],
    ["trustState", "trust_state"],
    ["trustedKeyVersion", "trusted_key_version"],
    ["osVersion", "os_version"],
    ["appVersion", "app_version"],
    ["lastSeenAt", "last_seen_at"],
    ["createdAt", "created_at"],
  ]) {
    if (rawTokensForAliases(rawJson, aliases).length > 1) {
      throw new DeviceSyncServiceError("internal_error", "Failed to parse device response", 500);
    }
  }
}

function enrollDeviceResponseFromCloud(
  value: unknown,
  rawJson: string | null = null,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new DeviceSyncServiceError("internal_error", "Failed to parse enroll response", 500);
  }
  if (rawJson !== null) {
    assertEnrollResponseRawShape(rawJson);
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

function assertEnrollResponseRawShape(rawJson: string): void {
  const modeTokens = topLevelJsonValueTokens(rawJson, "mode");
  if (modeTokens.length !== 1 || !rawJsonStringTokenIsValid(modeTokens[0] ?? "")) {
    throw enrollResponseParseError();
  }
  for (const aliases of [
    ["deviceId", "device_id"],
    ["e2eeKeyVersion", "e2ee_key_version"],
    ["trustState", "trust_state"],
    ["requireSas", "require_sas"],
    ["pairingTtlSeconds", "pairing_ttl_seconds"],
    ["trustedDevices", "trusted_devices"],
  ]) {
    if (rawTokensForAliases(rawJson, aliases).length > 1) {
      throw enrollResponseParseError();
    }
  }
  assertEnrollRawIntegerToken(rawJson, "e2eeKeyVersion");
  assertEnrollRawIntegerToken(rawJson, "e2ee_key_version");
  assertEnrollRawIntegerToken(rawJson, "pairingTtlSeconds");
  assertEnrollRawIntegerToken(rawJson, "pairing_ttl_seconds");
  if (rawJsonStringTokenValue(modeTokens[0] ?? "") === "PAIR") {
    assertTrustedDeviceSummariesRawShape(
      rawJson,
      ["trustedDevices", "trusted_devices"],
      enrollResponseParseError,
    );
  }
}

function assertEnrollRawIntegerToken(rawJson: string, key: string): void {
  for (const token of topLevelJsonValueTokens(rawJson, key)) {
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token) && /[.eE]/.test(token)) {
      throw enrollResponseParseError();
    }
  }
}

function enrollResponseParseError(): DeviceSyncServiceError {
  return new DeviceSyncServiceError("internal_error", "Failed to parse enroll response", 500);
}

function successResponseFromCloud(
  value: unknown,
  rawJson: string | null = null,
): Record<string, unknown> {
  if (!isRecord(value) || typeof value.success !== "boolean") {
    throw new DeviceSyncServiceError("internal_error", "Failed to parse success response", 500);
  }
  if (rawJson !== null && topLevelJsonValueTokens(rawJson, "success").length !== 1) {
    throw new DeviceSyncServiceError("internal_error", "Failed to parse success response", 500);
  }
  return { success: value.success };
}

function createPairingResponseFromCloud(
  value: unknown,
  rawJson: string | null = null,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new DeviceSyncServiceError("internal_error", "Failed to parse pairing response", 500);
  }
  if (rawJson !== null) {
    assertCreatePairingResponseRawShape(rawJson);
  }
  return {
    pairingId: requiredString(value.pairingId ?? value.pairing_id, "pairing response"),
    expiresAt: requiredString(value.expiresAt ?? value.expires_at, "pairing response"),
    keyVersion: requiredI32(value.keyVersion ?? value.key_version, "pairing response"),
    requireSas: requiredBoolean(value.requireSas ?? value.require_sas, "pairing response"),
  };
}

function assertCreatePairingResponseRawShape(rawJson: string): void {
  for (const aliases of [
    ["pairingId", "pairing_id"],
    ["expiresAt", "expires_at"],
    ["keyVersion", "key_version"],
    ["requireSas", "require_sas"],
  ]) {
    if (rawTokensForAliases(rawJson, aliases).length > 1) {
      throw pairingResponseParseError();
    }
  }
  assertPairingRawIntegerToken(rawJson, "keyVersion");
  assertPairingRawIntegerToken(rawJson, "key_version");
}

function assertPairingRawIntegerToken(rawJson: string, key: string): void {
  for (const token of topLevelJsonValueTokens(rawJson, key)) {
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token) && /[.eE]/.test(token)) {
      throw pairingResponseParseError();
    }
  }
}

function pairingResponseParseError(): DeviceSyncServiceError {
  return new DeviceSyncServiceError("internal_error", "Failed to parse pairing response", 500);
}

function pairingFromCloud(value: unknown, rawJson: string | null = null): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new DeviceSyncServiceError("internal_error", "Failed to parse pairing response", 500);
  }
  if (rawJson !== null) {
    assertGetPairingResponseRawShape(rawJson);
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

function assertGetPairingResponseRawShape(rawJson: string): void {
  for (const aliases of [
    ["pairingId", "pairing_id"],
    ["status"],
    ["claimerDeviceId", "claimer_device_id"],
    ["claimerEphemeralPub", "claimer_ephemeral_pub"],
    ["expiresAt", "expires_at"],
  ]) {
    if (rawTokensForAliases(rawJson, aliases).length > 1) {
      throw pairingResponseParseError();
    }
  }
}

function completePairingResponseFromCloud(
  value: unknown,
  rawJson: string | null = null,
): Record<string, unknown> {
  if (!isRecord(value) || typeof value.success !== "boolean") {
    throw new DeviceSyncServiceError(
      "internal_error",
      "Failed to parse complete pairing response",
      500,
    );
  }
  if (rawJson !== null) {
    assertCompletePairingResponseRawShape(rawJson);
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

function assertCompletePairingResponseRawShape(rawJson: string): void {
  for (const aliases of [["success"], ["remoteSeedPresent", "remote_seed_present"]]) {
    if (rawTokensForAliases(rawJson, aliases).length > 1) {
      throw completePairingResponseParseError();
    }
  }
}

function completePairingResponseParseError(): DeviceSyncServiceError {
  return new DeviceSyncServiceError(
    "internal_error",
    "Failed to parse complete pairing response",
    500,
  );
}

function confirmPairingResponseFromCloud(
  value: unknown,
  rawJson: string | null = null,
): Record<string, unknown> {
  if (!isRecord(value) || typeof value.success !== "boolean") {
    throw new DeviceSyncServiceError(
      "internal_error",
      "Failed to parse confirm pairing response",
      500,
    );
  }
  if (rawJson !== null) {
    assertConfirmPairingResponseRawShape(rawJson);
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

function assertConfirmPairingResponseRawShape(rawJson: string): void {
  for (const aliases of [
    ["success"],
    ["keyVersion", "key_version"],
    ["remoteSeedPresent", "remote_seed_present"],
  ]) {
    if (rawTokensForAliases(rawJson, aliases).length > 1) {
      throw confirmPairingResponseParseError();
    }
  }
  assertConfirmPairingRawIntegerToken(rawJson, "keyVersion");
  assertConfirmPairingRawIntegerToken(rawJson, "key_version");
}

function assertConfirmPairingRawIntegerToken(rawJson: string, key: string): void {
  for (const token of topLevelJsonValueTokens(rawJson, key)) {
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token) && /[.eE]/.test(token)) {
      throw confirmPairingResponseParseError();
    }
  }
}

function confirmPairingResponseParseError(): DeviceSyncServiceError {
  return new DeviceSyncServiceError(
    "internal_error",
    "Failed to parse confirm pairing response",
    500,
  );
}

function claimPairingResponseFromCloud(
  value: unknown,
  rawJson: string | null = null,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new DeviceSyncServiceError(
      "internal_error",
      "Failed to parse claim pairing response",
      500,
    );
  }
  if (rawJson !== null) {
    assertClaimPairingResponseRawShape(rawJson);
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

function assertClaimPairingResponseRawShape(rawJson: string): void {
  for (const aliases of [
    ["sessionId", "session_id"],
    ["issuerEphemeralPub", "issuer_ephemeral_pub"],
    ["e2eeKeyVersion", "e2ee_key_version"],
    ["requireSas", "require_sas"],
    ["expiresAt", "expires_at"],
  ]) {
    if (rawTokensForAliases(rawJson, aliases).length > 1) {
      throw claimPairingResponseParseError();
    }
  }
  assertClaimPairingRawIntegerToken(rawJson, "e2eeKeyVersion");
  assertClaimPairingRawIntegerToken(rawJson, "e2ee_key_version");
}

function assertClaimPairingRawIntegerToken(rawJson: string, key: string): void {
  for (const token of topLevelJsonValueTokens(rawJson, key)) {
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token) && /[.eE]/.test(token)) {
      throw claimPairingResponseParseError();
    }
  }
}

function claimPairingResponseParseError(): DeviceSyncServiceError {
  return new DeviceSyncServiceError(
    "internal_error",
    "Failed to parse claim pairing response",
    500,
  );
}

function pairingMessagesFromCloud(
  value: unknown,
  rawJson: string | null = null,
): Record<string, unknown> {
  if (!isRecord(value) || !Array.isArray(value.messages)) {
    throw new DeviceSyncServiceError(
      "internal_error",
      "Failed to parse pairing messages response",
      500,
    );
  }
  if (rawJson !== null) {
    assertPairingMessagesResponseRawShape(rawJson);
  }
  return {
    sessionStatus: requiredPairingStatus(value.sessionStatus ?? value.session_status),
    messages: value.messages.map(pairingMessageFromCloud),
  };
}

function assertPairingMessagesResponseRawShape(rawJson: string): void {
  for (const aliases of [["sessionStatus", "session_status"], ["messages"]]) {
    if (rawTokensForAliases(rawJson, aliases).length > 1) {
      throw pairingMessagesResponseParseError();
    }
  }
  for (const messageToken of topLevelArrayObjectTokens(
    rawTokensForAliases(rawJson, ["messages"])[0],
  )) {
    for (const aliases of [
      ["id"],
      ["payloadType", "payload_type"],
      ["payload"],
      ["createdAt", "created_at"],
    ]) {
      if (rawTokensForAliases(messageToken, aliases).length > 1) {
        throw pairingMessagesResponseParseError();
      }
    }
  }
}

function pairingMessagesResponseParseError(): DeviceSyncServiceError {
  return new DeviceSyncServiceError(
    "internal_error",
    "Failed to parse pairing messages response",
    500,
  );
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

function initializeKeysResultFromCloud(
  value: unknown,
  rawJson: string | null = null,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new DeviceSyncServiceError(
      "internal_error",
      "Failed to parse initialize keys response",
      500,
    );
  }
  if (rawJson !== null) {
    assertInitializeKeysResponseRawShape(rawJson);
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

function assertInitializeKeysResponseRawShape(rawJson: string): void {
  const modeTokens = topLevelJsonValueTokens(rawJson, "mode");
  if (modeTokens.length !== 1 || !rawJsonStringTokenIsValid(modeTokens[0] ?? "")) {
    throw initializeKeysResponseParseError();
  }
  for (const aliases of [
    ["challenge"],
    ["nonce"],
    ["keyVersion", "key_version"],
    ["e2eeKeyVersion", "e2ee_key_version"],
    ["requireSas", "require_sas"],
    ["pairingTtlSeconds", "pairing_ttl_seconds"],
    ["trustedDevices", "trusted_devices"],
  ]) {
    if (rawTokensForAliases(rawJson, aliases).length > 1) {
      throw initializeKeysResponseParseError();
    }
  }
  assertInitializeKeysRawIntegerToken(rawJson, "keyVersion");
  assertInitializeKeysRawIntegerToken(rawJson, "key_version");
  assertInitializeKeysRawIntegerToken(rawJson, "e2eeKeyVersion");
  assertInitializeKeysRawIntegerToken(rawJson, "e2ee_key_version");
  assertInitializeKeysRawIntegerToken(rawJson, "pairingTtlSeconds");
  assertInitializeKeysRawIntegerToken(rawJson, "pairing_ttl_seconds");
  if (rawJsonStringTokenValue(modeTokens[0] ?? "") === "PAIRING_REQUIRED") {
    assertTrustedDeviceSummariesRawShape(
      rawJson,
      ["trustedDevices", "trusted_devices"],
      initializeKeysResponseParseError,
    );
  }
}

function assertTrustedDeviceSummariesRawShape(
  rawJson: string,
  aliases: string[],
  parseError: () => DeviceSyncServiceError,
): void {
  const tokens = rawTokensForAliases(rawJson, aliases);
  if (tokens.length !== 1 || !tokens[0]?.trim().startsWith("[")) {
    return;
  }
  for (const token of topLevelArrayObjectTokens(tokens[0])) {
    for (const fieldAliases of [["id"], ["name"], ["platform"], ["lastSeenAt", "last_seen_at"]]) {
      if (rawTokensForAliases(token, fieldAliases).length > 1) {
        throw parseError();
      }
    }
  }
}

function assertInitializeKeysRawIntegerToken(rawJson: string, key: string): void {
  for (const token of topLevelJsonValueTokens(rawJson, key)) {
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token) && /[.eE]/.test(token)) {
      throw initializeKeysResponseParseError();
    }
  }
}

function initializeKeysResponseParseError(): DeviceSyncServiceError {
  return new DeviceSyncServiceError(
    "internal_error",
    "Failed to parse initialize keys response",
    500,
  );
}

function rotateKeysResponseFromCloud(
  value: unknown,
  rawJson: string | null = null,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new DeviceSyncServiceError("internal_error", "Failed to parse rotate keys response", 500);
  }
  if (rawJson !== null) {
    assertRotateKeysResponseRawShape(rawJson);
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

function assertRotateKeysResponseRawShape(rawJson: string): void {
  for (const aliases of [["challenge"], ["nonce"], ["newKeyVersion", "new_key_version"]]) {
    if (rawTokensForAliases(rawJson, aliases).length > 1) {
      throw rotateKeysResponseParseError();
    }
  }
  assertRotateKeysRawIntegerToken(rawJson, "newKeyVersion");
  assertRotateKeysRawIntegerToken(rawJson, "new_key_version");
}

function assertRotateKeysRawIntegerToken(rawJson: string, key: string): void {
  for (const token of topLevelJsonValueTokens(rawJson, key)) {
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token) && /[.eE]/.test(token)) {
      throw rotateKeysResponseParseError();
    }
  }
}

function rotateKeysResponseParseError(): DeviceSyncServiceError {
  return new DeviceSyncServiceError("internal_error", "Failed to parse rotate keys response", 500);
}

function commitInitializeKeysResponseFromCloud(
  value: unknown,
  rawJson: string | null = null,
): Record<string, unknown> {
  if (!isRecord(value) || typeof value.success !== "boolean") {
    throw new DeviceSyncServiceError(
      "internal_error",
      "Failed to parse commit initialize keys response",
      500,
    );
  }
  if (rawJson !== null) {
    assertCommitInitializeKeysResponseRawShape(rawJson);
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

function assertCommitInitializeKeysResponseRawShape(rawJson: string): void {
  for (const aliases of [["success"], ["keyState", "key_state"]]) {
    if (rawTokensForAliases(rawJson, aliases).length > 1) {
      throw commitInitializeKeysResponseParseError();
    }
  }
}

function commitInitializeKeysResponseParseError(): DeviceSyncServiceError {
  return new DeviceSyncServiceError(
    "internal_error",
    "Failed to parse commit initialize keys response",
    500,
  );
}

function commitRotateKeysResponseFromCloud(
  value: unknown,
  rawJson: string | null = null,
): Record<string, unknown> {
  if (!isRecord(value) || typeof value.success !== "boolean") {
    throw new DeviceSyncServiceError(
      "internal_error",
      "Failed to parse commit rotate keys response",
      500,
    );
  }
  if (rawJson !== null) {
    assertCommitRotateKeysResponseRawShape(rawJson);
  }
  return {
    success: value.success,
    keyVersion: requiredI32(value.keyVersion ?? value.key_version, "commit rotate keys response"),
  };
}

function assertCommitRotateKeysResponseRawShape(rawJson: string): void {
  for (const aliases of [["success"], ["keyVersion", "key_version"]]) {
    if (rawTokensForAliases(rawJson, aliases).length > 1) {
      throw commitRotateKeysResponseParseError();
    }
  }
  assertCommitRotateKeysRawIntegerToken(rawJson, "keyVersion");
  assertCommitRotateKeysRawIntegerToken(rawJson, "key_version");
}

function assertCommitRotateKeysRawIntegerToken(rawJson: string, key: string): void {
  for (const token of topLevelJsonValueTokens(rawJson, key)) {
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token) && /[.eE]/.test(token)) {
      throw commitRotateKeysResponseParseError();
    }
  }
}

function commitRotateKeysResponseParseError(): DeviceSyncServiceError {
  return new DeviceSyncServiceError(
    "internal_error",
    "Failed to parse commit rotate keys response",
    500,
  );
}

function resetTeamSyncResponseFromCloud(
  value: unknown,
  rawJson: string | null = null,
): Record<string, unknown> {
  if (!isRecord(value) || typeof value.success !== "boolean") {
    throw new DeviceSyncServiceError(
      "internal_error",
      "Failed to parse reset team sync response",
      500,
    );
  }
  if (rawJson !== null) {
    assertResetTeamSyncResponseRawShape(rawJson);
  }
  return {
    success: value.success,
    keyVersion: requiredI32(value.keyVersion ?? value.key_version, "reset team sync response"),
    resetAt: optionalDeviceString(value.resetAt ?? value.reset_at, "reset team sync response"),
  };
}

function assertResetTeamSyncResponseRawShape(rawJson: string): void {
  for (const aliases of [["success"], ["keyVersion", "key_version"], ["resetAt", "reset_at"]]) {
    if (rawTokensForAliases(rawJson, aliases).length > 1) {
      throw resetTeamSyncResponseParseError();
    }
  }
  assertResetTeamSyncRawIntegerToken(rawJson, "keyVersion");
  assertResetTeamSyncRawIntegerToken(rawJson, "key_version");
}

function assertResetTeamSyncRawIntegerToken(rawJson: string, key: string): void {
  for (const token of topLevelJsonValueTokens(rawJson, key)) {
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token) && /[.eE]/.test(token)) {
      throw resetTeamSyncResponseParseError();
    }
  }
}

function resetTeamSyncResponseParseError(): DeviceSyncServiceError {
  return new DeviceSyncServiceError(
    "internal_error",
    "Failed to parse reset team sync response",
    500,
  );
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
        if (!validDeviceSyncApiErrorResponseShape(trimmed, parsed)) {
          return new DeviceSyncServiceError(
            "internal_error",
            `API error (${status}): Request failed: ${trimmed} ${metadata}`,
            500,
          );
        }
        const code = optionalString(parsed.code) ?? optionalString(parsed.error) ?? "";
        const message = parsed.message;
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

function validDeviceSyncApiErrorResponseShape(
  rawJson: string,
  parsed: Record<string, unknown>,
): parsed is Record<string, unknown> & { message: string } {
  if (
    rawTokensForAliases(rawJson, ["error"]).length > 1 ||
    rawTokensForAliases(rawJson, ["code"]).length > 1 ||
    rawTokensForAliases(rawJson, ["message"]).length > 1 ||
    rawTokensForAliases(rawJson, ["details"]).length > 1
  ) {
    return false;
  }
  return (
    (parsed.error === undefined || typeof parsed.error === "string") &&
    (parsed.code === undefined || typeof parsed.code === "string") &&
    typeof parsed.message === "string"
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

function isPairingAlreadyApprovedError(error: unknown): boolean {
  if (!(error instanceof DeviceSyncServiceError)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    /api error \((400|409)\)/.test(message) &&
    (message.includes("already_approved") || message.includes("already approved"))
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
  if (typeof value !== "number" || !Number.isFinite(value)) {
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

function rawJsonStringTokenIsValid(token: string): boolean {
  return token.trim().startsWith('"');
}

function rawJsonStringTokenValue(token: string): string | null {
  if (!rawJsonStringTokenIsValid(token)) {
    return null;
  }
  try {
    const parsed = JSON.parse(token.trim()) as unknown;
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return null;
  }
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

function rawTokensForAliases(rawJson: string, aliases: string[]): string[] {
  return aliases.flatMap((alias) => topLevelJsonValueTokens(rawJson, alias));
}

function topLevelArrayObjectTokens(rawJson: string | undefined): string[] {
  const trimmed = rawJson?.trim() ?? "";
  if (!trimmed.startsWith("[")) {
    return [];
  }
  const tokens: string[] = [];
  let index = 1;
  while (index < trimmed.length) {
    index = skipJsonWhitespace(trimmed, index);
    if (trimmed[index] === "]") {
      break;
    }
    const start = index;
    index = skipJsonValue(trimmed, index);
    if (index < 0) {
      return [];
    }
    const token = trimmed.slice(start, index).trim();
    if (token.startsWith("{")) {
      tokens.push(token);
    }
    index = skipJsonWhitespace(trimmed, index);
    if (trimmed[index] === ",") {
      index += 1;
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

function getLocalMinSnapshotCreatedAt(db: Database | undefined, deviceId: string): Date | null {
  if (!db || !sqliteColumnExists(db, "sync_device_config", "min_snapshot_created_at")) {
    return null;
  }
  const row = db
    .query<{ min_snapshot_created_at: string | null }, [string]>(
      `
        SELECT min_snapshot_created_at
        FROM sync_device_config
        WHERE device_id = ?
      `,
    )
    .get(deviceId);
  if (!row?.min_snapshot_created_at) {
    return null;
  }
  const normalized = normalizeSyncDatetime(row.min_snapshot_created_at);
  if (normalized === null) {
    console.warn(
      `[DeviceSync] Dropping invalid min snapshot freshness gate: ${row.min_snapshot_created_at}`,
    );
    db.prepare(
      `
        UPDATE sync_device_config
        SET min_snapshot_created_at = NULL
        WHERE device_id = ?
      `,
    ).run(deviceId);
    return null;
  }
  return new Date(normalized);
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
