export const PARITY_SMOKE_COMMANDS = ["get_settings", "get_accounts"] as const;

export type ParitySmokeCommand = (typeof PARITY_SMOKE_COMMANDS)[number];

export interface AddonHostCanaryContract {
  id: string;
  requiredCommands: readonly string[];
  requiredEvents: readonly string[];
}

export const ADDON_HOST_CANARY_CONTRACT: AddonHostCanaryContract = {
  id: "backend-contract-addon-host-canary",
  requiredCommands: [
    "get_accounts",
    "create_account",
    "get_holdings",
    "get_settings",
    "list_installed_addons",
  ],
  requiredEvents: ["portfolio:updated", "market-sync:completed"],
};
