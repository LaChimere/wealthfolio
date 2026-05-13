export interface SecretService {
  setSecret(secretKey: string, secret: string): Promise<void> | void;
  getSecret(secretKey: string): Promise<string | null> | string | null;
  deleteSecret(secretKey: string): Promise<void> | void;
}
