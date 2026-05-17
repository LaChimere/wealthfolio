import type { AccountService } from "./accounts";
import type { AiChatToolDefinition } from "./ai-chat";

const MAX_ACCOUNTS = 50;

export interface PortfolioAiChatToolsOptions {
  accountService: Pick<AccountService, "getActiveAccounts">;
}

export function createPortfolioAiChatTools(
  options: PortfolioAiChatToolsOptions,
): AiChatToolDefinition[] {
  return [createGetAccountsTool(options.accountService)];
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
