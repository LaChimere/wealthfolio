import type { MarketSyncMode } from "./portfolio-jobs";

export interface ResolveSymbolQuoteRequest {
  symbol: string;
  exchangeMic?: string;
  instrumentType?: string;
  quoteCcy?: string;
  providerId?: string;
}

export interface MarketDataService {
  getExchanges(): Promise<unknown[]> | unknown[];
  searchSymbol(query: string): Promise<unknown[]> | unknown[];
  resolveSymbolQuote(request: ResolveSymbolQuoteRequest): Promise<unknown> | unknown;
  getQuoteHistory(symbol: string): Promise<unknown[]> | unknown[];
  fetchYahooDividends(symbol: string): Promise<unknown[]> | unknown[];
  getLatestQuotes(assetIds: string[]): Promise<unknown> | unknown;
  updateQuote(symbol: string, quote: Record<string, unknown>): Promise<void> | void;
  deleteQuote(id: string): Promise<void> | void;
  checkQuotesImport(content: Uint8Array, hasHeaderRow: boolean): Promise<unknown[]> | unknown[];
  importQuotesCsv(quotes: unknown[], overwriteExisting: boolean): Promise<unknown[]> | unknown[];
  syncHistoryQuotes(): Promise<void> | void;
  syncMarketData(marketSyncMode: MarketSyncMode): Promise<void> | void;
}
