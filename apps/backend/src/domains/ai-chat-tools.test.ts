import { describe, expect, test } from "bun:test";

import { createPortfolioAiChatTools } from "./ai-chat-tools";
import type { Account } from "./accounts";
import type { ActivityDetails, ActivitySearchRequest } from "./activities";
import type { Goal } from "./goals";
import type { DailyAccountValuation, Holding } from "./holdings";
import type { IncomeSummary } from "./portfolio-metrics";

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
