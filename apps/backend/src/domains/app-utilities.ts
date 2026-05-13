export interface AppInfoResponse {
  version: string;
  dbPath: string;
  logsDir: string;
}

export interface UpdateCheckResponse {
  updateAvailable: boolean;
  latestVersion: string;
  notes?: string | null;
  pubDate?: string | null;
  downloadUrl?: string | null;
  changelogUrl?: string | null;
  screenshots?: string[] | null;
}

export interface BackupDatabaseResponse {
  filename: string;
  dataB64: string;
}

export interface BackupToPathResponse {
  path: string;
}

export interface AppUtilityService {
  getAppInfo(): Promise<AppInfoResponse> | AppInfoResponse;
  checkUpdate(force: boolean): Promise<UpdateCheckResponse> | UpdateCheckResponse;
  backupDatabase(): Promise<BackupDatabaseResponse> | BackupDatabaseResponse;
  backupDatabaseToPath(backupDir: string): Promise<BackupToPathResponse> | BackupToPathResponse;
  restoreDatabase(backupFilePath: string): Promise<void> | void;
}
