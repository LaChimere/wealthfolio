// Web adapter - Sync Crypto Commands
// These call the web command registry for E2EE cryptographic operations.

import type { EphemeralKeyPair } from "../types";
import { invoke } from "./core";

// Response type for endpoints that return a single string value
interface StringResponse {
  value: string;
}

export const syncGenerateRootKey = async (): Promise<string> => {
  const response = await invoke<StringResponse>("sync_generate_root_key");
  return response.value;
};

export const syncDeriveDek = async (rootKey: string, version: number): Promise<string> => {
  const response = await invoke<StringResponse>("sync_derive_dek", { rootKey, version });
  return response.value;
};

export const syncGenerateKeypair = async (): Promise<EphemeralKeyPair> => {
  return await invoke<EphemeralKeyPair>("sync_generate_keypair");
};

export const syncComputeSharedSecret = async (
  ourSecret: string,
  theirPublic: string,
): Promise<string> => {
  const response = await invoke<StringResponse>("sync_compute_shared_secret", {
    ourSecret,
    theirPublic,
  });
  return response.value;
};

export const syncDeriveSessionKey = async (
  sharedSecret: string,
  context: string,
): Promise<string> => {
  const response = await invoke<StringResponse>("sync_derive_session_key", {
    sharedSecret,
    context,
  });
  return response.value;
};

export const syncEncrypt = async (key: string, plaintext: string): Promise<string> => {
  const response = await invoke<StringResponse>("sync_encrypt", { key, plaintext });
  return response.value;
};

export const syncDecrypt = async (key: string, ciphertext: string): Promise<string> => {
  const response = await invoke<StringResponse>("sync_decrypt", { key, ciphertext });
  return response.value;
};

export const syncGeneratePairingCode = async (): Promise<string> => {
  const response = await invoke<StringResponse>("sync_generate_pairing_code");
  return response.value;
};

export const syncHashPairingCode = async (code: string): Promise<string> => {
  const response = await invoke<StringResponse>("sync_hash_pairing_code", { code });
  return response.value;
};

export const syncHmacSha256 = async (key: string, data: string): Promise<string> => {
  const response = await invoke<StringResponse>("sync_hmac_sha256", { key, data });
  return response.value;
};

export const syncComputeSas = async (sharedSecret: string): Promise<string> => {
  const response = await invoke<StringResponse>("sync_compute_sas", { sharedSecret });
  return response.value;
};

export const syncGenerateDeviceId = async (): Promise<string> => {
  const response = await invoke<StringResponse>("sync_generate_device_id");
  return response.value;
};
