export interface PerformanceRequest {
  itemType: string;
  itemId: string;
  startDate?: string;
  endDate?: string;
  trackingMode?: "HOLDINGS" | "TRANSACTIONS";
}

export interface PortfolioMetricsService {
  getNetWorth(date?: string): Promise<unknown> | unknown;
  getNetWorthHistory(startDate: string, endDate: string): Promise<unknown[]> | unknown[];
  calculateAccountsSimplePerformance(accountIds?: string[]): Promise<unknown[]> | unknown[];
  calculatePerformanceHistory(request: PerformanceRequest): Promise<unknown> | unknown;
  calculatePerformanceSummary(request: PerformanceRequest): Promise<unknown> | unknown;
  getIncomeSummary(accountId?: string): Promise<unknown[]> | unknown[];
}
