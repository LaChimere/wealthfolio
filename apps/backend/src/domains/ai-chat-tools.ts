import type { AccountService } from "./accounts";
import type { ActivityDetails, ActivityService } from "./activities";
import type { AiChatToolDefinition } from "./ai-chat";
import type { Goal, GoalService } from "./goals";
import type {
  AllocationHoldings,
  DailyAccountValuation,
  Holding,
  HoldingsService,
  PortfolioAllocations,
  TaxonomyAllocation,
} from "./holdings";
import type { IncomeSummary, PortfolioMetricsService } from "./portfolio-metrics";

const MAX_ACCOUNTS = 50;
const MAX_HOLDINGS = 100;
const MAX_GOALS = 50;
const MAX_VALUATIONS_POINTS = 400;
const DEFAULT_VALUATIONS_DAYS = 365;
const DEFAULT_ACTIVITIES_PAGE_SIZE = 50;
const MAX_ACTIVITIES_ROWS = 200;
const ZERO_EPSILON = 1e-9;

type PortfolioAiHoldingsService = Pick<HoldingsService, "getHoldings"> &
  Partial<
    Pick<
      HoldingsService,
      | "getHistoricalValuations"
      | "getHoldingsByAllocation"
      | "getLatestValuations"
      | "getPortfolioAllocations"
    >
  >;
type PortfolioAiActivityService = Pick<ActivityService, "searchActivities">;
type PortfolioAiMetricsService = Pick<PortfolioMetricsService, "getIncomeSummary">;

export interface PortfolioAiChatToolsOptions {
  accountService: Pick<AccountService, "getActiveAccounts"> &
    Partial<Pick<AccountService, "getAllAccounts">>;
  holdingsService?: PortfolioAiHoldingsService;
  goalService?: Pick<GoalService, "getGoals">;
  activityService?: PortfolioAiActivityService;
  portfolioMetricsService?: PortfolioAiMetricsService;
  baseCurrency?: string | (() => string | undefined);
  now?: () => Date;
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
    if (options.holdingsService.getHistoricalValuations) {
      tools.push(
        createGetValuationHistoryTool({
          accountService: options.accountService,
          holdingsService: {
            getHistoricalValuations: options.holdingsService.getHistoricalValuations,
          },
          baseCurrency: options.baseCurrency,
          now: options.now,
        }),
      );
    }
    if (
      options.holdingsService.getPortfolioAllocations &&
      options.holdingsService.getHoldingsByAllocation
    ) {
      tools.push(
        createGetAssetAllocationTool({
          holdingsService: {
            getPortfolioAllocations: options.holdingsService.getPortfolioAllocations,
            getHoldingsByAllocation: options.holdingsService.getHoldingsByAllocation,
          },
          baseCurrency: options.baseCurrency,
        }),
      );
    }
  }
  if (options.goalService) {
    tools.push(createGetGoalsTool(options.goalService));
  }
  if (options.activityService?.searchActivities) {
    tools.push(
      createSearchActivitiesTool({
        accountService: options.accountService,
        activityService: { searchActivities: options.activityService.searchActivities },
      }),
    );
  }
  if (options.portfolioMetricsService?.getIncomeSummary) {
    tools.push(
      createGetIncomeTool({
        getIncomeSummary: options.portfolioMetricsService.getIncomeSummary,
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

function createGetGoalsTool(goalService: Pick<GoalService, "getGoals">): AiChatToolDefinition {
  return {
    name: "get_goals",
    description:
      "Get investment goals with current progress. Returns goal title, target amount, current amount, progress percentage, and deadline for each goal.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    execute: () => {
      const goals = goalService.getGoals();
      const goalRows = goals.slice(0, MAX_GOALS).map(goalToolDto);
      const truncated = goals.length > goalRows.length;

      return {
        data: {
          goals: goalRows,
          count: goalRows.length,
          totalTarget: goalRows.reduce((sum, goal) => sum + goal.targetAmount, 0),
          totalCurrent: goalRows.reduce((sum, goal) => sum + goal.currentAmount, 0),
          achievedCount: goalRows.filter((goal) => goal.isAchieved).length,
          ...(truncated
            ? {
                truncated: true,
                originalCount: goals.length,
              }
            : {}),
        },
      };
    },
  };
}

function createSearchActivitiesTool(options: {
  accountService: Pick<AccountService, "getActiveAccounts">;
  activityService: Pick<Required<ActivityService>, "searchActivities">;
}): AiChatToolDefinition {
  return {
    name: "search_activities",
    description:
      "Search and get investment activities (transactions) such as buys, sells, dividends, deposits, and withdrawals. Supports filtering, date ranges, and pagination. Returns paginated results with totalPages so you can request more pages if needed.",
    parameters: {
      type: "object",
      properties: {
        accountId: {
          type: "string",
          description: "Filter by account ID (optional, all accounts if not provided)",
        },
        activityType: {
          type: "string",
          description: "Filter by activity type",
          enum: [
            "BUY",
            "SELL",
            "DIVIDEND",
            "DEPOSIT",
            "WITHDRAWAL",
            "TRANSFER_IN",
            "TRANSFER_OUT",
            "INTEREST",
            "FEE",
            "SPLIT",
            "TAX",
          ],
        },
        symbol: {
          type: "string",
          description: "Filter by symbol or asset keyword",
        },
        dateFrom: {
          type: "string",
          description: "Start date filter in YYYY-MM-DD format (optional)",
        },
        dateTo: {
          type: "string",
          description: "End date filter in YYYY-MM-DD format (optional)",
        },
        page: {
          type: "integer",
          description: "Page number, 1-based (default: 1)",
          default: 1,
        },
        pageSize: {
          type: "integer",
          description: "Number of results per page (default: 50, max: 200)",
          default: 50,
        },
      },
      required: [],
    },
    execute: async (rawArgs) => {
      const args = parseActivitySearchArgs(rawArgs);
      const page = Math.max(args.page ?? 1, 1);
      const pageSize = clamp(args.pageSize ?? DEFAULT_ACTIVITIES_PAGE_SIZE, 1, MAX_ACTIVITIES_ROWS);
      const accountId = normalizeOptionalFilter(args.accountId, { totalIsEmpty: true });
      const accountIds = resolveActivityAccountIds(accountId, options.accountService);
      const activityType = normalizeOptionalFilter(args.activityType);
      const symbol = normalizeOptionalFilter(args.symbol);
      const dateFrom = parseIsoDateFilter("dateFrom", args.dateFrom);
      const dateTo = parseIsoDateFilter("dateTo", args.dateTo);

      const response = await Promise.resolve(
        options.activityService.searchActivities({
          page: page - 1,
          pageSize,
          accountIds,
          activityTypes: activityType ? [activityType] : undefined,
          assetIdKeyword: symbol,
          sort: { id: "date", desc: true },
          dateFrom,
          dateTo,
        }),
      );
      const activities = response.data.map(activityToolDto);
      const totalRowCount = response.meta.totalRowCount;
      const totalPages = Math.ceil(totalRowCount / pageSize);
      const totalAmount = activities.reduce((sum, activity) => sum + (activity.amount ?? 0), 0);

      return {
        data: {
          activities,
          count: activities.length,
          totalRowCount,
          page,
          pageSize,
          totalPages,
          accountScope: accountId ?? "all",
          ...(totalAmount > 0 ? { totalAmount } : {}),
        },
      };
    },
  };
}

function createGetIncomeTool(
  portfolioMetricsService: Pick<Required<PortfolioMetricsService>, "getIncomeSummary">,
): AiChatToolDefinition {
  return {
    name: "get_income",
    description:
      "Fetch income summary including dividends, interest, and other income. Returns total income, monthly average, year-over-year growth, breakdown by type, and top income-generating assets.",
    parameters: {
      type: "object",
      properties: {
        period: {
          type: "string",
          enum: ["YTD", "LAST_YEAR", "TOTAL"],
          description:
            "Time period for income summary: YTD (year to date), LAST_YEAR, or TOTAL (all time). Defaults to YTD.",
        },
      },
      required: [],
    },
    execute: async (rawArgs) => {
      const args = parseIncomeArgs(rawArgs);
      const period = (args.period ?? "YTD").toUpperCase();
      const summaries = (await Promise.resolve(
        portfolioMetricsService.getIncomeSummary(undefined),
      )) as IncomeSummary[];
      const summary = summaries.find((candidate) => candidate.period === period);

      if (!summary) {
        throw new Error(`Period '${args.period ?? "YTD"}' not found in income data`);
      }

      const topAssets = Object.values(summary.byAsset)
        .filter((asset) => asset.income > 0)
        .sort((a, b) => b.income - a.income)
        .slice(0, 10)
        .map((asset) => ({
          symbol: asset.symbol,
          name: asset.name,
          income: asset.income,
        }));

      return {
        data: {
          totalIncome: summary.totalIncome,
          currency: summary.currency,
          monthlyAverage: summary.monthlyAverage,
          ...(summary.yoyGrowth !== null ? { yoyGrowth: summary.yoyGrowth } : {}),
          byType: summary.byType,
          topAssets,
          byMonth: summary.byMonth,
          period: summary.period,
        },
      };
    },
  };
}

function createGetValuationHistoryTool(options: {
  accountService: Pick<AccountService, "getActiveAccounts">;
  holdingsService: Pick<Required<HoldingsService>, "getHistoricalValuations">;
  baseCurrency?: string | (() => string | undefined);
  now?: () => Date;
}): AiChatToolDefinition {
  return {
    name: "get_valuation_history",
    description:
      "Get historical portfolio valuations over time. Returns daily valuation points with total value and net contributions. Use account_id='TOTAL' for aggregate valuations across all accounts. Useful for analyzing portfolio growth, performance trends, and comparing value vs contributions.",
    parameters: {
      type: "object",
      properties: {
        accountId: {
          type: "string",
          description: "Account ID to get valuations for, or 'TOTAL' for all accounts aggregated",
          default: "TOTAL",
        },
        startDate: {
          type: "string",
          description: "Start date in YYYY-MM-DD format. Defaults to 365 days ago.",
        },
        endDate: {
          type: "string",
          description: "End date in YYYY-MM-DD format. Defaults to today.",
        },
      },
      required: [],
    },
    execute: async (rawArgs) => {
      const args = parseValuationHistoryArgs(rawArgs);
      const baseCurrency = resolveBaseCurrency(options.baseCurrency);
      const endDate = parseOptionalIsoDate(args.endDate) ?? currentUtcDateString(options.now);
      const startDate =
        parseOptionalIsoDate(args.startDate) ?? addUtcDays(endDate, -DEFAULT_VALUATIONS_DAYS);

      const valuationRows =
        args.accountId === "TOTAL"
          ? await aggregateValuations({
              accountIds: options.accountService.getActiveAccounts().map((account) => account.id),
              getHistoricalValuations: options.holdingsService.getHistoricalValuations,
              startDate,
              endDate,
              baseCurrency,
            })
          : await readAccountValuations({
              accountId: args.accountId,
              getHistoricalValuations: options.holdingsService.getHistoricalValuations,
              startDate,
              endDate,
              baseCurrency,
            });

      const originalCount = valuationRows.length;
      const valuations = valuationRows.slice(0, MAX_VALUATIONS_POINTS);
      const truncated = originalCount > valuations.length;

      return {
        data: {
          valuations,
          accountScope: args.accountId,
          currency: baseCurrency,
          startDate,
          endDate,
          ...(truncated
            ? {
                truncated: true,
                originalCount,
              }
            : {}),
        },
      };
    },
  };
}

function createGetAssetAllocationTool(options: {
  holdingsService: Pick<
    Required<HoldingsService>,
    "getHoldingsByAllocation" | "getPortfolioAllocations"
  >;
  baseCurrency?: string | (() => string | undefined);
}): AiChatToolDefinition {
  return {
    name: "get_asset_allocation",
    description:
      "Get portfolio asset allocation breakdown. Can group by asset class, sector, region, risk level, or security type. Supports drill-down to see holdings within a specific category.",
    parameters: {
      type: "object",
      properties: {
        accountId: {
          type: "string",
          description: "Account ID to get allocation for, or 'TOTAL' for all accounts",
          default: "TOTAL",
        },
        groupBy: {
          type: "string",
          enum: ["class", "sector", "region", "risk", "security_type"],
          description:
            "Grouping: 'class' (Equity/Fixed Income/Cash), 'sector' (Technology/Healthcare/etc), 'region' (North America/Europe/etc), 'risk' (Low/Medium/High), 'security_type' (Stock/ETF/Bond)",
          default: "class",
        },
        taxonomyId: {
          type: "string",
          description: "For drill-down: taxonomy ID (use value from previous allocation response)",
        },
        categoryId: {
          type: "string",
          description:
            "For drill-down: category ID to show holdings for (use value from previous allocation response)",
        },
      },
      required: [],
    },
    execute: async (rawArgs) => {
      const args = parseAssetAllocationArgs(rawArgs);
      const groupBy = args.groupBy.toLowerCase();

      if (args.taxonomyId !== undefined && args.categoryId !== undefined) {
        const result = (await Promise.resolve(
          options.holdingsService.getHoldingsByAllocation(
            args.accountId,
            args.taxonomyId,
            args.categoryId,
          ),
        )) as AllocationHoldings;
        return {
          data: {
            holdings: result.holdings.map((holding) => ({
              symbol: holding.symbol,
              name: holding.name,
              value: holding.marketValue,
              weight: holding.weightInCategory,
            })),
            totalValue: result.totalValue,
            currency: result.currency,
            groupBy,
            taxonomyId: result.taxonomyId,
            taxonomyName: result.taxonomyName,
            categoryName: result.categoryName,
          },
        };
      }

      const allocations = (await Promise.resolve(
        options.holdingsService.getPortfolioAllocations(args.accountId),
      )) as PortfolioAllocations;
      const taxonomy = taxonomyForGroupBy(allocations, groupBy);

      return {
        data: {
          allocations: taxonomy.categories.map((category) => ({
            categoryId: category.categoryId,
            categoryName: category.categoryName,
            value: category.value,
            percentage: category.percentage,
            color: category.color,
          })),
          totalValue: allocations.totalValue,
          currency: resolveBaseCurrency(options.baseCurrency),
          groupBy,
          taxonomyId: taxonomy.taxonomyId,
          taxonomyName: taxonomy.taxonomyName,
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

function parseActivitySearchArgs(args: unknown): {
  accountId?: string;
  activityType?: string;
  symbol?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
} {
  if (!isRecord(args)) {
    return {};
  }
  return {
    accountId: typeof args.accountId === "string" ? args.accountId : undefined,
    activityType: typeof args.activityType === "string" ? args.activityType : undefined,
    symbol: typeof args.symbol === "string" ? args.symbol : undefined,
    dateFrom: typeof args.dateFrom === "string" ? args.dateFrom : undefined,
    dateTo: typeof args.dateTo === "string" ? args.dateTo : undefined,
    page:
      typeof args.page === "number" && Number.isFinite(args.page)
        ? Math.trunc(args.page)
        : undefined,
    pageSize:
      typeof args.pageSize === "number" && Number.isFinite(args.pageSize)
        ? Math.trunc(args.pageSize)
        : undefined,
  };
}

function parseIncomeArgs(args: unknown): { period?: string } {
  if (!isRecord(args)) {
    return {};
  }
  return {
    period: typeof args.period === "string" ? args.period : undefined,
  };
}

function parseValuationHistoryArgs(args: unknown): {
  accountId: string;
  startDate?: string;
  endDate?: string;
} {
  if (!isRecord(args)) {
    return { accountId: "TOTAL" };
  }
  return {
    accountId: typeof args.accountId === "string" && args.accountId ? args.accountId : "TOTAL",
    startDate: typeof args.startDate === "string" ? args.startDate : undefined,
    endDate: typeof args.endDate === "string" ? args.endDate : undefined,
  };
}

function parseAssetAllocationArgs(args: unknown): {
  accountId: string;
  groupBy: string;
  taxonomyId?: string;
  categoryId?: string;
} {
  if (!isRecord(args)) {
    return { accountId: "TOTAL", groupBy: "class" };
  }
  return {
    accountId: typeof args.accountId === "string" && args.accountId ? args.accountId : "TOTAL",
    groupBy: typeof args.groupBy === "string" && args.groupBy ? args.groupBy : "class",
    taxonomyId: typeof args.taxonomyId === "string" ? args.taxonomyId : undefined,
    categoryId: typeof args.categoryId === "string" ? args.categoryId : undefined,
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

function goalToolDto(goal: Goal) {
  return {
    id: goal.id,
    title: goal.title,
    description: goal.description,
    targetAmount: goal.summaryTargetAmount ?? goal.targetAmount ?? 0,
    currentAmount: goal.summaryCurrentValue ?? 0,
    progressPercent: (goal.summaryProgress ?? 0) * 100,
    deadline: goal.targetDate,
    isAchieved: goal.statusLifecycle === "achieved",
  };
}

function activityToolDto(activity: ActivityDetails) {
  const quantity = parseOptionalNumber(activity.quantity);
  const unitPrice = parseOptionalNumber(activity.unitPrice);
  const amount =
    parseOptionalNumber(activity.amount) ??
    (quantity !== null && unitPrice !== null ? quantity * unitPrice : null);

  return {
    id: activity.id,
    date: activity.date,
    activityType: activity.activityType,
    symbol: activity.assetSymbol === "" ? null : activity.assetSymbol,
    quantity,
    unitPrice,
    amount,
    fee: parseOptionalNumber(activity.fee),
    fxRate: parseOptionalNumber(activity.fxRate),
    currency: activity.currency,
    accountId: activity.accountId,
    accountName: activity.accountName,
  };
}

async function aggregateValuations(options: {
  accountIds: string[];
  getHistoricalValuations: Required<HoldingsService>["getHistoricalValuations"];
  startDate: string;
  endDate: string;
  baseCurrency: string;
}) {
  const byDate = new Map<string, { totalValue: number; netContribution: number }>();

  for (const accountId of options.accountIds) {
    const valuations = (await Promise.resolve(
      options.getHistoricalValuations(accountId, options.startDate, options.endDate),
    )) as DailyAccountValuation[];
    for (const valuation of valuations) {
      const entry = byDate.get(valuation.valuationDate) ?? {
        totalValue: 0,
        netContribution: 0,
      };
      entry.totalValue += valuation.totalValue * valuation.fxRateToBase;
      entry.netContribution += valuation.netContribution * valuation.fxRateToBase;
      byDate.set(valuation.valuationDate, entry);
    }
  }

  return [...byDate.entries()]
    .map(([date, value]) => ({
      date,
      totalValue: value.totalValue,
      netContribution: value.netContribution,
      currency: options.baseCurrency,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function readAccountValuations(options: {
  accountId: string;
  getHistoricalValuations: Required<HoldingsService>["getHistoricalValuations"];
  startDate: string;
  endDate: string;
  baseCurrency: string;
}) {
  const valuations = (await Promise.resolve(
    options.getHistoricalValuations(options.accountId, options.startDate, options.endDate),
  )) as DailyAccountValuation[];
  return valuations.map((valuation) => ({
    date: valuation.valuationDate,
    totalValue: valuation.totalValue * valuation.fxRateToBase,
    netContribution: valuation.netContribution * valuation.fxRateToBase,
    currency: options.baseCurrency,
  }));
}

function taxonomyForGroupBy(
  allocations: PortfolioAllocations,
  groupBy: string,
): TaxonomyAllocation {
  switch (groupBy) {
    case "class":
      return allocations.assetClasses;
    case "sector":
      return allocations.sectors;
    case "region":
      return allocations.regions;
    case "risk":
      return allocations.riskCategory;
    case "security_type":
      return allocations.securityTypes;
    default:
      throw new Error(
        `Invalid groupBy value '${groupBy}'. Must be 'class', 'sector', 'region', 'risk', or 'security_type'.`,
      );
  }
}

function resolveActivityAccountIds(
  accountId: string | undefined,
  accountService: Pick<AccountService, "getActiveAccounts">,
): string[] | undefined {
  if (!accountId) {
    return undefined;
  }

  const accounts = accountService.getActiveAccounts();
  if (accounts.some((account) => account.id === accountId)) {
    return [accountId];
  }

  const lowerAccountId = accountId.toLowerCase();
  const matchedAccountIds = accounts
    .filter((account) => account.name.toLowerCase() === lowerAccountId)
    .map((account) => account.id);
  return matchedAccountIds.length > 0 ? matchedAccountIds : [accountId];
}

function normalizeOptionalFilter(
  value: string | undefined,
  options: { totalIsEmpty?: boolean } = {},
): string | undefined {
  if (!value) {
    return undefined;
  }
  if (options.totalIsEmpty && value.toLowerCase() === "total") {
    return undefined;
  }
  return value;
}

function parseIsoDateFilter(name: string, value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid ${name} format: ${value}`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid ${name} format: ${value}`);
  }
  return value;
}

function parseOptionalIsoDate(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
    ? undefined
    : value;
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function parseOptionalNumber(value: string | null): number | null {
  if (value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function currentUtcDateString(now: (() => Date) | undefined): string {
  return (now?.() ?? new Date()).toISOString().slice(0, 10);
}

function addUtcDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function failCashBalanceConversion(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
