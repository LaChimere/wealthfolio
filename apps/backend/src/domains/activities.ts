export const ACTIVITY_IMPORT_CONTEXT_KIND = "ACTIVITY";

export interface ActivitySearchRequest {
  page: number;
  pageSize: number;
  accountIds?: string[];
  activityTypes?: string[];
  assetIdKeyword?: string;
  sort?: { id: string; desc: boolean };
  needsReview?: boolean;
  dateFrom?: string;
  dateTo?: string;
  instrumentTypes?: string[];
}

export interface ActivityParseCsvRequest {
  content: Uint8Array;
  config: Record<string, unknown>;
}

export interface ActivityService {
  searchActivities(request: ActivitySearchRequest): Promise<unknown> | unknown;
  createActivity(activity: Record<string, unknown>): Promise<unknown> | unknown;
  updateActivity(activity: Record<string, unknown>): Promise<unknown> | unknown;
  bulkMutateActivities(request: Record<string, unknown>): Promise<unknown> | unknown;
  deleteActivity(id: string): Promise<unknown> | unknown;
  linkTransferActivities(activityAId: string, activityBId: string): Promise<unknown[]> | unknown[];
  unlinkTransferActivities(
    activityAId: string,
    activityBId: string,
  ): Promise<unknown[]> | unknown[];
  checkActivitiesImport(activities: unknown[]): Promise<unknown[]> | unknown[];
  previewImportAssets(candidates: unknown[]): Promise<unknown[]> | unknown[];
  importActivities(activities: unknown[]): Promise<unknown> | unknown;
  parseCsv(request: ActivityParseCsvRequest): Promise<unknown> | unknown;
  getImportMapping(accountId: string, contextKind: string): Promise<unknown> | unknown;
  saveImportMapping(mapping: Record<string, unknown>): Promise<unknown> | unknown;
  listImportTemplates(): Promise<unknown[]> | unknown[];
  getImportTemplate(id: string): Promise<unknown> | unknown;
  saveImportTemplate(template: Record<string, unknown>): Promise<unknown> | unknown;
  deleteImportTemplate(id: string): Promise<void> | void;
  linkAccountTemplate(
    accountId: string,
    templateId: string,
    contextKind: string,
  ): Promise<void> | void;
  checkExistingDuplicates(
    idempotencyKeys: string[],
  ): Promise<Record<string, string>> | Record<string, string>;
}
