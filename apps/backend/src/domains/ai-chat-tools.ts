import type { Account, AccountService } from "./accounts";
import {
  ACTIVITY_IMPORT_CONTEXT_KIND,
  type ActivityDetails,
  type ActivityService,
  type FieldMappingValue,
  type ImportMappingData,
} from "./activities";
import type { AiChatToolDefinition } from "./ai-chat";
import type { Goal, GoalService } from "./goals";
import type { HealthService, HealthStatus } from "./health";
import type {
  AllocationHoldings,
  DailyAccountValuation,
  Holding,
  HoldingsService,
  PortfolioAllocations,
  TaxonomyAllocation,
} from "./holdings";
import type { MarketDataService, SymbolSearchResult } from "./market-data";
import type {
  IncomeSummary,
  PerformanceMetrics,
  PortfolioMetricsService,
} from "./portfolio-metrics";

const MAX_ACCOUNTS = 50;
const MAX_HOLDINGS = 100;
const MAX_GOALS = 50;
const MAX_VALUATIONS_POINTS = 400;
const DEFAULT_VALUATIONS_DAYS = 365;
const DEFAULT_ACTIVITIES_PAGE_SIZE = 50;
const MAX_ACTIVITIES_ROWS = 200;
const MAX_RECORD_ACTIVITIES_BATCH_SIZE = 100;
const MAX_IMPORT_CSV_SAMPLE_ROWS = 10;
const ZERO_EPSILON = 1e-9;
const CSV_TEXT_ENCODER = new TextEncoder();
const ACTIVITY_TYPES = [
  "BUY",
  "SELL",
  "SPLIT",
  "DIVIDEND",
  "INTEREST",
  "DEPOSIT",
  "WITHDRAWAL",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "FEE",
  "TAX",
  "CREDIT",
  "ADJUSTMENT",
  "UNKNOWN",
] as const;
const ACTIVITY_SUBTYPE_DRIP = "DRIP";
const ACTIVITY_SUBTYPE_DIVIDEND_IN_KIND = "DIVIDEND_IN_KIND";
const ACTIVITY_SUBTYPE_STAKING_REWARD = "STAKING_REWARD";
const ACTIVITY_SUBTYPE_BONUS = "BONUS";
const IMPORT_FIELD_DATE = "date";
const IMPORT_FIELD_ACTIVITY_TYPE = "activityType";
const IMPORT_FIELD_SYMBOL = "symbol";
const IMPORT_FIELD_QUANTITY = "quantity";
const IMPORT_FIELD_UNIT_PRICE = "unitPrice";
const IMPORT_FIELD_AMOUNT = "amount";
const IMPORT_FIELD_FEE = "fee";
const IMPORT_FIELD_CURRENCY = "currency";
const IMPORT_FIELD_ACCOUNT = "account";
const IMPORT_FIELD_COMMENT = "comment";
const IMPORT_FIELD_FX_RATE = "fxRate";
const IMPORT_FIELD_SUBTYPE = "subtype";

type ActivityType = (typeof ACTIVITY_TYPES)[number];

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
type PortfolioAiActivityService = Partial<
  Pick<ActivityService, "getImportMapping" | "parseCsv" | "searchActivities">
>;
type PortfolioAiHealthService = Pick<HealthService, "getCachedHealthStatus">;
type PortfolioAiMarketDataService = Pick<MarketDataService, "searchSymbol">;
type PortfolioAiMetricsService = Partial<
  Pick<PortfolioMetricsService, "calculatePerformanceHistory" | "getIncomeSummary">
>;

export interface PortfolioAiChatToolsOptions {
  accountService: Pick<AccountService, "getActiveAccounts"> &
    Partial<Pick<AccountService, "getAllAccounts">>;
  holdingsService?: PortfolioAiHoldingsService;
  goalService?: Pick<GoalService, "getGoals">;
  healthService?: PortfolioAiHealthService;
  activityService?: PortfolioAiActivityService;
  marketDataService?: PortfolioAiMarketDataService;
  portfolioMetricsService?: PortfolioAiMetricsService;
  baseCurrency?: string | (() => string | undefined);
  now?: () => Date;
  timezone?: string | (() => string | undefined);
}

export function createPortfolioAiChatTools(
  options: PortfolioAiChatToolsOptions,
): AiChatToolDefinition[] {
  const tools = [
    createGetAccountsTool(options.accountService),
    createRecordActivityTool({
      accountService: options.accountService,
      marketDataService: options.marketDataService,
      baseCurrency: options.baseCurrency,
      now: options.now,
      timezone: options.timezone,
    }),
    createRecordActivitiesTool({
      accountService: options.accountService,
      marketDataService: options.marketDataService,
      baseCurrency: options.baseCurrency,
    }),
  ];
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
  if (options.activityService?.parseCsv) {
    tools.push(
      createImportCsvTool({
        accountService: options.accountService,
        activityService: {
          parseCsv: options.activityService.parseCsv,
          getImportMapping: options.activityService.getImportMapping,
        },
        baseCurrency: options.baseCurrency,
      }),
    );
  }
  if (options.portfolioMetricsService?.calculatePerformanceHistory) {
    tools.push(
      createGetPerformanceTool({
        calculatePerformanceHistory: options.portfolioMetricsService.calculatePerformanceHistory,
        baseCurrency: options.baseCurrency,
        now: options.now,
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
  if (options.healthService?.getCachedHealthStatus) {
    tools.push(
      createGetHealthStatusTool({
        getCachedHealthStatus: options.healthService.getCachedHealthStatus,
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

interface RecordActivityArgs {
  activityType: string;
  symbol?: string;
  activityDate: string;
  quantity?: number;
  unitPrice?: number;
  amount?: number;
  fee?: number;
  account?: string;
  subtype?: string;
  notes?: string;
}

interface AccountOption {
  id: string;
  name: string;
  currency: string;
}

interface ActivityDraft {
  activityType: string;
  activityDate: string;
  symbol: string | null;
  assetId: string | null;
  assetName: string | null;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
  fee: number | null;
  currency: string;
  accountId: string | null;
  accountName: string | null;
  subtype: string | null;
  notes: string | null;
  priceSource: string;
  pricingMode: string;
  isCustomAsset: boolean;
  assetKind: string | null;
}

interface ResolvedAsset {
  assetId: string;
  symbol: string;
  name: string;
  currency: string;
  exchange: string | null;
  exchangeMic: string | null;
  instrumentType: string | null;
}

interface RecordActivityOutputData {
  draft: ActivityDraft;
  validation: ReturnType<typeof validateRecordActivityDraft>;
  availableAccounts: AccountOption[];
  resolvedAsset: ResolvedAsset | null;
  availableSubtypes: Array<{ value: string; label: string }>;
}

interface ImportCsvArgs {
  csvContent: string;
  accountId?: string;
  fieldMappings?: Record<string, string>;
  activityMappings?: Record<string, string[]>;
  symbolMappings?: Record<string, string>;
  accountMappings?: Record<string, string>;
  delimiter?: string;
  skipTopRows?: number;
  skipBottomRows?: number;
  dateFormat?: string;
  decimalSeparator?: string;
  thousandsSeparator?: string;
  defaultCurrency?: string;
}

interface ImportCsvParseConfig extends Record<string, unknown> {
  delimiter?: string;
  skipTopRows?: number;
  skipBottomRows?: number;
  dateFormat?: string | null;
  decimalSeparator?: string | null;
  thousandsSeparator?: string | null;
  defaultCurrency?: string | null;
}

interface ParsedImportCsv {
  headers: string[];
  rows: string[][];
  rowCount?: number;
}

function createRecordActivityTool(options: {
  accountService: Pick<AccountService, "getActiveAccounts">;
  marketDataService?: PortfolioAiMarketDataService;
  baseCurrency?: string | (() => string | undefined);
  now?: () => Date;
  timezone?: string | (() => string | undefined);
}): AiChatToolDefinition {
  const dateContext = recordActivityDateContext(options.now, options.timezone);
  return {
    name: "record_activity",
    description: `Record investment transactions from natural language. Creates a draft preview for user confirmation. Supports all activity types: BUY, SELL, DIVIDEND, DEPOSIT, WITHDRAWAL, TRANSFER_IN, TRANSFER_OUT, INTEREST, FEE, SPLIT, TAX, CREDIT, ADJUSTMENT. User timezone is ${dateContext.timezone}; current date there is ${dateContext.currentDate} (${dateContext.currentWeekday}). Resolve all relative date phrases yourself before calling this tool. If the user has multiple accounts and did not specify which account to use, ask which account before calling this tool.`,
    parameters: {
      type: "object",
      properties: {
        activityType: {
          type: "string",
          description:
            "Activity type: BUY, SELL, DIVIDEND, DEPOSIT, WITHDRAWAL, TRANSFER_IN, TRANSFER_OUT, INTEREST, FEE, SPLIT, TAX, CREDIT, ADJUSTMENT",
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
            "CREDIT",
            "ADJUSTMENT",
            "UNKNOWN",
          ],
        },
        symbol: {
          type: "string",
          description:
            "Symbol or ticker (e.g., 'AAPL', 'BTC', 'VTI'). Required for BUY/SELL/DIVIDEND/SPLIT and asset-backed income subtypes like DRIP, DIVIDEND_IN_KIND, and STAKING_REWARD",
        },
        activityDate: {
          type: "string",
          description: `Concrete ISO 8601 date only, e.g. '2026-01-17'. Do not pass relative phrases like 'yesterday', 'today', 'last Friday', or 'next Monday'. Resolve them relative to current local date ${dateContext.currentDate} (${dateContext.currentWeekday}) in timezone ${dateContext.timezone} before calling this tool.`,
        },
        quantity: {
          type: "number",
          description:
            "Number of shares or units. Required for BUY/SELL/SPLIT and asset-backed income subtypes like DRIP, DIVIDEND_IN_KIND, and STAKING_REWARD",
        },
        unitPrice: {
          type: "number",
          description:
            "Price or fair market value per unit. Required for BUY/SELL unless amount is provided; for DRIP, DIVIDEND_IN_KIND, and STAKING_REWARD, provide either unitPrice or amount",
        },
        amount: {
          type: "number",
          description:
            "Total cash amount or taxable income amount. For DRIP, DIVIDEND_IN_KIND, and STAKING_REWARD, provide either amount or unitPrice",
        },
        fee: {
          type: "number",
          description: "Transaction fee (optional)",
        },
        account: {
          type: "string",
          description:
            "Account name or ID. Required before calling this tool when the user has multiple accounts. If the user did not specify an account, ask which account first instead of calling this tool with an empty account.",
        },
        subtype: {
          type: "string",
          description:
            "Activity subtype for semantic variations: DRIP (dividend reinvested), DIVIDEND_IN_KIND (dividend paid as additional units of the same asset), STAKING_REWARD (staking income received as more units of the same asset), BONUS (promotional credit)",
        },
        notes: {
          type: "string",
          description: "Optional notes for the transaction",
        },
      },
      required: ["activityType", "activityDate"],
    },
    execute: async (rawArgs) => {
      const args = parseRecordActivityArgs(rawArgs);
      const accounts = options.accountService.getActiveAccounts();

      return {
        data: await buildRecordActivityOutput(args, accounts, options),
      };
    },
  };
}

function createRecordActivitiesTool(options: {
  accountService: Pick<AccountService, "getActiveAccounts">;
  marketDataService?: PortfolioAiMarketDataService;
  baseCurrency?: string | (() => string | undefined);
}): AiChatToolDefinition {
  return {
    name: "record_activities",
    description:
      "Record multiple investment transactions from natural language. Returns a read-only batch draft preview for single confirmation. If the user has multiple accounts and did not specify which account to use, ask which account before calling this tool.",
    parameters: {
      type: "object",
      properties: {
        activities: {
          type: "array",
          description: "List of activities to record together",
          items: {
            type: "object",
            properties: {
              activityType: {
                type: "string",
                description:
                  "Activity type: BUY, SELL, DIVIDEND, DEPOSIT, WITHDRAWAL, TRANSFER_IN, TRANSFER_OUT, INTEREST, FEE, SPLIT, TAX, CREDIT, ADJUSTMENT",
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
                  "CREDIT",
                  "ADJUSTMENT",
                  "UNKNOWN",
                ],
              },
              symbol: {
                type: "string",
                description:
                  "Symbol or ticker (e.g., 'AAPL', 'BTC', 'VTI'). Required for BUY/SELL/DIVIDEND/SPLIT and asset-backed income subtypes like DRIP, DIVIDEND_IN_KIND, and STAKING_REWARD",
              },
              activityDate: {
                type: "string",
                description:
                  "ISO 8601 date (e.g., '2026-01-17'). Parse relative dates to ISO format",
              },
              quantity: {
                type: "number",
                description:
                  "Number of shares or units. Required for BUY/SELL/SPLIT and asset-backed income subtypes like DRIP, DIVIDEND_IN_KIND, and STAKING_REWARD",
              },
              unitPrice: {
                type: "number",
                description:
                  "Price or fair market value per unit. For DRIP, DIVIDEND_IN_KIND, and STAKING_REWARD, provide either unitPrice or amount",
              },
              amount: {
                type: "number",
                description:
                  "Total cash amount or taxable income amount. For DRIP, DIVIDEND_IN_KIND, and STAKING_REWARD, provide either amount or unitPrice",
              },
              fee: {
                type: "number",
                description: "Transaction fee (optional)",
              },
              account: {
                type: "string",
                description:
                  "Account name or ID. Required before calling this tool when the user has multiple accounts. If the user did not specify an account for a row, ask which account first instead of calling this tool with an empty account.",
              },
              subtype: {
                type: "string",
                description:
                  "Activity subtype: DRIP, DIVIDEND_IN_KIND (additional units of the same asset), STAKING_REWARD (staking income received as more units of the same asset), BONUS",
              },
              notes: {
                type: "string",
                description: "Optional notes",
              },
            },
            required: ["activityType", "activityDate"],
          },
        },
      },
      required: ["activities"],
    },
    execute: async (rawArgs) => {
      const activities = parseRecordActivitiesArgs(rawArgs);
      if (activities.length === 0) {
        return {
          data: {
            drafts: [],
            validation: { totalRows: 0, validRows: 0, errorRows: 0 },
            availableAccounts: [],
            resolvedAssets: [],
          },
        };
      }
      if (activities.length > MAX_RECORD_ACTIVITIES_BATCH_SIZE) {
        throw new Error(
          `Batch limited to ${MAX_RECORD_ACTIVITIES_BATCH_SIZE} activities, got ${activities.length}`,
        );
      }

      const accounts = options.accountService.getActiveAccounts();
      const availableAccounts = recordActivityAccountOptions(accounts);
      const drafts = [];
      for (const [rowIndex, activity] of activities.entries()) {
        try {
          const output = await buildRecordActivityOutput(activity, accounts, options);
          const errors = recordActivityRowErrors(output.validation);
          drafts.push({
            rowIndex,
            draft: output.draft,
            validation: output.validation,
            errors,
            resolvedAsset: output.resolvedAsset,
            availableSubtypes: output.availableSubtypes,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          drafts.push({
            rowIndex,
            draft: fallbackRecordActivityDraft(resolveBaseCurrency(options.baseCurrency)),
            validation: {
              isValid: false,
              missingFields: [],
              errors: [{ field: "row", message }],
            },
            errors: [message],
            resolvedAsset: null,
            availableSubtypes: [],
          });
        }
      }

      const validRows = drafts.filter((draft) => draft.validation.isValid).length;
      const resolvedAssets = dedupeResolvedAssets(
        drafts
          .map((draft) => draft.resolvedAsset)
          .filter((asset): asset is ResolvedAsset => asset !== null),
      );

      return {
        data: {
          drafts,
          validation: {
            totalRows: drafts.length,
            validRows,
            errorRows: drafts.length - validRows,
          },
          availableAccounts,
          resolvedAssets,
        },
      };
    },
  };
}

function createImportCsvTool(options: {
  accountService: Pick<AccountService, "getActiveAccounts">;
  activityService: Pick<Required<ActivityService>, "parseCsv"> &
    Partial<Pick<Required<ActivityService>, "getImportMapping">>;
  baseCurrency?: string | (() => string | undefined);
}): AiChatToolDefinition {
  return {
    name: "import_csv",
    description:
      'REQUIRED for CSV file imports. When a user attaches a CSV file or provides CSV content, you MUST call this tool. Pass the complete CSV text to csvContent. The tool returns a mapping (column->field, value normalization, symbol translations, parse config); the app then parses/validates the file and shows the user an inline review grid in the chat. You do NOT need to parse or validate the data yourself.\n\nIMPORTANT: csvContent must contain the COMPLETE CSV text every time this tool is called. CSV data from previous tool calls is NOT retained. If the user wants to re-import or change settings, ask them to re-attach the CSV file - do not call this tool with empty or partial content.\n\nWhen CSV symbol values look like company NAMES rather than tickers, populate `symbolMappings` with name->ticker pairs using your knowledge of public companies. Examples: {"Cloudflare": "NET", "Apple Inc": "AAPL", "Tesla Inc.": "TSLA"}. For values you are unsure about, leave them out - the user will resolve them in the chat review step.\n\nFor `parseConfig` fields (delimiter, skipTopRows, skipBottomRows, dateFormat, decimalSeparator, thousandsSeparator, defaultCurrency): detect non-defaults from the sample rows. European brokers often use `;` delimiter, `,` decimal, `.` thousands, and DD/MM/YYYY dates. Many broker exports have a multi-line preamble before the real header row - pass skipTopRows to skip it. Totals/disclaimer lines at the end need skipBottomRows.',
    parameters: {
      type: "object",
      properties: {
        csvContent: {
          type: "string",
          description: "Raw CSV content to parse. Include the full CSV text including headers.",
        },
        accountId: {
          type: ["string", "null"],
          description:
            "Account UUID to assign to all imported activities. If the user mentions an account by name (e.g. 'Joint', 'RRSP'), call get_accounts first to resolve the name to an ID. Pass null only if the user didn't specify an account.",
        },
        fieldMappings: {
          type: ["object", "null"],
          description:
            "Maps field names to CSV header names. Keys: date, activityType, symbol, quantity, unitPrice, amount, fee, fxRate, subtype, currency, account, comment.",
          additionalProperties: { type: "string" },
        },
        activityMappings: {
          type: ["object", "null"],
          description:
            'Maps canonical activity types (BUY, SELL, DIVIDEND, INTEREST, DEPOSIT, WITHDRAWAL, TRANSFER_IN, TRANSFER_OUT, SPLIT, FEE, TAX) to CSV values. Common English verbs (Buy/Bought/Purchase, Sell/Sold, Dividend/Div, etc.) are already covered by defaults - you only need to add non-English or broker-specific terms. E.g., {"BUY": ["Achat", "Kopen"], "DIVIDEND": ["Dividende"]}. Pass null if all CSV values are covered by defaults.',
          additionalProperties: {
            type: "array",
            items: { type: "string" },
          },
        },
        symbolMappings: {
          type: ["object", "null"],
          description:
            'Maps CSV symbol values (tickers OR company names) to canonical tickers. Use your knowledge of public companies to translate names: {"Cloudflare": "NET", "Apple Inc": "AAPL"}.',
          additionalProperties: { type: "string" },
        },
        accountMappings: {
          type: ["object", "null"],
          description:
            "Maps CSV account values to app account IDs. Pass null if using accountId or no mapping needed.",
          additionalProperties: { type: "string" },
        },
        delimiter: {
          type: ["string", "null"],
          description: 'CSV delimiter: ",", ";", "\\t". Pass null for auto-detection.',
        },
        skipTopRows: {
          type: ["integer", "null"],
          description:
            "Number of NON-HEADER rows to skip at the top (preamble/disclaimer lines BEFORE the column header row). Do NOT count the header row itself - only count text like account names, date ranges, disclaimers that appear before the row with column headers. Example: if rows 1-3 are preamble and row 4 is 'Date,Symbol,Qty,...', pass 3 (not 4). Pass null or 0 if the header is the first row.",
        },
        skipBottomRows: {
          type: ["integer", "null"],
          description:
            "Number of rows to skip at the bottom (totals/disclaimer footer rows). Pass null or 0 if no rows to skip.",
        },
        dateFormat: {
          type: ["string", "null"],
          description:
            'Date format hint using strftime: "%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y". Pass null for auto-detection.',
        },
        decimalSeparator: {
          type: ["string", "null"],
          description: 'Decimal separator: ".", ",". Pass null for auto-detection.',
        },
        thousandsSeparator: {
          type: ["string", "null"],
          description: 'Thousands separator: ",", ".", " ", "none". Pass null for auto-detection.',
        },
        defaultCurrency: {
          type: ["string", "null"],
          description:
            'Default currency when rows do not specify one (e.g., "EUR" for European broker statements).',
        },
      },
      required: ["csvContent"],
      additionalProperties: false,
    },
    execute: async (rawArgs) => {
      const args = parseImportCsvArgs(rawArgs);
      if (args.csvContent.trim() === "") {
        throw new Error(
          "No CSV content provided. The user needs to attach the CSV file again - file content from previous messages is not available in follow-up turns.",
        );
      }

      const accounts = options.accountService.getActiveAccounts();
      const availableAccounts = recordActivityAccountOptions(accounts);
      const accountId = validImportAccountId(args.accountId, accounts);
      const llmParseConfig = importCsvParseConfig(args, resolveBaseCurrency(options.baseCurrency));
      let usedSavedProfile = false;
      let mapping: ImportMappingData | undefined;

      if (
        accountId &&
        !hasUsableImportCsvMappings(args) &&
        options.activityService.getImportMapping
      ) {
        const savedMapping = await Promise.resolve(
          options.activityService.getImportMapping(accountId, ACTIVITY_IMPORT_CONTEXT_KIND),
        );
        if (savedMapping) {
          mapping = savedMapping;
          usedSavedProfile = true;
        }
      }

      const effectiveParseConfig = mapping?.parseConfig ?? llmParseConfig;
      const parsed = parseImportCsvResult(
        await Promise.resolve(
          options.activityService.parseCsv({
            content: CSV_TEXT_ENCODER.encode(args.csvContent),
            config: effectiveParseConfig,
          }),
        ),
      );
      const appliedMapping = sanitizeImportMappingAccounts(
        mapping ??
          buildImportCsvMapping(args, accountId, parsed.headers, effectiveParseConfig, accounts),
        accounts,
      );

      return {
        data: {
          appliedMapping,
          parseConfig: effectiveParseConfig,
          accountId,
          detectedHeaders: parsed.headers,
          sampleRows: parsed.rows.slice(0, MAX_IMPORT_CSV_SAMPLE_ROWS),
          totalRows: parsed.rowCount ?? parsed.rows.length,
          mappingConfidence: usedSavedProfile
            ? "HIGH"
            : estimateImportCsvMappingConfidence(appliedMapping),
          availableAccounts,
          usedSavedProfile,
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

function createGetHealthStatusTool(
  healthService: Pick<Required<HealthService>, "getCachedHealthStatus">,
): AiChatToolDefinition {
  return {
    name: "get_health_status",
    description:
      "Read the cached portfolio health status produced by the Health Center. `overallSeverity` is one of INFO | WARNING | ERROR | CRITICAL, or NOT_COMPUTED when no check has run yet in this session (in that case `issues` is empty and `note` tells the user how to populate it). Each issue has `severity` (same scale), `category` (PRICE_STALENESS | FX_INTEGRITY | CLASSIFICATION | DATA_CONSISTENCY | ACCOUNT_CONFIGURATION | SETTINGS_CONFIGURATION), `title`, `message`, `affectedCount`, optional `affectedMvPct` (share of portfolio market value impacted, as a fraction 0.0-1.0), and optional `details`. `isStale` is true when the cache is older than 5 minutes. Use this to diagnose data problems (missing prices, stale FX rates, negative balances, unclassified assets) and guide the user to fixes in the Health Center.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    execute: () => {
      const status = healthService.getCachedHealthStatus();
      if (!status) {
        return {
          data: {
            overallSeverity: "NOT_COMPUTED",
            issues: [],
            isStale: false,
            note: "No health check has run yet in this session. Ask the user to open the Health Center to run a check.",
          },
        };
      }

      return {
        data: healthStatusToolDto(status),
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

function createGetPerformanceTool(options: {
  calculatePerformanceHistory: Required<PortfolioMetricsService>["calculatePerformanceHistory"];
  baseCurrency?: string | (() => string | undefined);
  now?: () => Date;
}): AiChatToolDefinition {
  return {
    name: "get_performance",
    description:
      "Get portfolio performance metrics including TWR, MWR, volatility, and max drawdown. Use account_id='TOTAL' for aggregate performance across all accounts.",
    parameters: {
      type: "object",
      properties: {
        accountId: {
          type: "string",
          description: "Account ID to get performance for, or 'TOTAL' for all accounts",
          default: "TOTAL",
        },
        period: {
          type: "string",
          description: "Time period for performance calculation",
          enum: ["1M", "3M", "6M", "YTD", "1Y", "ALL"],
          default: "YTD",
        },
      },
      required: [],
    },
    execute: async (rawArgs) => {
      const args = parsePerformanceArgs(rawArgs);
      const period = args.period.toUpperCase();
      const endDate = currentUtcDateString(options.now);
      const metrics = (await Promise.resolve(
        options.calculatePerformanceHistory({
          itemType: "account",
          itemId: args.accountId,
          startDate: performancePeriodStartDate(period, endDate),
          endDate,
        }),
      )) as PerformanceMetrics;

      return {
        data: {
          id: metrics.id,
          ...(metrics.periodStartDate !== null ? { periodStartDate: metrics.periodStartDate } : {}),
          ...(metrics.periodEndDate !== null ? { periodEndDate: metrics.periodEndDate } : {}),
          currency:
            metrics.currency === "" ? resolveBaseCurrency(options.baseCurrency) : metrics.currency,
          ...(metrics.cumulativeTwr !== null ? { cumulativeTwr: metrics.cumulativeTwr } : {}),
          ...(metrics.gainLossAmount !== null ? { gainLossAmount: metrics.gainLossAmount } : {}),
          ...(metrics.annualizedTwr !== null ? { annualizedTwr: metrics.annualizedTwr } : {}),
          simpleReturn: metrics.simpleReturn,
          annualizedSimpleReturn: metrics.annualizedSimpleReturn,
          ...(metrics.cumulativeMwr !== null ? { cumulativeMwr: metrics.cumulativeMwr } : {}),
          ...(metrics.annualizedMwr !== null ? { annualizedMwr: metrics.annualizedMwr } : {}),
          volatility: metrics.volatility,
          maxDrawdown: metrics.maxDrawdown,
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

async function buildRecordActivityOutput(
  args: RecordActivityArgs,
  accounts: Account[],
  options: {
    marketDataService?: PortfolioAiMarketDataService;
    baseCurrency?: string | (() => string | undefined);
  },
): Promise<RecordActivityOutputData> {
  const availableAccounts = recordActivityAccountOptions(accounts);
  const [accountId, accountName] = resolveRecordActivityAccount(args.account, accounts);
  const accountCurrency =
    accountId !== undefined
      ? (accounts.find((account) => account.id === accountId)?.currency ??
        resolveBaseCurrency(options.baseCurrency))
      : resolveBaseCurrency(options.baseCurrency);
  const activityType = normalizeActivityType(args.activityType);
  const resolved = await resolveRecordActivityAsset({
    symbol: args.symbol,
    currency: accountCurrency,
    marketDataService: options.marketDataService,
  });
  const amount = computeRecordActivityAmount(args);
  const draftCurrency = resolved.resolvedAsset?.currency ?? accountCurrency;
  const draft: ActivityDraft = {
    activityType,
    activityDate: args.activityDate,
    symbol: args.symbol ?? null,
    assetId: resolved.assetId ?? null,
    assetName: resolved.assetName ?? null,
    quantity: args.quantity ?? null,
    unitPrice: args.unitPrice ?? null,
    amount,
    fee: args.fee ?? null,
    currency: draftCurrency,
    accountId: accountId ?? null,
    accountName: accountName ?? null,
    subtype: args.subtype ?? null,
    notes: args.notes ?? null,
    priceSource: args.unitPrice !== undefined ? "user" : "none",
    pricingMode: "MARKET",
    isCustomAsset: resolved.isCustomAsset,
    assetKind: null,
  };

  return {
    draft,
    validation: validateRecordActivityDraft(draft),
    availableAccounts,
    resolvedAsset: resolved.resolvedAsset ?? null,
    availableSubtypes: subtypesForActivityType(activityType),
  };
}

function recordActivityAccountOptions(accounts: Account[]): AccountOption[] {
  return accounts.map((account) => ({
    id: account.id,
    name: account.name,
    currency: account.currency,
  }));
}

function parseRecordActivityArgs(args: unknown): RecordActivityArgs {
  if (!isRecord(args)) {
    return { activityType: "", activityDate: "" };
  }
  return {
    activityType: readOptionalString(args.activityType) ?? "",
    symbol: readOptionalString(args.symbol),
    activityDate: readOptionalString(args.activityDate) ?? "",
    quantity: readOptionalFiniteNumber(args.quantity),
    unitPrice: readOptionalFiniteNumber(args.unitPrice),
    amount: readOptionalFiniteNumber(args.amount),
    fee: readOptionalFiniteNumber(args.fee),
    account: readOptionalString(args.account),
    subtype: readOptionalString(args.subtype),
    notes: readOptionalString(args.notes),
  };
}

function parseRecordActivitiesArgs(args: unknown): RecordActivityArgs[] {
  if (!isRecord(args) || !Array.isArray(args.activities)) {
    return [];
  }
  return args.activities.map(parseRecordActivityArgs);
}

function recordActivityRowErrors(validation: RecordActivityOutputData["validation"]): string[] {
  return [
    ...validation.missingFields.map((field) => `Missing required field: ${field}`),
    ...validation.errors.map((error) => `${error.field}: ${error.message}`),
  ];
}

function fallbackRecordActivityDraft(baseCurrency: string): ActivityDraft {
  return {
    activityType: "UNKNOWN",
    activityDate: "",
    symbol: null,
    assetId: null,
    assetName: null,
    quantity: null,
    unitPrice: null,
    amount: null,
    fee: null,
    currency: baseCurrency,
    accountId: null,
    accountName: null,
    subtype: null,
    notes: null,
    priceSource: "none",
    pricingMode: "MARKET",
    isCustomAsset: false,
    assetKind: null,
  };
}

function dedupeResolvedAssets(assets: ResolvedAsset[]): ResolvedAsset[] {
  const seenAssetIds = new Set<string>();
  return assets.filter((asset) => {
    if (seenAssetIds.has(asset.assetId)) {
      return false;
    }
    seenAssetIds.add(asset.assetId);
    return true;
  });
}

function parseImportCsvArgs(args: unknown): ImportCsvArgs {
  if (!isRecord(args)) {
    return { csvContent: "" };
  }
  return {
    csvContent: readOptionalString(args.csvContent) ?? readOptionalString(args.csv_content) ?? "",
    accountId: readOptionalString(args.accountId) ?? readOptionalString(args.account_id),
    fieldMappings: readStringMap(args.fieldMappings ?? args.field_mappings),
    activityMappings: readStringArrayMap(args.activityMappings ?? args.activity_mappings),
    symbolMappings: readStringMap(args.symbolMappings ?? args.symbol_mappings),
    accountMappings: readStringMap(args.accountMappings ?? args.account_mappings),
    delimiter: readOptionalString(args.delimiter),
    skipTopRows: readOptionalNonNegativeInteger(
      args.skipTopRows ?? args.skip_top_rows,
      "skipTopRows",
    ),
    skipBottomRows: readOptionalNonNegativeInteger(
      args.skipBottomRows ?? args.skip_bottom_rows,
      "skipBottomRows",
    ),
    dateFormat: readOptionalString(args.dateFormat ?? args.date_format),
    decimalSeparator: readOptionalString(args.decimalSeparator ?? args.decimal_separator),
    thousandsSeparator: readOptionalString(args.thousandsSeparator ?? args.thousands_separator),
    defaultCurrency: readOptionalString(args.defaultCurrency ?? args.default_currency),
  };
}

function importCsvParseConfig(args: ImportCsvArgs, baseCurrency: string): ImportCsvParseConfig {
  return {
    delimiter: args.delimiter,
    skipTopRows: args.skipTopRows,
    skipBottomRows: args.skipBottomRows,
    dateFormat: args.dateFormat ?? null,
    decimalSeparator: args.decimalSeparator ?? null,
    thousandsSeparator: args.thousandsSeparator ?? null,
    defaultCurrency: args.defaultCurrency ?? baseCurrency,
  };
}

function buildImportCsvMapping(
  args: ImportCsvArgs,
  accountId: string | null,
  headers: string[],
  parseConfig: ImportCsvParseConfig,
  accounts: Account[],
): ImportMappingData {
  const fieldMappings =
    args.fieldMappings && Object.keys(args.fieldMappings).length > 0
      ? args.fieldMappings
      : autoDetectImportCsvFieldMappings(headers);
  return {
    accountId: accountId ?? "",
    contextKind: "CSV_ACTIVITY",
    name: "",
    fieldMappings,
    activityMappings: mergeImportCsvActivityMappings(args.activityMappings),
    symbolMappings: cleanStringMap(args.symbolMappings),
    accountMappings: cleanImportCsvAccountMappings(args.accountMappings, accounts),
    symbolMappingMeta: {},
    parseConfig,
  };
}

function parseImportCsvResult(value: unknown): ParsedImportCsv {
  if (!isRecord(value)) {
    throw new Error("CSV parse error: parseCsv returned an invalid response");
  }
  const headers = stringArray(value.headers);
  const rows = stringMatrix(value.rows);
  const rowCount =
    typeof value.rowCount === "number" && Number.isFinite(value.rowCount)
      ? value.rowCount
      : undefined;
  return { headers, rows, rowCount };
}

function validImportAccountId(value: string | undefined, accounts: Account[]): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return accounts.some((account) => account.id === trimmed) ? trimmed : null;
}

function sanitizeImportMappingAccounts(
  mapping: ImportMappingData,
  accounts: Account[],
): ImportMappingData {
  return {
    ...mapping,
    accountId: validImportAccountId(mapping.accountId, accounts) ?? "",
    accountMappings: cleanImportCsvAccountMappings(mapping.accountMappings, accounts),
  };
}

function cleanImportCsvAccountMappings(
  mappings: Record<string, string> | undefined,
  accounts: Account[],
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(cleanStringMap(mappings))
      .map(([key, value]) => [key, validImportAccountId(value, accounts)] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== null),
  );
}

function hasUsableImportCsvMappings(args: ImportCsvArgs): boolean {
  return (
    hasUsableStringMap(args.fieldMappings) ||
    hasUsableActivityMappings(args.activityMappings) ||
    hasUsableStringMap(args.symbolMappings) ||
    hasUsableStringMap(args.accountMappings)
  );
}

function hasUsableStringMap(map: Record<string, string> | undefined): boolean {
  return Object.values(map ?? {}).some((value) => value.trim() !== "");
}

function hasUsableActivityMappings(map: Record<string, string[]> | undefined): boolean {
  return Object.values(map ?? {}).some((values) => values.some((value) => value.trim() !== ""));
}

function autoDetectImportCsvFieldMappings(headers: string[]): Record<string, FieldMappingValue> {
  const mappings: Record<string, FieldMappingValue> = {};
  const usedHeaders = new Set<string>();
  const fieldPatterns: Array<[string, string[]]> = [
    [
      IMPORT_FIELD_DATE,
      [
        "date",
        "trade date",
        "activity date",
        "transaction date",
        "settlement date",
        "trade_date",
        "activity_date",
        "transaction_date",
        "time",
        "datetime",
      ],
    ],
    [
      IMPORT_FIELD_ACTIVITY_TYPE,
      [
        "type",
        "activity type",
        "transaction type",
        "action",
        "activity",
        "activity_type",
        "transaction_type",
        "trans type",
        "operation",
      ],
    ],
    [
      IMPORT_FIELD_SYMBOL,
      [
        "symbol",
        "ticker",
        "stock",
        "security",
        "asset",
        "instrument",
        "ticker symbol",
        "stock symbol",
        "isin",
        "cusip",
      ],
    ],
    [
      IMPORT_FIELD_QUANTITY,
      ["quantity", "qty", "shares", "units", "no of shares", "number of shares", "volume"],
    ],
    [
      IMPORT_FIELD_UNIT_PRICE,
      [
        "price",
        "unit price",
        "share price",
        "cost per share",
        "avg price",
        "unit_price",
        "share_price",
        "execution price",
        "trade price",
      ],
    ],
    [
      IMPORT_FIELD_AMOUNT,
      [
        "total",
        "amount",
        "value",
        "net amount",
        "gross amount",
        "market value",
        "total amount",
        "total value",
        "proceeds",
        "cost",
        "net value",
      ],
    ],
    [IMPORT_FIELD_CURRENCY, ["currency", "ccy", "currency code", "curr", "trade currency"]],
    [
      IMPORT_FIELD_FEE,
      [
        "fee",
        "fees",
        "commission",
        "commissions",
        "trading fee",
        "transaction fee",
        "brokerage",
        "charges",
      ],
    ],
    [
      IMPORT_FIELD_ACCOUNT,
      ["account", "account id", "account name", "portfolio", "account number"],
    ],
    [
      IMPORT_FIELD_COMMENT,
      ["comment", "comments", "note", "notes", "description", "memo", "remarks"],
    ],
    [
      IMPORT_FIELD_FX_RATE,
      [
        "fx rate",
        "fxrate",
        "fx_rate",
        "exchange rate",
        "exchangerate",
        "exchange_rate",
        "forex rate",
        "conversion rate",
      ],
    ],
    [IMPORT_FIELD_SUBTYPE, ["subtype", "sub type", "sub_type", "variation", "subcategory"]],
  ];

  for (const [field, patterns] of fieldPatterns) {
    const matchedHeader = headers.find((header) => {
      if (usedHeaders.has(header)) {
        return false;
      }
      const lowerHeader = header.toLowerCase();
      return patterns.some((pattern) => lowerHeader === pattern || lowerHeader.includes(pattern));
    });
    if (matchedHeader) {
      mappings[field] = matchedHeader;
      usedHeaders.add(matchedHeader);
    }
  }
  return mappings;
}

function defaultImportCsvActivityMappings(): Record<string, string[]> {
  return {
    BUY: ["BUY", "BOUGHT", "PURCHASE", "B", "LONG", "MARKET BUY", "LIMIT BUY"],
    SELL: ["SELL", "SOLD", "S", "SHORT", "MARKET SELL", "LIMIT SELL"],
    DIVIDEND: ["DIVIDEND", "DIV", "CASH DIVIDEND", "QUALIFIED DIVIDEND"],
    INTEREST: ["INTEREST", "INT", "INTEREST EARNED", "CASH INTEREST"],
    DEPOSIT: ["DEPOSIT", "DEP", "CASH DEPOSIT", "WIRE IN", "ACH IN", "FUNDING", "WIRE TRANSFER IN"],
    WITHDRAWAL: ["WITHDRAWAL", "WITHDRAW", "CASH WITHDRAWAL", "WIRE OUT", "ACH OUT"],
    TRANSFER_IN: ["TRANSFER IN", "TRANSFER_IN", "JOURNAL IN", "ACAT IN"],
    TRANSFER_OUT: ["TRANSFER OUT", "TRANSFER_OUT", "JOURNAL OUT", "ACAT OUT"],
    SPLIT: ["SPLIT", "STOCK SPLIT", "FORWARD SPLIT", "REVERSE SPLIT"],
    FEE: ["FEE", "FEES", "SERVICE FEE", "MANAGEMENT FEE"],
    TAX: ["TAX", "TAXES", "WITHHOLDING", "TAX WITHHELD"],
  };
}

function mergeImportCsvActivityMappings(
  llmMappings: Record<string, string[]> | undefined,
): Record<string, string[]> {
  const merged = defaultImportCsvActivityMappings();
  for (const [canonical, values] of Object.entries(llmMappings ?? {})) {
    const entry = (merged[canonical] ??= []);
    for (const value of values) {
      const trimmed = value.trim();
      if (!trimmed) {
        continue;
      }
      if (!entry.some((existing) => existing.toUpperCase() === trimmed.toUpperCase())) {
        entry.push(trimmed);
      }
    }
  }
  return merged;
}

function estimateImportCsvMappingConfidence(mapping: ImportMappingData): "HIGH" | "MEDIUM" | "LOW" {
  const has = (field: string) => Object.hasOwn(mapping.fieldMappings, field);
  const count = [
    has(IMPORT_FIELD_DATE),
    has(IMPORT_FIELD_ACTIVITY_TYPE),
    has(IMPORT_FIELD_SYMBOL),
    has(IMPORT_FIELD_QUANTITY) || has(IMPORT_FIELD_AMOUNT) || has(IMPORT_FIELD_UNIT_PRICE),
  ].filter(Boolean).length;
  return count === 4 ? "HIGH" : count >= 2 ? "MEDIUM" : "LOW";
}

function cleanStringMap(map: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(map ?? {}).filter((entry): entry is [string, string] => entry[1].trim() !== ""),
  );
}

function resolveRecordActivityAccount(
  accountHint: string | undefined,
  accounts: Account[],
): [string | undefined, string | undefined] {
  const hint = accountHint?.trim();
  if (!hint) {
    return accounts.length === 1 ? [accounts[0].id, accounts[0].name] : [undefined, undefined];
  }

  const exactIdMatch = accounts.find((account) => account.id === hint);
  if (exactIdMatch) {
    return [exactIdMatch.id, exactIdMatch.name];
  }

  const lowerHint = hint.toLowerCase();
  const exactNameMatch = accounts.find((account) => account.name.toLowerCase() === lowerHint);
  if (exactNameMatch) {
    return [exactNameMatch.id, exactNameMatch.name];
  }

  const partialNameMatches = accounts.filter((account) =>
    account.name.toLowerCase().includes(lowerHint),
  );
  return partialNameMatches.length === 1
    ? [partialNameMatches[0].id, partialNameMatches[0].name]
    : [undefined, undefined];
}

async function resolveRecordActivityAsset(options: {
  symbol: string | undefined;
  currency: string;
  marketDataService?: PortfolioAiMarketDataService;
}): Promise<{
  resolvedAsset?: ResolvedAsset;
  assetId?: string;
  assetName?: string;
  isCustomAsset: boolean;
}> {
  if (!options.symbol) {
    return { isCustomAsset: false };
  }

  const results = await Promise.resolve(
    options.marketDataService?.searchSymbol?.(options.symbol) ?? [],
  ).catch(() => []);
  const result = firstRecordActivitySymbolResult(results as SymbolSearchResult[], options.currency);
  if (!result) {
    return {
      assetName: options.symbol,
      isCustomAsset: true,
    };
  }

  const asset: ResolvedAsset = {
    assetId: result.existingAssetId ?? `${result.symbol}:${result.exchangeMic ?? "UNKNOWN"}`,
    symbol: result.symbol,
    name: symbolSearchDisplayName(result),
    currency: result.currency ?? options.currency,
    exchange: result.exchangeName ?? null,
    exchangeMic: result.exchangeMic ?? null,
    instrumentType: result.quoteType.trim() === "" ? null : result.quoteType,
  };

  return {
    resolvedAsset: asset,
    assetId: asset.assetId,
    assetName: asset.name,
    isCustomAsset: false,
  };
}

function symbolSearchDisplayName(result: SymbolSearchResult): string {
  return result.longName.trim() || result.shortName.trim() || result.symbol;
}

function firstRecordActivitySymbolResult(
  results: SymbolSearchResult[],
  accountCurrency: string,
): SymbolSearchResult | undefined {
  const normalizedCurrency = accountCurrency.toUpperCase();
  return [...results].sort((left, right) => {
    if (left.isExisting !== right.isExisting) {
      return left.isExisting ? -1 : 1;
    }
    const leftCurrencyMatch = left.currency?.toUpperCase() === normalizedCurrency ? 1 : 0;
    const rightCurrencyMatch = right.currency?.toUpperCase() === normalizedCurrency ? 1 : 0;
    if (leftCurrencyMatch !== rightCurrencyMatch) {
      return rightCurrencyMatch - leftCurrencyMatch;
    }
    return right.score - left.score;
  })[0];
}

function normalizeActivityType(activityType: string): ActivityType {
  const upper = activityType.toUpperCase();
  return isSupportedActivityType(upper) ? upper : "UNKNOWN";
}

function isSupportedActivityType(activityType: string): activityType is ActivityType {
  return ACTIVITY_TYPES.includes(activityType as ActivityType);
}

function computeRecordActivityAmount(
  args: Pick<RecordActivityArgs, "amount" | "fee" | "quantity" | "unitPrice">,
): number | null {
  if (args.amount !== undefined) {
    return args.amount;
  }
  if (args.quantity === undefined || args.unitPrice === undefined) {
    return null;
  }
  return args.quantity * args.unitPrice + (args.fee ?? 0);
}

function validateRecordActivityDraft(draft: ActivityDraft) {
  const missingFields: string[] = [];
  const errors: Array<{ field: string; message: string }> = [];
  const activityType = draft.activityType.toUpperCase();
  const subtype = draft.subtype?.toUpperCase();
  const isDividendAssetIncome =
    activityType === "DIVIDEND" &&
    (subtype === ACTIVITY_SUBTYPE_DRIP || subtype === ACTIVITY_SUBTYPE_DIVIDEND_IN_KIND);
  const isStakingReward =
    activityType === "INTEREST" && subtype === ACTIVITY_SUBTYPE_STAKING_REWARD;

  if (draft.accountId === null) {
    missingFields.push("account_id");
  }

  switch (activityType) {
    case "BUY":
    case "SELL":
      if (draft.symbol === null && draft.assetId === null) {
        missingFields.push("symbol");
      }
      if (draft.quantity === null) {
        missingFields.push("quantity");
      }
      if (draft.unitPrice === null && draft.amount === null) {
        missingFields.push("unit_price");
      }
      break;
    case "DEPOSIT":
    case "WITHDRAWAL":
    case "TAX":
    case "FEE":
    case "CREDIT":
      if (draft.amount === null) {
        missingFields.push("amount");
      }
      break;
    case "DIVIDEND":
      if (draft.symbol === null && draft.assetId === null) {
        missingFields.push("symbol");
      }
      if (isDividendAssetIncome && draft.quantity === null) {
        missingFields.push("quantity");
      }
      if (isDividendAssetIncome && draft.amount === null && draft.unitPrice === null) {
        missingFields.push("unit_price");
      }
      if (!isDividendAssetIncome && draft.amount === null) {
        missingFields.push("amount");
      }
      break;
    case "INTEREST":
      if (isStakingReward) {
        if (draft.symbol === null && draft.assetId === null) {
          missingFields.push("symbol");
        }
        if (draft.quantity === null) {
          missingFields.push("quantity");
        }
        if (draft.amount === null && draft.unitPrice === null) {
          missingFields.push("unit_price");
        }
      } else if (draft.amount === null) {
        missingFields.push("amount");
      }
      break;
    case "SPLIT":
      if (draft.symbol === null && draft.assetId === null) {
        missingFields.push("symbol");
      }
      if (draft.quantity === null) {
        missingFields.push("quantity");
      }
      break;
    case "TRANSFER_IN":
    case "TRANSFER_OUT":
      if (draft.amount === null && draft.symbol === null) {
        missingFields.push("amount");
      }
      break;
  }

  if (!isRecordActivityDate(draft.activityDate)) {
    errors.push({
      field: "activity_date",
      message: "Invalid date format. Expected YYYY-MM-DD or ISO 8601",
    });
  }

  if (draft.isCustomAsset && draft.assetKind === null) {
    missingFields.push("asset_kind");
  }

  return {
    isValid: missingFields.length === 0 && errors.length === 0,
    missingFields,
    errors,
  };
}

function subtypesForActivityType(activityType: string): Array<{ value: string; label: string }> {
  switch (activityType.toUpperCase()) {
    case "DIVIDEND":
      return [
        { value: ACTIVITY_SUBTYPE_DRIP, label: "Dividend Reinvested (DRIP)" },
        { value: ACTIVITY_SUBTYPE_DIVIDEND_IN_KIND, label: "Dividend in Kind" },
      ];
    case "INTEREST":
      return [{ value: ACTIVITY_SUBTYPE_STAKING_REWARD, label: "Staking Reward" }];
    case "CREDIT":
      return [{ value: ACTIVITY_SUBTYPE_BONUS, label: "Bonus" }];
    default:
      return [];
  }
}

function isRecordActivityDate(value: string): boolean {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  if (!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return false;
  }
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

function recordActivityDateContext(
  now: (() => Date) | undefined,
  timezoneInput: string | (() => string | undefined) | undefined,
): { currentDate: string; currentWeekday: string; timezone: string } {
  const timezone = resolveTimezone(timezoneInput);
  const date = now?.() ?? new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    currentDate: `${parts.year}-${parts.month}-${parts.day}`,
    currentWeekday: parts.weekday,
    timezone,
  };
}

function resolveTimezone(timezoneInput: string | (() => string | undefined) | undefined): string {
  const timezone = typeof timezoneInput === "function" ? timezoneInput() : (timezoneInput ?? "UTC");
  const candidate = (timezone ?? "UTC").trim() || "UTC";
  try {
    Intl.DateTimeFormat(undefined, { timeZone: candidate }).format();
    return candidate;
  } catch {
    return "UTC";
  }
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

function parsePerformanceArgs(args: unknown): { accountId: string; period: string } {
  if (!isRecord(args)) {
    return { accountId: "TOTAL", period: "YTD" };
  }
  return {
    accountId: typeof args.accountId === "string" && args.accountId ? args.accountId : "TOTAL",
    period: typeof args.period === "string" && args.period ? args.period : "YTD",
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

function healthStatusToolDto(status: HealthStatus) {
  return {
    overallSeverity: status.overallSeverity,
    issues: status.issues.map((issue) => ({
      id: issue.id,
      severity: issue.severity,
      category: issue.category,
      title: issue.title,
      message: issue.message,
      affectedCount: issue.affectedCount,
      ...(issue.affectedMvPct !== undefined ? { affectedMvPct: issue.affectedMvPct } : {}),
      ...(issue.details !== undefined ? { details: issue.details } : {}),
    })),
    isStale: status.isStale,
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

function performancePeriodStartDate(period: string, endDate: string): string | undefined {
  switch (period) {
    case "1M":
      return addUtcDays(endDate, -30);
    case "3M":
      return addUtcDays(endDate, -90);
    case "6M":
      return addUtcDays(endDate, -180);
    case "YTD":
      return `${endDate.slice(0, 4)}-01-01`;
    case "1Y":
      return addUtcDays(endDate, -365);
    default:
      return undefined;
  }
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

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readOptionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readOptionalNonNegativeInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value;
}

function readStringMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function readStringArrayMap(value: unknown): Record<string, string[]> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string[]] => Array.isArray(entry[1]))
      .map(([key, values]) => [
        key,
        values.filter((item): item is string => typeof item === "string"),
      ]),
  );
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function stringMatrix(value: unknown): string[][] {
  return Array.isArray(value) ? value.map(stringArray) : [];
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
