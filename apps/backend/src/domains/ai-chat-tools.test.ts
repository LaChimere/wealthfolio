import { describe, expect, test } from "bun:test";

import { createPortfolioAiChatTools } from "./ai-chat-tools";
import type { Account } from "./accounts";
import type { ActivityDetails, ActivitySearchRequest } from "./activities";
import type { Goal } from "./goals";
import type { HealthStatus } from "./health";
import type {
  AllocationHoldings,
  DailyAccountValuation,
  Holding,
  PortfolioAllocations,
} from "./holdings";
import type { SymbolSearchResult } from "./market-data";
import type { IncomeSummary, PerformanceMetrics, PerformanceRequest } from "./portfolio-metrics";

describe("TS AI chat built-in tools", () => {
  test("exposes Rust-compatible get_accounts output", async () => {
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [
          account({ id: "acct-1", name: "Brokerage", accountType: "SECURITIES", currency: "USD" }),
          account({ id: "acct-2", name: "Retirement", accountType: "RETIREMENT", currency: "CAD" }),
        ],
      },
    });

    const getAccounts = tools.find((tool) => tool.name === "get_accounts");
    expect(getAccounts).toMatchObject({
      description: expect.stringContaining("active investment accounts"),
      parameters: {
        type: "object",
        properties: expect.objectContaining({
          displayMode: expect.objectContaining({ enum: ["full", "compact"] }),
        }),
        required: [],
      },
    });

    const result = await getAccounts?.execute({ displayMode: "compact" });

    expect(result).toEqual({
      data: {
        accounts: [
          {
            id: "acct-1",
            name: "Brokerage",
            accountType: "SECURITIES",
            currency: "USD",
            isActive: true,
          },
          {
            id: "acct-2",
            name: "Retirement",
            accountType: "RETIREMENT",
            currency: "CAD",
            isActive: true,
          },
        ],
        count: 2,
      },
    });
  });

  test("truncates get_accounts output at Rust-compatible account limit", async () => {
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () =>
          Array.from({ length: 55 }, (_, index) =>
            account({ id: `acct-${index}`, name: `Account ${index}` }),
          ),
      },
    });

    const result = await tools[0]?.execute({});

    expect(result).toMatchObject({
      data: {
        count: 50,
        truncated: true,
        originalCount: 55,
      },
    });
  });

  test("returns Rust-compatible record_activity buy draft without side effects", async () => {
    const symbolQueries: string[] = [];
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [
          account({ id: "acct-1", name: "Brokerage", currency: "USD" }),
          account({ id: "acct-2", name: "Retirement", currency: "CAD" }),
        ],
      },
      marketDataService: {
        searchSymbol: (query) => {
          symbolQueries.push(query);
          return [
            symbolSearchResult({
              symbol: "AAPL",
              longName: "Apple Inc.",
              currency: "USD",
              existingAssetId: "asset-aapl",
              exchangeName: "NASDAQ",
              exchangeMic: "XNAS",
              quoteType: "EQUITY",
            }),
          ];
        },
      },
      now: () => new Date("2026-01-18T04:00:00.000Z"),
      timezone: "America/New_York",
    });

    const recordActivity = tools.find((tool) => tool.name === "record_activity");
    expect(recordActivity).toMatchObject({
      description: expect.stringContaining("current date there is 2026-01-17 (Saturday)"),
      parameters: {
        type: "object",
        properties: expect.objectContaining({
          activityType: expect.objectContaining({
            enum: expect.arrayContaining(["BUY", "SELL", "UNKNOWN"]),
          }),
          activityDate: expect.objectContaining({
            description: expect.stringContaining("Resolve them relative to current local date"),
          }),
          account: expect.objectContaining({ type: "string" }),
        }),
        required: ["activityType", "activityDate"],
      },
    });

    const result = await recordActivity?.execute({
      activityType: "buy",
      symbol: "AAPL",
      activityDate: "2026-01-17",
      quantity: 20,
      unitPrice: 240,
      fee: 1,
      account: "Brokerage",
      notes: "AI draft",
    });

    expect(symbolQueries).toEqual(["AAPL"]);
    expect(result).toEqual({
      data: {
        draft: {
          activityType: "BUY",
          activityDate: "2026-01-17",
          symbol: "AAPL",
          assetId: "asset-aapl",
          assetName: "Apple Inc.",
          quantity: 20,
          unitPrice: 240,
          amount: 4801,
          fee: 1,
          currency: "USD",
          accountId: "acct-1",
          accountName: "Brokerage",
          subtype: null,
          notes: "AI draft",
          priceSource: "user",
          pricingMode: "MARKET",
          isCustomAsset: false,
          assetKind: null,
        },
        validation: { isValid: true, missingFields: [], errors: [] },
        availableAccounts: [
          { id: "acct-1", name: "Brokerage", currency: "USD" },
          { id: "acct-2", name: "Retirement", currency: "CAD" },
        ],
        resolvedAsset: {
          assetId: "asset-aapl",
          symbol: "AAPL",
          name: "Apple Inc.",
          currency: "USD",
          exchange: "NASDAQ",
          exchangeMic: "XNAS",
          instrumentType: "EQUITY",
        },
        availableSubtypes: [],
      },
    });
  });

  test("auto-selects the only account for record_activity cash flow drafts", async () => {
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [account({ id: "acct-1", name: "Solo", currency: "CAD" })],
      },
      baseCurrency: "USD",
    });

    const result = await tools
      .find((tool) => tool.name === "record_activity")
      ?.execute({
        activityType: "DEPOSIT",
        activityDate: "2026-01-17",
        amount: 5000,
      });

    expect(result).toMatchObject({
      data: {
        draft: {
          activityType: "DEPOSIT",
          amount: 5000,
          currency: "CAD",
          accountId: "acct-1",
          accountName: "Solo",
          isCustomAsset: false,
        },
        validation: { isValid: true, missingFields: [], errors: [] },
      },
    });
  });

  test("prefers account-currency symbol matches for record_activity assets", async () => {
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [account({ id: "acct-1", name: "CAD Account", currency: "CAD" })],
      },
      marketDataService: {
        searchSymbol: () => [
          symbolSearchResult({
            symbol: "SHOP",
            longName: "Shopify Inc.",
            currency: "USD",
            exchangeName: "NYSE",
            exchangeMic: "XNYS",
            score: 100,
          }),
          symbolSearchResult({
            symbol: "SHOP.TO",
            longName: "Shopify Inc.",
            currency: "CAD",
            exchangeName: "Toronto Stock Exchange",
            exchangeMic: "XTSE",
            score: 80,
          }),
        ],
      },
    });

    const result = await tools
      .find((tool) => tool.name === "record_activity")
      ?.execute({
        activityType: "BUY",
        activityDate: "2026-01-17",
        symbol: "SHOP",
        quantity: 1,
        unitPrice: 100,
      });

    expect(result).toMatchObject({
      data: {
        draft: {
          assetId: "SHOP.TO:XTSE",
          assetName: "Shopify Inc.",
          currency: "CAD",
        },
        resolvedAsset: {
          symbol: "SHOP.TO",
          currency: "CAD",
          exchangeMic: "XTSE",
        },
      },
    });
  });

  test("returns record_activity account and custom asset validation prompts", async () => {
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [
          account({ id: "acct-1", name: "Brokerage" }),
          account({ id: "acct-2", name: "Retirement" }),
        ],
      },
      marketDataService: {
        searchSymbol: () => [],
      },
    });

    const result = await tools
      .find((tool) => tool.name === "record_activity")
      ?.execute({
        activityType: "BUY",
        activityDate: "2026-01-17",
        symbol: "PRIVATE_FUND",
        quantity: 1,
        amount: 1000,
      });

    expect(result).toMatchObject({
      data: {
        draft: {
          assetName: "PRIVATE_FUND",
          isCustomAsset: true,
          accountId: null,
        },
        validation: {
          isValid: false,
          missingFields: ["account_id", "asset_kind"],
          errors: [],
        },
        resolvedAsset: null,
      },
    });
  });

  test("normalizes invalid record_activity type and validates dates", async () => {
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [account({ id: "acct-1", name: "Solo" })],
      },
    });

    const result = await tools
      .find((tool) => tool.name === "record_activity")
      ?.execute({
        activityType: "bonus_payment",
        activityDate: "tomorrow",
        amount: 25,
      });

    expect(result).toMatchObject({
      data: {
        draft: {
          activityType: "UNKNOWN",
          accountId: "acct-1",
        },
        validation: {
          isValid: false,
          missingFields: [],
          errors: [
            {
              field: "activity_date",
              message: "Invalid date format. Expected YYYY-MM-DD or ISO 8601",
            },
          ],
        },
      },
    });
  });

  test("returns record_activity subtype options and subtype-specific requirements", async () => {
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [account({ id: "acct-1", name: "Solo" })],
      },
      marketDataService: {
        searchSymbol: () => [
          symbolSearchResult({
            symbol: "VTI",
            longName: "Vanguard Total Stock Market ETF",
            currency: "USD",
            quoteType: "ETF",
          }),
        ],
      },
    });

    const result = await tools
      .find((tool) => tool.name === "record_activity")
      ?.execute({
        activityType: "DIVIDEND",
        activityDate: "2026-01-17",
        symbol: "VTI",
        quantity: 2,
        subtype: "DRIP",
      });

    expect(result).toMatchObject({
      data: {
        draft: {
          activityType: "DIVIDEND",
          subtype: "DRIP",
          quantity: 2,
          amount: null,
          unitPrice: null,
        },
        validation: {
          isValid: false,
          missingFields: ["unit_price"],
          errors: [],
        },
        availableSubtypes: [
          { value: "DRIP", label: "Dividend Reinvested (DRIP)" },
          { value: "DIVIDEND_IN_KIND", label: "Dividend in Kind" },
        ],
      },
    });
  });

  test("returns Rust-compatible record_activities batch drafts", async () => {
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [account({ id: "acct-1", name: "Main Broker", currency: "USD" })],
      },
    });

    const recordActivities = tools.find((tool) => tool.name === "record_activities");
    expect(recordActivities).toMatchObject({
      description: expect.stringContaining("Record multiple investment transactions"),
      parameters: {
        type: "object",
        properties: expect.objectContaining({
          activities: expect.objectContaining({
            type: "array",
            items: expect.objectContaining({
              required: ["activityType", "activityDate"],
            }),
          }),
        }),
        required: ["activities"],
      },
    });

    const result = await recordActivities?.execute({
      activities: [
        { activityType: "DEPOSIT", activityDate: "2026-01-17", amount: 1000 },
        { activityType: "WITHDRAWAL", activityDate: "2026-01-18", amount: 500 },
      ],
    });

    expect(result).toMatchObject({
      data: {
        drafts: [
          {
            rowIndex: 0,
            draft: { activityType: "DEPOSIT", accountId: "acct-1", amount: 1000 },
            validation: { isValid: true, missingFields: [], errors: [] },
            errors: [],
          },
          {
            rowIndex: 1,
            draft: { activityType: "WITHDRAWAL", accountId: "acct-1", amount: 500 },
            validation: { isValid: true, missingFields: [], errors: [] },
            errors: [],
          },
        ],
        validation: { totalRows: 2, validRows: 2, errorRows: 0 },
        availableAccounts: [{ id: "acct-1", name: "Main Broker", currency: "USD" }],
        resolvedAssets: [],
      },
    });
  });

  test("returns record_activities row errors and validation summary", async () => {
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [account({ id: "acct-1", name: "Main Broker" })],
      },
    });

    const result = await tools
      .find((tool) => tool.name === "record_activities")
      ?.execute({
        activities: [
          { activityType: "DEPOSIT", activityDate: "2026-01-17", amount: 1000 },
          { activityType: "DEPOSIT", activityDate: "2026-01-17" },
          { activityType: "SELL", activityDate: "2026-01-17", symbol: "AAPL", quantity: 2 },
        ],
      });

    expect(result).toMatchObject({
      data: {
        validation: { totalRows: 3, validRows: 1, errorRows: 2 },
        drafts: [
          expect.objectContaining({ rowIndex: 0, errors: [] }),
          expect.objectContaining({
            rowIndex: 1,
            validation: expect.objectContaining({ missingFields: ["amount"] }),
            errors: ["Missing required field: amount"],
          }),
          expect.objectContaining({
            rowIndex: 2,
            validation: expect.objectContaining({ missingFields: ["unit_price", "asset_kind"] }),
            errors: ["Missing required field: unit_price", "Missing required field: asset_kind"],
          }),
        ],
      },
    });
  });

  test("deduplicates resolved assets across record_activities rows", async () => {
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [account({ id: "acct-1", name: "Main Broker" })],
      },
      marketDataService: {
        searchSymbol: () => [
          symbolSearchResult({
            symbol: "AAPL",
            longName: "Apple Inc.",
            existingAssetId: "asset-aapl",
          }),
        ],
      },
    });

    const result = await tools
      .find((tool) => tool.name === "record_activities")
      ?.execute({
        activities: [
          {
            activityType: "BUY",
            activityDate: "2026-01-17",
            symbol: "AAPL",
            quantity: 1,
            unitPrice: 100,
          },
          {
            activityType: "SELL",
            activityDate: "2026-01-18",
            symbol: "AAPL",
            quantity: 1,
            unitPrice: 110,
          },
        ],
      });

    expect(result).toMatchObject({
      data: {
        validation: { totalRows: 2, validRows: 2, errorRows: 0 },
        resolvedAssets: [
          {
            assetId: "asset-aapl",
            symbol: "AAPL",
            name: "Apple Inc.",
          },
        ],
      },
    });
    expect((result?.data as { resolvedAssets: unknown[] }).resolvedAssets).toHaveLength(1);
  });

  test("limits record_activities batch size", async () => {
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [account({ id: "acct-1", name: "Main Broker" })],
      },
    });

    await expect(
      tools
        .find((tool) => tool.name === "record_activities")
        ?.execute({
          activities: Array.from({ length: 101 }, () => ({
            activityType: "DEPOSIT",
            activityDate: "2026-01-17",
            amount: 1,
          })),
        }),
    ).rejects.toThrow("Batch limited to 100 activities, got 101");
  });

  test("keeps record_activities empty batches Rust-compatible", async () => {
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => {
          throw new Error("empty batch should not fetch accounts");
        },
      },
    });

    await expect(
      tools.find((tool) => tool.name === "record_activities")?.execute({ activities: [] }),
    ).resolves.toEqual({
      data: {
        drafts: [],
        validation: { totalRows: 0, validRows: 0, errorRows: 0 },
        availableAccounts: [],
        resolvedAssets: [],
      },
    });
  });

  test("returns Rust-compatible import_csv mapping inference output", async () => {
    const seenCsv: string[] = [];
    const seenConfigs: Record<string, unknown>[] = [];
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [account({ id: "acct-1", name: "Brokerage", currency: "CAD" })],
      },
      activityService: {
        parseCsv: (request) => {
          seenCsv.push(new TextDecoder().decode(request.content));
          seenConfigs.push(request.config);
          return {
            headers: ["Date", "Symbol", "Quantity", "Price", "Type", "Total"],
            rows: [
              ["2026-01-17", "AAPL", "2", "100", "Buy", "200"],
              ["2026-01-18", "MSFT", "1", "50", "Sell", "50"],
            ],
            rowCount: 2,
          };
        },
      },
      baseCurrency: "CAD",
    });

    const importCsv = tools.find((tool) => tool.name === "import_csv");
    expect(importCsv).toMatchObject({
      description: expect.stringContaining("REQUIRED for CSV file imports"),
      parameters: {
        type: "object",
        properties: expect.objectContaining({
          csvContent: expect.objectContaining({ type: "string" }),
          accountId: expect.objectContaining({ type: ["string", "null"] }),
          fieldMappings: expect.objectContaining({ type: ["object", "null"] }),
        }),
        required: ["csvContent"],
        additionalProperties: false,
      },
    });

    const result = await importCsv?.execute({
      csvContent: "Date,Symbol,Quantity,Price,Type,Total\n2026-01-17,AAPL,2,100,Buy,200",
    });

    expect(seenCsv).toEqual([
      "Date,Symbol,Quantity,Price,Type,Total\n2026-01-17,AAPL,2,100,Buy,200",
    ]);
    expect(seenConfigs).toEqual([
      {
        delimiter: undefined,
        skipTopRows: undefined,
        skipBottomRows: undefined,
        dateFormat: null,
        decimalSeparator: null,
        thousandsSeparator: null,
        defaultCurrency: "CAD",
      },
    ]);
    expect(result).toMatchObject({
      data: {
        appliedMapping: {
          accountId: "",
          contextKind: "CSV_ACTIVITY",
          name: "",
          fieldMappings: {
            date: "Date",
            symbol: "Symbol",
            quantity: "Quantity",
            unitPrice: "Price",
            amount: "Total",
            activityType: "Type",
          },
          activityMappings: {
            BUY: expect.arrayContaining(["BUY", "BOUGHT", "PURCHASE"]),
            SELL: expect.arrayContaining(["SELL", "SOLD"]),
          },
          symbolMappings: {},
          accountMappings: {},
          symbolMappingMeta: {},
          parseConfig: {
            defaultCurrency: "CAD",
          },
        },
        parseConfig: {
          defaultCurrency: "CAD",
        },
        accountId: null,
        detectedHeaders: ["Date", "Symbol", "Quantity", "Price", "Type", "Total"],
        sampleRows: [
          ["2026-01-17", "AAPL", "2", "100", "Buy", "200"],
          ["2026-01-18", "MSFT", "1", "50", "Sell", "50"],
        ],
        totalRows: 2,
        mappingConfidence: "HIGH",
        availableAccounts: [{ id: "acct-1", name: "Brokerage", currency: "CAD" }],
        usedSavedProfile: false,
      },
    });
  });

  test("merges import_csv LLM mappings and sanitizes account mappings", async () => {
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [account({ id: "acct-1", name: "Brokerage" })],
      },
      activityService: {
        parseCsv: () => ({
          headers: ["Trade Date", "Transaction", "Security"],
          rows: [["17/01/2026", "Achat", "Apple Inc"]],
          rowCount: 1,
        }),
      },
      baseCurrency: "USD",
    });

    const result = await tools
      .find((tool) => tool.name === "import_csv")
      ?.execute({
        csvContent: "Trade Date;Transaction;Security\n17/01/2026;Achat;Apple Inc",
        accountId: "acct-1",
        fieldMappings: {
          date: "Trade Date",
          activityType: "Transaction",
          symbol: "Security",
        },
        activityMappings: { BUY: ["Achat", "BUY", ""] },
        symbolMappings: { "Apple Inc": "AAPL", Unknown: "" },
        accountMappings: { Main: "acct-1", Other: "missing", Empty: "" },
        delimiter: ";",
        dateFormat: "%d/%m/%Y",
        decimalSeparator: ",",
        thousandsSeparator: ".",
        defaultCurrency: "EUR",
      });

    expect(result).toMatchObject({
      data: {
        appliedMapping: {
          accountId: "acct-1",
          fieldMappings: {
            date: "Trade Date",
            activityType: "Transaction",
            symbol: "Security",
          },
          activityMappings: {
            BUY: expect.arrayContaining(["BUY", "PURCHASE", "Achat"]),
          },
          symbolMappings: { "Apple Inc": "AAPL" },
          accountMappings: { Main: "acct-1" },
          parseConfig: {
            delimiter: ";",
            dateFormat: "%d/%m/%Y",
            decimalSeparator: ",",
            thousandsSeparator: ".",
            defaultCurrency: "EUR",
          },
        },
        accountId: "acct-1",
        mappingConfidence: "MEDIUM",
      },
    });
  });

  test("uses saved import_csv profile when no LLM mappings are provided", async () => {
    const calls: string[][] = [];
    const savedMapping = {
      accountId: "acct-1",
      contextKind: "CSV_ACTIVITY",
      name: "Saved profile",
      fieldMappings: { date: "Trade Date", activityType: "Action", amount: "Net Amount" },
      activityMappings: { DIVIDEND: ["Distribution"] },
      symbolMappings: { "Apple Inc": "AAPL" },
      accountMappings: { Main: "acct-1", Unknown: "missing" },
      symbolMappingMeta: {},
      parseConfig: { delimiter: ";", defaultCurrency: "EUR" },
    };
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [account({ id: "acct-1", name: "Brokerage" })],
      },
      activityService: {
        getImportMapping: (accountId, contextKind) => {
          calls.push([accountId, contextKind]);
          return savedMapping;
        },
        parseCsv: (request) => {
          expect(request.config).toEqual({ delimiter: ";", defaultCurrency: "EUR" });
          return {
            headers: ["Trade Date", "Action", "Net Amount"],
            rows: [["2026-01-17", "Distribution", "12.34"]],
            rowCount: 1,
          };
        },
      },
    });

    const result = await tools
      .find((tool) => tool.name === "import_csv")
      ?.execute({
        csvContent: "Trade Date;Action;Net Amount\n2026-01-17;Distribution;12.34",
        accountId: "acct-1",
      });

    expect(calls).toEqual([["acct-1", "ACTIVITY"]]);
    expect(result).toMatchObject({
      data: {
        appliedMapping: {
          name: "Saved profile",
          accountMappings: { Main: "acct-1" },
        },
        parseConfig: { delimiter: ";", defaultCurrency: "EUR" },
        accountId: "acct-1",
        mappingConfidence: "HIGH",
        usedSavedProfile: true,
      },
    });
  });

  test("falls back to inferred import_csv mapping when no saved profile is returned", async () => {
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [account({ id: "acct-1", name: "Brokerage" })],
      },
      activityService: {
        getImportMapping: async () => undefined as never,
        parseCsv: (request) => {
          expect(request.config).toEqual({
            delimiter: undefined,
            skipTopRows: undefined,
            skipBottomRows: undefined,
            dateFormat: null,
            decimalSeparator: null,
            thousandsSeparator: null,
            defaultCurrency: "USD",
          });
          return {
            headers: ["Date", "Type", "Symbol", "Amount"],
            rows: [["2026-01-17", "Buy", "AAPL", "12.34"]],
            rowCount: 1,
          };
        },
      },
      baseCurrency: "USD",
    });

    const result = await tools
      .find((tool) => tool.name === "import_csv")
      ?.execute({
        csvContent: "Date,Type,Symbol,Amount\n2026-01-17,Buy,AAPL,12.34",
        accountId: "acct-1",
      });

    expect(result).toMatchObject({
      data: {
        appliedMapping: {
          fieldMappings: {
            date: "Date",
            activityType: "Type",
            symbol: "Symbol",
            amount: "Amount",
          },
        },
        usedSavedProfile: false,
        mappingConfidence: "HIGH",
      },
    });
  });

  test("rejects empty import_csv content with reattach guidance", async () => {
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [],
      },
      activityService: {
        parseCsv: () => {
          throw new Error("empty CSV should fail before parsing");
        },
      },
    });

    await expect(
      tools.find((tool) => tool.name === "import_csv")?.execute({ csvContent: "  " }),
    ).rejects.toThrow("No CSV content provided. The user needs to attach the CSV file again");
  });

  test("exposes Rust-compatible get_holdings output", async () => {
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [],
        getAllAccounts: () => [account({ id: "acct-1", name: "Brokerage" })],
      },
      holdingsService: {
        getHoldings: (accountId) => {
          expect(accountId).toBe("acct-1");
          return [
            holding({
              accountId: "acct-1",
              instrument: {
                id: "asset-1",
                symbol: "AAPL",
                name: "Apple Inc.",
                currency: "USD",
                notes: null,
                pricingMode: "AUTOMATIC",
                preferredProvider: null,
                exchangeMic: "XNAS",
                classifications: null,
              },
              quantity: 3,
              marketValue: { local: 600, base: 600 },
              costBasis: { local: 450, base: 450 },
              unrealizedGainPct: 0.3333,
              dayChangePct: 0.01,
              weight: 0.5,
            }),
            holding({
              accountId: "acct-1",
              holdingType: "cash",
              instrument: null,
              quantity: 100,
              marketValue: { local: 100, base: 100 },
              localCurrency: "USD",
            }),
          ];
        },
      },
      baseCurrency: () => "USD",
    });

    const getHoldings = tools.find((tool) => tool.name === "get_holdings");
    const result = await getHoldings?.execute({ accountId: "acct-1", viewMode: "table" });

    expect(result).toEqual({
      data: {
        holdings: [
          {
            account: "Brokerage",
            symbol: "AAPL",
            name: "Apple Inc.",
            holdingType: "Security",
            quantity: 3,
            marketValueBase: 600,
            costBasisBase: 450,
            unrealizedGainPct: 0.3333,
            dayChangePct: 0.01,
            weight: 0.5,
            currency: "USD",
          },
        ],
        totalValue: 600,
        currency: "USD",
        accountScope: "acct-1",
        viewMode: "table",
        truncated: true,
        originalCount: 2,
      },
    });
  });

  test("truncates get_holdings output at Rust-compatible holding limit", async () => {
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [],
        getAllAccounts: () => [],
      },
      holdingsService: {
        getHoldings: () =>
          Array.from({ length: 105 }, (_, index) =>
            holding({
              id: `holding-${index}`,
              instrument: {
                id: `asset-${index}`,
                symbol: `SYM${index}`,
                name: null,
                currency: "USD",
                notes: null,
                pricingMode: "AUTOMATIC",
                preferredProvider: null,
                exchangeMic: null,
                classifications: null,
              },
            }),
          ),
      },
      baseCurrency: "CAD",
    });

    const result = await tools.find((tool) => tool.name === "get_holdings")?.execute({});
    const data = result?.data as { holdings: Array<{ symbol: string }> };

    expect(result).toMatchObject({
      data: {
        currency: "CAD",
        accountScope: "TOTAL",
        viewMode: "treemap",
        truncated: true,
        originalCount: 105,
      },
    });
    expect(data.holdings).toHaveLength(100);
    expect(data.holdings[0]?.symbol).toBe("SYM0");
    expect(data.holdings[99]?.symbol).toBe("SYM99");
  });

  test("exposes Rust-compatible get_cash_balances output with valuation precedence", async () => {
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [account({ id: "acct-1", name: "CAD Account", currency: "CAD" })],
      },
      holdingsService: {
        getLatestValuations: (accountIds) => {
          expect(accountIds).toEqual(["acct-1"]);
          return [valuation({ accountId: "acct-1", cashBalance: 2400, fxRateToBase: 1 })];
        },
        getHoldings: (accountId) => {
          expect(accountId).toBe("acct-1");
          return [
            cashHolding({ accountId: "acct-1", currency: "CAD", quantity: 1000, baseValue: 1000 }),
            cashHolding({ accountId: "acct-1", currency: "USD", quantity: 1000, baseValue: 1350 }),
            holding({ accountId: "acct-1", marketValue: { local: 500, base: 500 } }),
          ];
        },
      },
      baseCurrency: "CAD",
    });

    const getCashBalances = tools.find((tool) => tool.name === "get_cash_balances");
    const result = await getCashBalances?.execute({ accountId: "acct-1" });

    expect(getCashBalances).toMatchObject({
      parameters: {
        type: "object",
        properties: expect.objectContaining({
          accountId: expect.objectContaining({ type: "string" }),
        }),
        required: [],
      },
    });
    expect(result).toEqual({
      data: {
        accounts: [
          {
            accountId: "acct-1",
            accountName: "CAD Account",
            accountCurrency: "CAD",
            balances: [
              { currency: "CAD", amount: 1000 },
              { currency: "USD", amount: 1000 },
            ],
            totalAccountCurrency: 2400,
            totalBaseCurrency: 2350,
          },
        ],
        grandTotalBase: 2350,
        baseCurrency: "CAD",
      },
    });
  });

  test("uses latest valuation when cash market value base is zero", async () => {
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [account({ id: "acct-1", currency: "CAD" })],
      },
      holdingsService: {
        getLatestValuations: () => [
          valuation({ accountId: "acct-1", cashBalance: 1000, fxRateToBase: 1.35 }),
        ],
        getHoldings: () => [
          cashHolding({ accountId: "acct-1", currency: "USD", quantity: 1000, baseValue: 0 }),
        ],
      },
      baseCurrency: "CAD",
    });

    const result = await tools.find((tool) => tool.name === "get_cash_balances")?.execute({});

    expect(result).toMatchObject({
      data: {
        accounts: [
          expect.objectContaining({
            totalAccountCurrency: 1000,
            totalBaseCurrency: 1350,
          }),
        ],
        grandTotalBase: 1350,
      },
    });
  });

  test("defaults get_cash_balances to TOTAL and skips accounts without cash", async () => {
    const fetchedAccountIds: string[] = [];
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [
          account({ id: "acct-1", name: "Cash Account", currency: "USD" }),
          account({ id: "acct-2", name: "Invested Account", currency: "USD" }),
        ],
      },
      holdingsService: {
        getLatestValuations: (accountIds) => {
          expect(accountIds).toEqual(["acct-1", "acct-2"]);
          return [];
        },
        getHoldings: (accountId) => {
          fetchedAccountIds.push(accountId);
          return accountId === "acct-1"
            ? [cashHolding({ accountId, currency: "USD", quantity: 25, baseValue: 25 })]
            : [holding({ accountId, marketValue: { local: 100, base: 100 } })];
        },
      },
      baseCurrency: "USD",
    });

    const result = await tools.find((tool) => tool.name === "get_cash_balances")?.execute({});

    expect(fetchedAccountIds).toEqual(["acct-1", "acct-2"]);
    expect(result).toEqual({
      data: {
        accounts: [
          {
            accountId: "acct-1",
            accountName: "Cash Account",
            accountCurrency: "USD",
            balances: [{ currency: "USD", amount: 25 }],
            totalAccountCurrency: 25,
            totalBaseCurrency: 25,
          },
        ],
        grandTotalBase: 25,
        baseCurrency: "USD",
      },
    });
  });

  test("keeps get_cash_balances empty without querying valuations when no accounts are active", async () => {
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [],
      },
      holdingsService: {
        getLatestValuations: () => {
          throw new Error("should not query valuations for an empty TOTAL target set");
        },
        getHoldings: () => {
          throw new Error("should not query holdings for an empty TOTAL target set");
        },
      },
      baseCurrency: "USD",
    });

    const result = await tools
      .find((tool) => tool.name === "get_cash_balances")
      ?.execute({
        accountId: "",
      });

    expect(result).toEqual({
      data: {
        accounts: [],
        grandTotalBase: 0,
        baseCurrency: "USD",
      },
    });
  });

  test("fails get_cash_balances when mixed cash currencies cannot be converted", async () => {
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [account({ id: "acct-1", currency: "CAD" })],
      },
      holdingsService: {
        getLatestValuations: () => [],
        getHoldings: () => [
          cashHolding({ accountId: "acct-1", currency: "USD", quantity: 100, baseValue: 0 }),
          cashHolding({ accountId: "acct-1", currency: "EUR", quantity: 50, baseValue: 0 }),
        ],
      },
      baseCurrency: "CAD",
    });

    await expect(
      tools.find((tool) => tool.name === "get_cash_balances")?.execute({ accountId: "acct-1" }),
    ).rejects.toThrow(
      "Cash balance for account 'acct-1' includes currencies that cannot be converted to base currency.",
    );
  });

  test("exposes Rust-compatible get_goals output", async () => {
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [],
      },
      goalService: {
        getGoals: () => [
          goal({
            id: "goal-1",
            title: "Retire",
            description: "Long-term retirement",
            targetAmount: 1000000,
            summaryTargetAmount: 1200000,
            summaryCurrentValue: 300000,
            summaryProgress: 0.25,
            targetDate: "2045-01-01",
          }),
          goal({
            id: "goal-2",
            title: "Emergency Fund",
            targetAmount: 50000,
            summaryCurrentValue: 50000,
            summaryProgress: 1,
            statusLifecycle: "achieved",
          }),
        ],
      },
    });

    const getGoals = tools.find((tool) => tool.name === "get_goals");
    const result = await getGoals?.execute({});

    expect(getGoals).toMatchObject({
      description: expect.stringContaining("investment goals"),
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    });
    expect(result).toEqual({
      data: {
        goals: [
          {
            id: "goal-1",
            title: "Retire",
            description: "Long-term retirement",
            targetAmount: 1200000,
            currentAmount: 300000,
            progressPercent: 25,
            deadline: "2045-01-01",
            isAchieved: false,
          },
          {
            id: "goal-2",
            title: "Emergency Fund",
            description: null,
            targetAmount: 50000,
            currentAmount: 50000,
            progressPercent: 100,
            deadline: null,
            isAchieved: true,
          },
        ],
        count: 2,
        totalTarget: 1250000,
        totalCurrent: 350000,
        achievedCount: 1,
      },
    });
  });

  test("truncates get_goals output at Rust-compatible goal limit", async () => {
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [],
      },
      goalService: {
        getGoals: () =>
          Array.from({ length: 55 }, (_, index) =>
            goal({ id: `goal-${index}`, title: `Goal ${index}`, targetAmount: 100 }),
          ),
      },
    });

    const result = await tools.find((tool) => tool.name === "get_goals")?.execute({});

    expect(result).toMatchObject({
      data: {
        count: 50,
        totalTarget: 5000,
        truncated: true,
        originalCount: 55,
      },
    });
  });

  test("returns Rust-compatible get_health_status not-computed payload", async () => {
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [],
      },
      healthService: {
        getCachedHealthStatus: () => null,
      },
    });

    const getHealthStatus = tools.find((tool) => tool.name === "get_health_status");
    const result = await getHealthStatus?.execute({});

    expect(getHealthStatus).toMatchObject({
      description: expect.stringContaining("cached portfolio health status"),
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    });
    expect(result).toEqual({
      data: {
        overallSeverity: "NOT_COMPUTED",
        issues: [],
        isStale: false,
        note: "No health check has run yet in this session. Ask the user to open the Health Center to run a check.",
      },
    });
  });

  test("maps Rust-compatible get_health_status cached issues", async () => {
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [],
      },
      healthService: {
        getCachedHealthStatus: () =>
          healthStatus({
            overallSeverity: "WARNING",
            isStale: true,
            issues: [
              {
                id: "price_stale:AAPL",
                severity: "WARNING",
                category: "PRICE_STALENESS",
                title: "Outdated prices",
                message: "AAPL has stale price data.",
                affectedCount: 1,
                affectedMvPct: 0.05,
                details: "Last updated 10 days ago.",
                dataHash: "abc123",
                timestamp: "2026-05-17T00:00:00.000Z",
              },
              {
                id: "timezone_missing",
                severity: "INFO",
                category: "SETTINGS_CONFIGURATION",
                title: "Timezone not configured",
                message: "Set a timezone.",
                affectedCount: 0,
                dataHash: "def456",
                timestamp: "2026-05-17T00:00:00.000Z",
              },
            ],
          }),
      },
    });

    const result = await tools.find((tool) => tool.name === "get_health_status")?.execute({});

    expect(result).toEqual({
      data: {
        overallSeverity: "WARNING",
        issues: [
          {
            id: "price_stale:AAPL",
            severity: "WARNING",
            category: "PRICE_STALENESS",
            title: "Outdated prices",
            message: "AAPL has stale price data.",
            affectedCount: 1,
            affectedMvPct: 0.05,
            details: "Last updated 10 days ago.",
          },
          {
            id: "timezone_missing",
            severity: "INFO",
            category: "SETTINGS_CONFIGURATION",
            title: "Timezone not configured",
            message: "Set a timezone.",
            affectedCount: 0,
          },
        ],
        isStale: true,
      },
    });
  });

  test("exposes Rust-compatible search_activities output and filters", async () => {
    let capturedRequest: ActivitySearchRequest | undefined;
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [account({ id: "acct-1", name: "Brokerage" })],
      },
      activityService: {
        searchActivities: (request) => {
          capturedRequest = request;
          return {
            data: [
              activity({
                id: "activity-1",
                accountId: "acct-1",
                accountName: "Brokerage",
                activityType: "BUY",
                assetSymbol: "AAPL",
                quantity: "2",
                unitPrice: "10",
                amount: "",
                fee: "1.5",
                fxRate: "1.35",
              }),
            ],
            meta: { totalRowCount: 250 },
          };
        },
      },
    });

    const searchActivities = tools.find((tool) => tool.name === "search_activities");
    const result = await searchActivities?.execute({
      accountId: "Brokerage",
      activityType: "BUY",
      symbol: "AAPL",
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      page: 2,
      pageSize: 500,
    });

    expect(searchActivities).toMatchObject({
      description: expect.stringContaining("investment activities"),
      parameters: {
        type: "object",
        properties: expect.objectContaining({
          activityType: expect.objectContaining({
            enum: expect.arrayContaining(["BUY", "SELL", "DIVIDEND"]),
          }),
          pageSize: expect.objectContaining({ default: 50 }),
        }),
        required: [],
      },
    });
    expect(capturedRequest).toEqual({
      page: 1,
      pageSize: 200,
      accountIds: ["acct-1"],
      activityTypes: ["BUY"],
      assetIdKeyword: "AAPL",
      sort: { id: "date", desc: true },
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
    });
    expect(result).toEqual({
      data: {
        activities: [
          {
            id: "activity-1",
            date: "2026-01-15T00:00:00",
            activityType: "BUY",
            symbol: "AAPL",
            quantity: 2,
            unitPrice: 10,
            amount: 20,
            fee: 1.5,
            fxRate: 1.35,
            currency: "USD",
            accountId: "acct-1",
            accountName: "Brokerage",
          },
        ],
        count: 1,
        totalRowCount: 250,
        page: 2,
        pageSize: 200,
        totalPages: 2,
        accountScope: "Brokerage",
        totalAmount: 20,
      },
    });
  });

  test("defaults search_activities pagination and omits zero total amount", async () => {
    let capturedRequest: ActivitySearchRequest | undefined;
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [],
      },
      activityService: {
        searchActivities: (request) => {
          capturedRequest = request;
          return {
            data: [
              activity({
                id: "activity-1",
                assetSymbol: "",
                quantity: null,
                unitPrice: null,
                amount: null,
              }),
            ],
            meta: { totalRowCount: 1 },
          };
        },
      },
    });

    const result = await tools
      .find((tool) => tool.name === "search_activities")
      ?.execute({
        accountId: "TOTAL",
        page: 0,
        pageSize: 0,
      });

    expect(capturedRequest).toEqual({
      page: 0,
      pageSize: 1,
      accountIds: undefined,
      activityTypes: undefined,
      assetIdKeyword: undefined,
      sort: { id: "date", desc: true },
      dateFrom: undefined,
      dateTo: undefined,
    });
    expect(result).toEqual({
      data: {
        activities: [
          {
            id: "activity-1",
            date: "2026-01-15T00:00:00",
            activityType: "BUY",
            symbol: null,
            quantity: null,
            unitPrice: null,
            amount: null,
            fee: null,
            fxRate: null,
            currency: "USD",
            accountId: "acct-1",
            accountName: "Brokerage",
          },
        ],
        count: 1,
        totalRowCount: 1,
        page: 1,
        pageSize: 1,
        totalPages: 1,
        accountScope: "all",
      },
    });
  });

  test("rejects invalid search_activities dates", async () => {
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [],
      },
      activityService: {
        searchActivities: () => {
          throw new Error("should not search with invalid dates");
        },
      },
    });

    await expect(
      tools.find((tool) => tool.name === "search_activities")?.execute({ dateFrom: "2026-13-01" }),
    ).rejects.toThrow("Invalid dateFrom format: 2026-13-01");
  });

  test("exposes Rust-compatible get_income output", async () => {
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [],
      },
      portfolioMetricsService: {
        getIncomeSummary: (accountId) => {
          expect(accountId).toBeUndefined();
          return [
            incomeSummary({
              period: "YTD",
              totalIncome: 150,
              monthlyAverage: 50,
              yoyGrowth: 12.5,
              byType: { DIVIDEND: 120, INTEREST: 30 },
              byMonth: { "2026-01": 100, "2026-02": 50 },
              byAsset: {
                apple: {
                  assetId: "asset-1",
                  kind: "SECURITY",
                  symbol: "AAPL",
                  name: "Apple",
                  income: 90,
                },
                cash: { assetId: "asset-2", kind: "CASH", symbol: "USD", name: "Cash", income: 0 },
                bond: {
                  assetId: "asset-3",
                  kind: "SECURITY",
                  symbol: "BND",
                  name: "Bond",
                  income: 60,
                },
              },
            }),
          ];
        },
      },
    });

    const getIncome = tools.find((tool) => tool.name === "get_income");
    const result = await getIncome?.execute({ period: "ytd" });

    expect(getIncome).toMatchObject({
      description: expect.stringContaining("income summary"),
      parameters: {
        type: "object",
        properties: {
          period: expect.objectContaining({ enum: ["YTD", "LAST_YEAR", "TOTAL"] }),
        },
        required: [],
      },
    });
    expect(result).toEqual({
      data: {
        totalIncome: 150,
        currency: "USD",
        monthlyAverage: 50,
        yoyGrowth: 12.5,
        byType: { DIVIDEND: 120, INTEREST: 30 },
        topAssets: [
          { symbol: "AAPL", name: "Apple", income: 90 },
          { symbol: "BND", name: "Bond", income: 60 },
        ],
        byMonth: { "2026-01": 100, "2026-02": 50 },
        period: "YTD",
      },
    });
  });

  test("defaults get_income to YTD and omits null yoy growth", async () => {
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [],
      },
      portfolioMetricsService: {
        getIncomeSummary: () => [incomeSummary({ period: "YTD", yoyGrowth: null })],
      },
    });

    const result = await tools.find((tool) => tool.name === "get_income")?.execute({});

    expect(result).toEqual({
      data: {
        totalIncome: 0,
        currency: "USD",
        monthlyAverage: 0,
        byType: {},
        topAssets: [],
        byMonth: {},
        period: "YTD",
      },
    });
  });

  test("fails get_income for missing periods", async () => {
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [],
      },
      portfolioMetricsService: {
        getIncomeSummary: () => [incomeSummary({ period: "YTD" })],
      },
    });

    await expect(
      tools.find((tool) => tool.name === "get_income")?.execute({ period: "LAST_YEAR" }),
    ).rejects.toThrow("Period 'LAST_YEAR' not found in income data");
  });

  test("exposes Rust-compatible get_performance output and default YTD range", async () => {
    let capturedRequest: PerformanceRequest | undefined;
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [],
      },
      portfolioMetricsService: {
        calculatePerformanceHistory: (request) => {
          capturedRequest = request;
          return performanceMetrics({
            id: request.itemId,
            periodStartDate: request.startDate ?? null,
            periodEndDate: request.endDate ?? null,
            currency: "",
            cumulativeTwr: 0.12,
            gainLossAmount: 250,
            annualizedTwr: 0.18,
            simpleReturn: 0.11,
            annualizedSimpleReturn: 0.17,
            cumulativeMwr: 0.1,
            annualizedMwr: 0.16,
            volatility: 0.08,
            maxDrawdown: -0.04,
          });
        },
      },
      baseCurrency: "CAD",
      now: () => new Date("2026-06-15T12:00:00.000Z"),
    });

    const getPerformance = tools.find((tool) => tool.name === "get_performance");
    const result = await getPerformance?.execute({});

    expect(getPerformance).toMatchObject({
      description: expect.stringContaining("portfolio performance metrics"),
      parameters: {
        type: "object",
        properties: expect.objectContaining({
          accountId: expect.objectContaining({ default: "TOTAL" }),
          period: expect.objectContaining({
            enum: ["1M", "3M", "6M", "YTD", "1Y", "ALL"],
            default: "YTD",
          }),
        }),
        required: [],
      },
    });
    expect(capturedRequest).toEqual({
      itemType: "account",
      itemId: "TOTAL",
      startDate: "2026-01-01",
      endDate: "2026-06-15",
    });
    expect(result).toEqual({
      data: {
        id: "TOTAL",
        periodStartDate: "2026-01-01",
        periodEndDate: "2026-06-15",
        currency: "CAD",
        cumulativeTwr: 0.12,
        gainLossAmount: 250,
        annualizedTwr: 0.18,
        simpleReturn: 0.11,
        annualizedSimpleReturn: 0.17,
        cumulativeMwr: 0.1,
        annualizedMwr: 0.16,
        volatility: 0.08,
        maxDrawdown: -0.04,
      },
    });
  });

  test("maps get_performance periods and omits null optional metrics", async () => {
    const capturedRequests: PerformanceRequest[] = [];
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [],
      },
      portfolioMetricsService: {
        calculatePerformanceHistory: (request) => {
          capturedRequests.push(request);
          return performanceMetrics({
            id: request.itemId,
            periodStartDate: null,
            periodEndDate: null,
            currency: "USD",
            cumulativeTwr: null,
            gainLossAmount: null,
            annualizedTwr: null,
            simpleReturn: 0,
            annualizedSimpleReturn: 0,
            cumulativeMwr: null,
            annualizedMwr: null,
            volatility: 0,
            maxDrawdown: 0,
          });
        },
      },
      now: () => new Date("2026-06-15T12:00:00.000Z"),
    });
    const getPerformance = tools.find((tool) => tool.name === "get_performance");

    const oneMonthResult = await getPerformance?.execute({
      accountId: "acct-1",
      period: "1m",
    });
    const allResult = await getPerformance?.execute({
      accountId: "acct-1",
      period: "ALL",
    });

    expect(capturedRequests).toEqual([
      {
        itemType: "account",
        itemId: "acct-1",
        startDate: "2026-05-16",
        endDate: "2026-06-15",
      },
      {
        itemType: "account",
        itemId: "acct-1",
        startDate: undefined,
        endDate: "2026-06-15",
      },
    ]);
    expect(oneMonthResult).toEqual({
      data: {
        id: "acct-1",
        currency: "USD",
        simpleReturn: 0,
        annualizedSimpleReturn: 0,
        volatility: 0,
        maxDrawdown: 0,
      },
    });
    expect(allResult).toEqual(oneMonthResult);
  });

  test("exposes Rust-compatible aggregate get_valuation_history output", async () => {
    const calls: Array<{ accountId: string; startDate?: string; endDate?: string }> = [];
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [
          account({ id: "acct-1", name: "Brokerage" }),
          account({ id: "acct-2", name: "Retirement" }),
        ],
      },
      holdingsService: {
        getHoldings: () => [],
        getHistoricalValuations: (accountId, startDate, endDate) => {
          calls.push({ accountId, startDate, endDate });
          return accountId === "acct-1"
            ? [
                valuation({
                  accountId,
                  valuationDate: "2026-01-02",
                  totalValue: 100,
                  netContribution: 40,
                  fxRateToBase: 1.5,
                }),
              ]
            : [
                valuation({
                  accountId,
                  valuationDate: "2026-01-02",
                  totalValue: 200,
                  netContribution: 80,
                  fxRateToBase: 2,
                }),
                valuation({
                  accountId,
                  valuationDate: "2026-01-01",
                  totalValue: 50,
                  netContribution: 20,
                  fxRateToBase: 2,
                }),
              ];
        },
      },
      baseCurrency: "CAD",
    });

    const getValuationHistory = tools.find((tool) => tool.name === "get_valuation_history");
    const result = await getValuationHistory?.execute({
      accountId: "TOTAL",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });

    expect(getValuationHistory).toMatchObject({
      description: expect.stringContaining("historical portfolio valuations"),
      parameters: {
        type: "object",
        properties: expect.objectContaining({
          accountId: expect.objectContaining({ default: "TOTAL" }),
        }),
        required: [],
      },
    });
    expect(calls).toEqual([
      { accountId: "acct-1", startDate: "2026-01-01", endDate: "2026-01-31" },
      { accountId: "acct-2", startDate: "2026-01-01", endDate: "2026-01-31" },
    ]);
    expect(result).toEqual({
      data: {
        valuations: [
          { date: "2026-01-01", totalValue: 100, netContribution: 40, currency: "CAD" },
          { date: "2026-01-02", totalValue: 550, netContribution: 220, currency: "CAD" },
        ],
        accountScope: "TOTAL",
        currency: "CAD",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      },
    });
  });

  test("defaults get_valuation_history dates and truncates at Rust-compatible limit", async () => {
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [],
      },
      holdingsService: {
        getHoldings: () => [],
        getHistoricalValuations: (accountId, startDate, endDate) => {
          expect(accountId).toBe("acct-1");
          expect(startDate).toBe("2025-01-15");
          expect(endDate).toBe("2026-01-15");
          return Array.from({ length: 405 }, (_, index) =>
            valuation({
              accountId,
              valuationDate: `2025-01-${String((index % 28) + 1).padStart(2, "0")}`,
              totalValue: index,
              netContribution: index / 2,
              fxRateToBase: 2,
            }),
          );
        },
      },
      baseCurrency: "USD",
      now: () => new Date("2026-01-15T12:00:00.000Z"),
    });

    const result = await tools
      .find((tool) => tool.name === "get_valuation_history")
      ?.execute({
        accountId: "acct-1",
        startDate: "not-a-date",
        endDate: "also-invalid",
      });
    const data = result?.data as { valuations: unknown[] };

    expect(result).toMatchObject({
      data: {
        accountScope: "acct-1",
        currency: "USD",
        startDate: "2025-01-15",
        endDate: "2026-01-15",
        truncated: true,
        originalCount: 405,
      },
    });
    expect(data.valuations).toHaveLength(400);
  });

  test("exposes Rust-compatible get_asset_allocation output with default grouping", async () => {
    let capturedAccountId: string | undefined;
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [],
      },
      holdingsService: {
        getHoldings: () => [],
        getPortfolioAllocations: (accountId) => {
          capturedAccountId = accountId;
          return portfolioAllocations({
            assetClasses: taxonomyAllocation({
              taxonomyId: "asset_class",
              taxonomyName: "Asset Class",
              categories: [
                {
                  categoryId: "EQUITY",
                  categoryName: "Equity",
                  color: "#2563eb",
                  value: 750,
                  percentage: 75,
                },
                {
                  categoryId: "CASH",
                  categoryName: "Cash",
                  color: "#16a34a",
                  value: 250,
                  percentage: 25,
                },
              ],
            }),
          });
        },
        getHoldingsByAllocation: () => {
          throw new Error("should not drill down without taxonomy and category ids");
        },
      },
      baseCurrency: "CAD",
    });

    const getAssetAllocation = tools.find((tool) => tool.name === "get_asset_allocation");
    const result = await getAssetAllocation?.execute({});

    expect(getAssetAllocation).toMatchObject({
      description: expect.stringContaining("asset allocation"),
      parameters: {
        type: "object",
        properties: expect.objectContaining({
          accountId: expect.objectContaining({ default: "TOTAL" }),
          groupBy: expect.objectContaining({
            enum: ["class", "sector", "region", "risk", "security_type"],
            default: "class",
          }),
          taxonomyId: expect.objectContaining({ type: "string" }),
          categoryId: expect.objectContaining({ type: "string" }),
        }),
        required: [],
      },
    });
    expect(capturedAccountId).toBe("TOTAL");
    expect(result).toEqual({
      data: {
        allocations: [
          {
            categoryId: "EQUITY",
            categoryName: "Equity",
            value: 750,
            percentage: 75,
            color: "#2563eb",
          },
          {
            categoryId: "CASH",
            categoryName: "Cash",
            value: 250,
            percentage: 25,
            color: "#16a34a",
          },
        ],
        totalValue: 1000,
        currency: "CAD",
        groupBy: "class",
        taxonomyId: "asset_class",
        taxonomyName: "Asset Class",
      },
    });
  });

  test("selects requested get_asset_allocation taxonomy", async () => {
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [],
      },
      holdingsService: {
        getHoldings: () => [],
        getPortfolioAllocations: (accountId) => {
          expect(accountId).toBe("acct-1");
          return portfolioAllocations({
            sectors: taxonomyAllocation({
              taxonomyId: "sector",
              taxonomyName: "Sector",
              categories: [
                {
                  categoryId: "TECHNOLOGY",
                  categoryName: "Technology",
                  color: "#7c3aed",
                  value: 600,
                  percentage: 60,
                },
              ],
            }),
          });
        },
        getHoldingsByAllocation: () => {
          throw new Error("should not drill down without taxonomy and category ids");
        },
      },
      baseCurrency: () => "USD",
    });

    const result = await tools
      .find((tool) => tool.name === "get_asset_allocation")
      ?.execute({
        accountId: "acct-1",
        groupBy: "sector",
      });

    expect(result).toEqual({
      data: {
        allocations: [
          {
            categoryId: "TECHNOLOGY",
            categoryName: "Technology",
            value: 600,
            percentage: 60,
            color: "#7c3aed",
          },
        ],
        totalValue: 1000,
        currency: "USD",
        groupBy: "sector",
        taxonomyId: "sector",
        taxonomyName: "Sector",
      },
    });
  });

  test("maps remaining get_asset_allocation grouping variants", async () => {
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [],
      },
      holdingsService: {
        getHoldings: () => [],
        getPortfolioAllocations: () =>
          portfolioAllocations({
            regions: taxonomyAllocation({
              taxonomyId: "region",
              taxonomyName: "Region",
              categories: [
                {
                  categoryId: "NORTH_AMERICA",
                  categoryName: "North America",
                  color: "#2563eb",
                  value: 400,
                  percentage: 40,
                },
              ],
            }),
            riskCategory: taxonomyAllocation({
              taxonomyId: "risk",
              taxonomyName: "Risk",
              categories: [
                {
                  categoryId: "HIGH",
                  categoryName: "High",
                  color: "#dc2626",
                  value: 700,
                  percentage: 70,
                },
              ],
            }),
            securityTypes: taxonomyAllocation({
              taxonomyId: "security_type",
              taxonomyName: "Security Type",
              categories: [
                {
                  categoryId: "ETF",
                  categoryName: "ETF",
                  color: "#0891b2",
                  value: 300,
                  percentage: 30,
                },
              ],
            }),
          }),
        getHoldingsByAllocation: () => {
          throw new Error("should not drill down without taxonomy and category ids");
        },
      },
    });
    const getAssetAllocation = tools.find((tool) => tool.name === "get_asset_allocation");

    await expect(getAssetAllocation?.execute({ groupBy: "region" })).resolves.toMatchObject({
      data: {
        allocations: [expect.objectContaining({ categoryId: "NORTH_AMERICA" })],
        groupBy: "region",
        taxonomyId: "region",
        taxonomyName: "Region",
      },
    });
    await expect(getAssetAllocation?.execute({ groupBy: "risk" })).resolves.toMatchObject({
      data: {
        allocations: [expect.objectContaining({ categoryId: "HIGH" })],
        groupBy: "risk",
        taxonomyId: "risk",
        taxonomyName: "Risk",
      },
    });
    await expect(getAssetAllocation?.execute({ groupBy: "security_type" })).resolves.toMatchObject({
      data: {
        allocations: [expect.objectContaining({ categoryId: "ETF" })],
        groupBy: "security_type",
        taxonomyId: "security_type",
        taxonomyName: "Security Type",
      },
    });
  });

  test("fails get_asset_allocation for invalid grouping", async () => {
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [],
      },
      holdingsService: {
        getHoldings: () => [],
        getPortfolioAllocations: () => portfolioAllocations({}),
        getHoldingsByAllocation: () => {
          throw new Error("should not drill down without taxonomy and category ids");
        },
      },
    });

    await expect(
      tools.find((tool) => tool.name === "get_asset_allocation")?.execute({ groupBy: "issuer" }),
    ).rejects.toThrow(
      "Invalid groupBy value 'issuer'. Must be 'class', 'sector', 'region', 'risk', or 'security_type'.",
    );
  });

  test("returns get_asset_allocation drill-down holdings", async () => {
    const calls: Array<{ accountId: string; taxonomyId: string; categoryId: string }> = [];
    const tools = createPortfolioAiChatTools({
      accountService: {
        getActiveAccounts: () => [],
      },
      holdingsService: {
        getHoldings: () => [],
        getPortfolioAllocations: () => {
          throw new Error("should not query allocation summary in drill-down mode");
        },
        getHoldingsByAllocation: (accountId, taxonomyId, categoryId) => {
          calls.push({ accountId, taxonomyId, categoryId });
          return allocationHoldings({
            taxonomyId,
            categoryId,
            holdings: [
              {
                symbol: "AAPL",
                name: "Apple Inc.",
                holdingType: "security",
                quantity: 2,
                marketValue: 400,
                currency: "USD",
                weightInCategory: 0.8,
              },
              {
                symbol: "MSFT",
                name: null,
                holdingType: "security",
                quantity: 1,
                marketValue: 100,
                currency: "USD",
                weightInCategory: 0.2,
              },
            ],
          });
        },
      },
    });

    const result = await tools
      .find((tool) => tool.name === "get_asset_allocation")
      ?.execute({
        accountId: "acct-1",
        groupBy: "sector",
        taxonomyId: "sector",
        categoryId: "TECHNOLOGY",
      });

    expect(calls).toEqual([
      { accountId: "acct-1", taxonomyId: "sector", categoryId: "TECHNOLOGY" },
    ]);
    expect(result).toEqual({
      data: {
        holdings: [
          { symbol: "AAPL", name: "Apple Inc.", value: 400, weight: 0.8 },
          { symbol: "MSFT", name: null, value: 100, weight: 0.2 },
        ],
        totalValue: 500,
        currency: "USD",
        groupBy: "sector",
        taxonomyId: "sector",
        taxonomyName: "Sector",
        categoryName: "Technology",
      },
    });
  });
});

function account(overrides: Partial<Account>): Account {
  return {
    id: "acct",
    name: "Account",
    accountType: "SECURITIES",
    group: null,
    currency: "USD",
    isDefault: false,
    isActive: true,
    isArchived: false,
    trackingMode: "TRANSACTIONS",
    createdAt: "2026-05-17T00:00:00Z",
    updatedAt: "2026-05-17T00:00:00Z",
    platformId: null,
    accountNumber: null,
    meta: null,
    provider: null,
    providerAccountId: null,
    ...overrides,
  };
}

function holding(overrides: Partial<Holding>): Holding {
  return {
    id: "holding-1",
    accountId: "acct-1",
    holdingType: "security",
    instrument: {
      id: "asset-1",
      symbol: "AAPL",
      name: "Apple Inc.",
      currency: "USD",
      notes: null,
      pricingMode: "AUTOMATIC",
      preferredProvider: null,
      exchangeMic: null,
      classifications: null,
    },
    assetKind: null,
    quantity: 1,
    openDate: null,
    lots: null,
    contractMultiplier: 1,
    localCurrency: "USD",
    baseCurrency: "USD",
    fxRate: 1,
    marketValue: { local: 200, base: 200 },
    costBasis: null,
    price: 200,
    purchasePrice: null,
    unrealizedGain: null,
    unrealizedGainPct: null,
    realizedGain: null,
    realizedGainPct: null,
    totalGain: null,
    totalGainPct: null,
    dayChange: null,
    dayChangePct: null,
    prevCloseValue: null,
    weight: 1,
    asOfDate: "2026-05-17",
    metadata: null,
    ...overrides,
  };
}

function cashHolding(options: {
  accountId: string;
  currency: string;
  quantity: number;
  baseValue: number;
}): Holding {
  return holding({
    id: `cash-${options.accountId}-${options.currency}`,
    accountId: options.accountId,
    holdingType: "cash",
    instrument: {
      id: `cash:${options.currency}`,
      symbol: options.currency,
      name: `Cash (${options.currency})`,
      currency: options.currency,
      notes: null,
      pricingMode: "MANUAL",
      preferredProvider: null,
      exchangeMic: null,
      classifications: null,
    },
    quantity: options.quantity,
    localCurrency: options.currency,
    marketValue: { local: options.quantity, base: options.baseValue },
  });
}

function valuation(overrides: Partial<DailyAccountValuation>): DailyAccountValuation {
  return {
    id: "valuation-1",
    accountId: "acct-1",
    valuationDate: "2026-05-17",
    accountCurrency: "CAD",
    baseCurrency: "CAD",
    fxRateToBase: 1,
    cashBalance: 0,
    investmentMarketValue: 0,
    totalValue: 0,
    costBasis: 0,
    netContribution: 0,
    calculatedAt: "2026-05-17T00:00:00Z",
    ...overrides,
  };
}

function taxonomyAllocation(
  overrides: Partial<PortfolioAllocations["assetClasses"]>,
): PortfolioAllocations["assetClasses"] {
  return {
    taxonomyId: "asset_class",
    taxonomyName: "Asset Class",
    color: "#000000",
    categories: [],
    ...overrides,
  };
}

function portfolioAllocations(overrides: Partial<PortfolioAllocations>): PortfolioAllocations {
  return {
    assetClasses: taxonomyAllocation({ taxonomyId: "asset_class", taxonomyName: "Asset Class" }),
    sectors: taxonomyAllocation({ taxonomyId: "sector", taxonomyName: "Sector" }),
    regions: taxonomyAllocation({ taxonomyId: "region", taxonomyName: "Region" }),
    riskCategory: taxonomyAllocation({ taxonomyId: "risk", taxonomyName: "Risk" }),
    securityTypes: taxonomyAllocation({
      taxonomyId: "security_type",
      taxonomyName: "Security Type",
    }),
    customGroups: [],
    totalValue: 1000,
    ...overrides,
  };
}

function allocationHoldings(overrides: Partial<AllocationHoldings>): AllocationHoldings {
  return {
    taxonomyId: "sector",
    taxonomyName: "Sector",
    categoryId: "TECHNOLOGY",
    categoryName: "Technology",
    color: "#7c3aed",
    holdings: [],
    totalValue: 500,
    currency: "USD",
    ...overrides,
  };
}

function healthStatus(overrides: Partial<HealthStatus>): HealthStatus {
  return {
    overallSeverity: "INFO",
    issueCounts: {},
    issues: [],
    checkedAt: "2026-05-17T00:00:00.000Z",
    isStale: false,
    ...overrides,
  };
}

function goal(overrides: Partial<Goal>): Goal {
  return {
    id: "goal-1",
    goalType: "retirement",
    title: "Goal",
    description: null,
    targetAmount: null,
    statusLifecycle: "active",
    statusHealth: "on_track",
    priority: 0,
    coverImageKey: null,
    currency: "USD",
    startDate: null,
    targetDate: null,
    summaryCurrentValue: null,
    summaryProgress: null,
    projectedCompletionDate: null,
    projectedValueAtTargetDate: null,
    createdAt: "2026-05-17T00:00:00Z",
    updatedAt: "2026-05-17T00:00:00Z",
    summaryTargetAmount: null,
    ...overrides,
  };
}

function activity(overrides: Partial<ActivityDetails>): ActivityDetails {
  return {
    id: "activity-1",
    accountId: "acct-1",
    assetId: "asset-1",
    activityType: "BUY",
    subtype: null,
    status: "FILLED",
    date: "2026-01-15T00:00:00",
    quantity: "1",
    unitPrice: "10",
    currency: "USD",
    fee: null,
    amount: "10",
    needsReview: false,
    comment: null,
    fxRate: null,
    createdAt: "2026-01-15T00:00:00Z",
    updatedAt: "2026-01-15T00:00:00Z",
    accountName: "Brokerage",
    accountCurrency: "USD",
    assetSymbol: "AAPL",
    assetName: "Apple Inc.",
    exchangeMic: "XNAS",
    assetPricingMode: "MARKET",
    instrumentType: "EQUITY",
    sourceSystem: null,
    sourceRecordId: null,
    sourceGroupId: null,
    idempotencyKey: null,
    importRunId: null,
    isUserModified: false,
    metadata: null,
    ...overrides,
  };
}

function symbolSearchResult(overrides: Partial<SymbolSearchResult>): SymbolSearchResult {
  return {
    symbol: "AAPL",
    shortName: "Apple",
    longName: "Apple Inc.",
    exchange: "NMS",
    exchangeMic: "XNAS",
    exchangeName: "NASDAQ",
    quoteType: "EQUITY",
    typeDisplay: "Equity",
    currency: "USD",
    currencySource: null,
    dataSource: "YAHOO",
    isExisting: false,
    existingAssetId: null,
    index: "quotes",
    score: 1,
    ...overrides,
  };
}

function incomeSummary(overrides: Partial<IncomeSummary>): IncomeSummary {
  return {
    period: "YTD",
    byMonth: {},
    byType: {},
    byAsset: {},
    byCurrency: {},
    byAccount: {},
    totalIncome: 0,
    currency: "USD",
    monthlyAverage: 0,
    yoyGrowth: null,
    ...overrides,
  };
}

function performanceMetrics(overrides: Partial<PerformanceMetrics>): PerformanceMetrics {
  return {
    id: "TOTAL",
    returns: [],
    periodStartDate: "2026-01-01",
    periodEndDate: "2026-06-15",
    currency: "USD",
    periodGain: 0,
    periodReturn: null,
    cumulativeTwr: null,
    gainLossAmount: null,
    annualizedTwr: null,
    simpleReturn: 0,
    annualizedSimpleReturn: 0,
    cumulativeMwr: null,
    annualizedMwr: null,
    volatility: 0,
    maxDrawdown: 0,
    isHoldingsMode: false,
    ...overrides,
  };
}
