import type { AccountService } from "./accounts";
import type { AiChatToolDefinition } from "./ai-chat";
import type { Holding, HoldingsService } from "./holdings";

const MAX_ACCOUNTS = 50;
const MAX_HOLDINGS = 100;

export interface PortfolioAiChatToolsOptions {
  accountService: Pick<AccountService, "getActiveAccounts"> &
    Partial<Pick<AccountService, "getAllAccounts">>;
  holdingsService?: Pick<HoldingsService, "getHoldings">;
  baseCurrency?: string | (() => string | undefined);
}

export function createPortfolioAiChatTools(
  options: PortfolioAiChatToolsOptions,
): AiChatToolDefinition[] {
  const tools = [createGetAccountsTool(options.accountService)];
  if (options.holdingsService) {
    tools.push(
      createGetHoldingsTool({
        accountService: options.accountService,
        holdingsService: options.holdingsService,
        baseCurrency: options.baseCurrency,
      }),
    );
  }
  return tools;
}

function createGetAccountsTool(
  accountService: Pick<AccountService, "getActiveAccounts">,
): AiChatToolDefinition {
  return {
    name: "get_accounts",
    description:
      "Get the list of active investment accounts. Returns account id, name, type, and currency for each account.",
    parameters: {
      type: "object",
      properties: {
        displayMode: {
          type: "string",
          enum: ["full", "compact"],
          description:
            "Pass 'compact' when fetching accounts as input for another tool call. Omit when the user directly asked to see their accounts.",
        },
      },
      required: [],
    },
    execute: () => {
      const accounts = accountService.getActiveAccounts();
      const accountRows = accounts.slice(0, MAX_ACCOUNTS).map((account) => ({
        id: account.id,
        name: account.name,
        accountType: account.accountType,
        currency: account.currency,
        isActive: account.isActive,
      }));
      const truncated = accounts.length > accountRows.length;
      return {
        data: {
          accounts: accountRows,
          count: accountRows.length,
          ...(truncated
            ? {
                truncated: true,
                originalCount: accounts.length,
              }
            : {}),
        },
      };
    },
  };
}

function createGetHoldingsTool(options: {
  accountService: Partial<Pick<AccountService, "getAllAccounts">>;
  holdingsService: Pick<HoldingsService, "getHoldings">;
  baseCurrency?: string | (() => string | undefined);
}): AiChatToolDefinition {
  return {
    name: "get_holdings",
    description:
      "Get portfolio holdings for an account or all accounts. Returns symbol, quantity, market value, cost basis, and gain/loss for each holding.",
    parameters: {
      type: "object",
      properties: {
        accountId: {
          type: "string",
          description: "Account ID to get holdings for, or 'TOTAL' for all accounts",
          default: "TOTAL",
        },
        viewMode: {
          type: "string",
          enum: ["table", "treemap", "both"],
          description:
            "Display mode: 'treemap' for composition chart with daily gains, 'table' for detailed list, or 'both' for treemap plus table",
          default: "treemap",
        },
      },
      required: [],
    },
    execute: async (rawArgs) => {
      const args = parseHoldingsArgs(rawArgs);
      const holdings = await Promise.resolve(options.holdingsService.getHoldings(args.accountId));
      const accountNames = new Map(
        (options.accountService.getAllAccounts?.() ?? []).map((account) => [
          account.id,
          account.name,
        ]),
      );
      const holdingRows = (holdings as Holding[])
        .filter((holding) => holding.holdingType !== "cash")
        .slice(0, MAX_HOLDINGS)
        .map((holding) => holdingToolDto(holding, accountNames));
      const truncated = holdings.length > holdingRows.length;

      return {
        data: {
          holdings: holdingRows,
          totalValue: holdingRows.reduce((sum, holding) => sum + holding.marketValueBase, 0),
          currency: resolveBaseCurrency(options.baseCurrency),
          accountScope: args.accountId,
          viewMode: args.viewMode,
          ...(truncated
            ? {
                truncated: true,
                originalCount: holdings.length,
              }
            : {}),
        },
      };
    },
  };
}

function parseHoldingsArgs(args: unknown): { accountId: string; viewMode: string } {
  if (!isRecord(args)) {
    return { accountId: "TOTAL", viewMode: "treemap" };
  }
  return {
    accountId: typeof args.accountId === "string" && args.accountId ? args.accountId : "TOTAL",
    viewMode: typeof args.viewMode === "string" && args.viewMode ? args.viewMode : "treemap",
  };
}

function holdingToolDto(holding: Holding, accountNames: Map<string, string>) {
  return {
    account: accountNames.get(holding.accountId) ?? holding.accountId,
    symbol: holding.instrument?.symbol ?? "CASH",
    name: holding.instrument?.name ?? null,
    holdingType: holdingTypeLabel(holding.holdingType),
    quantity: holding.quantity,
    marketValueBase: holding.marketValue.base,
    costBasisBase: holding.costBasis?.base ?? null,
    unrealizedGainPct: holding.unrealizedGainPct,
    dayChangePct: holding.dayChangePct,
    weight: holding.weight,
    currency: holding.localCurrency,
  };
}

function holdingTypeLabel(value: Holding["holdingType"]): string {
  switch (value) {
    case "security":
      return "Security";
    case "alternativeAsset":
      return "AlternativeAsset";
    case "cash":
      return "Cash";
  }
}

function resolveBaseCurrency(
  baseCurrency: string | (() => string | undefined) | undefined,
): string {
  const value = typeof baseCurrency === "function" ? baseCurrency() : baseCurrency;
  return value && value.trim() ? value : "USD";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
