import { describe, expect, test } from "bun:test";

import { createPortfolioAiChatTools } from "./ai-chat-tools";
import type { Account } from "./accounts";

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
