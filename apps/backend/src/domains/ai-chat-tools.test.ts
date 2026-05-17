import { describe, expect, test } from "bun:test";

import { createPortfolioAiChatTools } from "./ai-chat-tools";
import type { Account } from "./accounts";
import type { Holding } from "./holdings";

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
