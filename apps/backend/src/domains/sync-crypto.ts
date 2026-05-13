export interface SyncCryptoStringResponse {
  value: string;
}

export interface SyncCryptoEphemeralKeyPair {
  publicKey: string;
  secretKey: string;
}

export interface SyncCryptoService {
  generateRootKey(): Promise<SyncCryptoStringResponse> | SyncCryptoStringResponse;
  deriveDek(
    rootKey: string,
    version: number,
  ): Promise<SyncCryptoStringResponse> | SyncCryptoStringResponse;
  generateKeypair(): Promise<SyncCryptoEphemeralKeyPair> | SyncCryptoEphemeralKeyPair;
  computeSharedSecret(
    ourSecret: string,
    theirPublic: string,
  ): Promise<SyncCryptoStringResponse> | SyncCryptoStringResponse;
  deriveSessionKey(
    sharedSecret: string,
    context: string,
  ): Promise<SyncCryptoStringResponse> | SyncCryptoStringResponse;
  encrypt(
    key: string,
    plaintext: string,
  ): Promise<SyncCryptoStringResponse> | SyncCryptoStringResponse;
  decrypt(
    key: string,
    ciphertext: string,
  ): Promise<SyncCryptoStringResponse> | SyncCryptoStringResponse;
  generatePairingCode(): Promise<SyncCryptoStringResponse> | SyncCryptoStringResponse;
  hashPairingCode(code: string): Promise<SyncCryptoStringResponse> | SyncCryptoStringResponse;
  hmacSha256(
    key: string,
    data: string,
  ): Promise<SyncCryptoStringResponse> | SyncCryptoStringResponse;
  computeSas(sharedSecret: string): Promise<SyncCryptoStringResponse> | SyncCryptoStringResponse;
  generateDeviceId(): Promise<SyncCryptoStringResponse> | SyncCryptoStringResponse;
}
