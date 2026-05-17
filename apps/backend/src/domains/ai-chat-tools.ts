import type { AccountService } from "./accounts";
import type { AiChatToolDefinition } from "./ai-chat";
import type { DailyAccountValuation, Holding, HoldingsService } from "./holdings";

const MAX_ACCOUNTS = 50;
const MAX_HOLDINGS = 100;
const ZERO_EPSILON = 1e-9;

type PortfolioAiHoldingsService = Pick<HoldingsService, "getHoldings"> &
  Partial<Pick<HoldingsService, "getLatestValuations">>;

export interface PortfolioAiChatToolsOptions {
  accountService: Pick<AccountService, "getActiveAccounts"> &
    Partial<Pick<AccountService, "getAllAccounts">>;
  holdingsService?: PortfolioAiHoldingsService;
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
    if (options.holdingsService.getLatestValuations) {
      tools.push(
        createGetCashBalancesTool({
          accountService: options.accountService,
          holdingsService: {
            getHoldings: options.holdingsService.getHoldings,
            getLatestValuations: options.holdingsService.getLatestValuations,
          },
          baseCurrency: options.baseCurrency,
        }),
      );
    }
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

function createGetCashBalancesTool(options: {
  accountService: Pick<AccountService, "getActiveAccounts">;
  holdingsService: Pick<HoldingsService, "getHoldings" | "getLatestValuations">;
  baseCurrency?: string | (() => string | undefined);
}): AiChatToolDefinition {
  return {
    name: "get_cash_balances",
    description:
      "Get cash balances for investment accounts. Returns per-account, per-currency cash positions with totals in both account currency and base currency. Use this when the user asks about cash, available funds, uninvested money, or account balances.",
    parameters: {
      type: "object",
      properties: {
        accountId: {
          type: "string",
          description: "Account ID, or 'TOTAL' for all accounts. Default: 'TOTAL'.",
        },
      },
      required: [],
    },
    execute: async (rawArgs) => {
      const baseCurrency = resolveBaseCurrency(options.baseCurrency);
      const args = parseCashBalancesArgs(rawArgs);
      const accounts = options.accountService.getActiveAccounts();
      const accountLookup = new Map(
        accounts.map((account) => [account.id, { name: account.name, currency: account.currency }]),
      );
      const targetAccountIds =
        args.accountId === "TOTAL" || args.accountId === ""
          ? accounts.map((account) => account.id)
          : [args.accountId];

      if (targetAccountIds.length === 0) {
        return {
          data: {
            accounts: [],
            grandTotalBase: 0,
            baseCurrency,
          },
        };
      }

      const valuations = await Promise.resolve(
        options.holdingsService.getLatestValuations(targetAccountIds),
      );
      const valuationByAccount = new Map(
        (valuations as DailyAccountValuation[]).map((valuation) => [
          valuation.accountId,
          valuation,
        ]),
      );
      const accountSummaries = [];
      let grandTotalBase = 0;

      for (const accountId of targetAccountIds) {
        const holdings = await Promise.resolve(options.holdingsService.getHoldings(accountId));
        const cashHoldings = (holdings as Holding[]).filter(
          (holding) => holding.holdingType === "cash",
        );

        if (cashHoldings.length === 0) {
          continue;
        }

        const account = accountLookup.get(accountId);
        const accountName = account?.name ?? accountId;
        const accountCurrency = account?.currency ?? baseCurrency;
        const balances = cashHoldings.map((holding) => ({
          currency: holding.instrument?.currency ?? holding.localCurrency,
          amount: holding.quantity,
        }));
        const rawTotal = balances.reduce((sum, balance) => sum + balance.amount, 0);
        const allInAccountCurrency = balances.every(
          (balance) => balance.currency === accountCurrency,
        );
        const allInBaseCurrency = balances.every((balance) => balance.currency === baseCurrency);
        const valuation = valuationByAccount.get(accountId);
        const totalBase = cashHoldings.reduce((sum, holding) => sum + holding.marketValue.base, 0);
        const totalBaseCurrency = nonZero(totalBase)
          ? totalBase
          : valuation
            ? valuation.cashBalance * valuation.fxRateToBase
            : allInBaseCurrency
              ? rawTotal
              : failCashBalanceConversion(
                  `Cash balance for account '${accountId}' includes currencies that cannot be converted to base currency.`,
                );
        const totalAccountCurrency = valuation
          ? valuation.cashBalance
          : allInAccountCurrency
            ? rawTotal
            : accountCurrency === baseCurrency
              ? totalBaseCurrency
              : failCashBalanceConversion(
                  `Cash balance for account '${accountId}' includes mixed currencies without an account-currency total.`,
                );

        grandTotalBase += totalBaseCurrency;
        accountSummaries.push({
          accountId,
          accountName,
          accountCurrency,
          balances,
          totalAccountCurrency,
          totalBaseCurrency,
        });
      }

      return {
        data: {
          accounts: accountSummaries,
          grandTotalBase,
          baseCurrency,
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

function parseCashBalancesArgs(args: unknown): { accountId: string } {
  if (!isRecord(args)) {
    return { accountId: "TOTAL" };
  }
  return {
    accountId: typeof args.accountId === "string" ? args.accountId : "TOTAL",
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

function nonZero(value: number): boolean {
  return Math.abs(value) > ZERO_EPSILON;
}

function failCashBalanceConversion(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
