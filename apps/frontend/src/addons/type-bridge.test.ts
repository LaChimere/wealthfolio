import { vi, describe, it, expect } from "vitest";
import {
  buildAllowedAddonPermissionPaths,
  createAddonPermissionGuard,
  createSDKHostAPIBridge,
  type InternalHostAPI,
  type RuntimeAddonPermission,
} from "./type-bridge";

const goalProgressManifest = {
  id: "goal-progress-tracker",
  permissions: [
    declaredPermission("accounts", ["getAll"]),
    declaredPermission("portfolio", ["getLatestValuations"]),
    declaredPermission("goals", ["getAll", "getFunding"]),
  ],
};

const investmentFeesManifest = {
  id: "investment-fees-tracker",
  permissions: [
    declaredPermission("exchangeRates", ["getAll"]),
    declaredPermission("settings", ["get"]),
  ],
};

function declaredPermission(category: string, functions: string[]): RuntimeAddonPermission {
  return {
    category,
    purpose: "test",
    functions: functions.map((name) => ({
      name,
      isDeclared: true,
      isDetected: false,
    })),
  };
}

describe("Addon Type Bridge", () => {
  describe("createSDKHostAPIBridge", () => {
    it("should create logger with addon prefix", () => {
      // Mock the internal API logger functions
      const mockLogError = vi.fn();
      const mockLogInfo = vi.fn();
      const mockLogWarn = vi.fn();
      const mockLogTrace = vi.fn();
      const mockLogDebug = vi.fn();

      // Create a minimal mock internal API with just the logger functions
      const mockInternalAPI: Partial<InternalHostAPI> = {
        logError: mockLogError,
        logInfo: mockLogInfo,
        logWarn: mockLogWarn,
        logTrace: mockLogTrace,
        logDebug: mockLogDebug,
      };

      // Create the SDK bridge with a test addon ID
      const sdkAPI = createSDKHostAPIBridge(mockInternalAPI as InternalHostAPI, "test-addon");

      // Test that logger methods add the addon prefix
      sdkAPI.logger.error("test error message");
      sdkAPI.logger.info("test info message");
      sdkAPI.logger.warn("test warning message");
      sdkAPI.logger.trace("test trace message");
      sdkAPI.logger.debug("test debug message");

      // Verify the logger functions were called with prefixed messages
      expect(mockLogError).toHaveBeenCalledWith("[test-addon] test error message");
      expect(mockLogInfo).toHaveBeenCalledWith("[test-addon] test info message");
      expect(mockLogWarn).toHaveBeenCalledWith("[test-addon] test warning message");
      expect(mockLogTrace).toHaveBeenCalledWith("[test-addon] test trace message");
      expect(mockLogDebug).toHaveBeenCalledWith("[test-addon] test debug message");
    });

    it("should use default addon ID when none provided", () => {
      const mockLogInfo = vi.fn();

      const mockInternalAPI: Partial<InternalHostAPI> = {
        logInfo: mockLogInfo,
      };

      // Create the SDK bridge without addon ID
      const sdkAPI = createSDKHostAPIBridge(mockInternalAPI as InternalHostAPI);

      sdkAPI.logger.info("test message");

      // Should use default addon ID
      expect(mockLogInfo).toHaveBeenCalledWith("[unknown-addon] test message");
    });

    it("should handle empty addon ID", () => {
      const mockLogInfo = vi.fn();

      const mockInternalAPI: Partial<InternalHostAPI> = {
        logInfo: mockLogInfo,
      };

      // Create the SDK bridge with empty addon ID
      const sdkAPI = createSDKHostAPIBridge(mockInternalAPI as InternalHostAPI, "");

      sdkAPI.logger.info("test message");

      // Should fallback to default addon ID for empty string
      expect(mockLogInfo).toHaveBeenCalledWith("[unknown-addon] test message");
    });

    it("keeps bundled manifest permissions compatible with SDK API function names", async () => {
      const getAccounts = vi.fn().mockResolvedValue([]);
      const getLatestValuations = vi.fn().mockResolvedValue([]);
      const getGoals = vi.fn().mockResolvedValue([]);
      const getGoalFunding = vi.fn().mockResolvedValue([]);

      const sdkAPI = createSDKHostAPIBridge(
        {
          getAccounts,
          getLatestValuations,
          getGoals,
          getGoalFunding,
        } as Partial<InternalHostAPI> as InternalHostAPI,
        goalProgressManifest.id,
        createAddonPermissionGuard({
          addonId: goalProgressManifest.id,
          permissions: goalProgressManifest.permissions as RuntimeAddonPermission[],
        }),
      );

      await expect(sdkAPI.accounts.getAll()).resolves.toEqual([]);
      await expect(sdkAPI.portfolio.getLatestValuations([])).resolves.toEqual([]);
      await expect(sdkAPI.goals.getAll()).resolves.toEqual([]);
      await expect(sdkAPI.goals.getFunding("goal-id")).resolves.toEqual([]);

      expect(getAccounts).toHaveBeenCalledOnce();
      expect(getLatestValuations).toHaveBeenCalledWith([]);
      expect(getGoals).toHaveBeenCalledOnce();
      expect(getGoalFunding).toHaveBeenCalledWith("goal-id");
    });

    it("supports exchangeRates category declarations from bundled manifests", async () => {
      const getExchangeRates = vi.fn().mockResolvedValue([]);
      const getSettings = vi.fn().mockResolvedValue({});

      const sdkAPI = createSDKHostAPIBridge(
        {
          getExchangeRates,
          getSettings,
        } as Partial<InternalHostAPI> as InternalHostAPI,
        investmentFeesManifest.id,
        createAddonPermissionGuard({
          addonId: investmentFeesManifest.id,
          permissions: investmentFeesManifest.permissions as RuntimeAddonPermission[],
        }),
      );

      await expect(sdkAPI.exchangeRates.getAll()).resolves.toEqual([]);
      await expect(sdkAPI.settings.get()).resolves.toEqual({});

      expect(getExchangeRates).toHaveBeenCalledOnce();
      expect(getSettings).toHaveBeenCalledOnce();
    });

    it("blocks undeclared SDK API calls without invoking the host adapter", () => {
      const getAccounts = vi.fn().mockResolvedValue([]);
      const createActivity = vi.fn();
      const warn = vi.fn();

      const sdkAPI = createSDKHostAPIBridge(
        {
          getAccounts,
          createActivity,
        } as Partial<InternalHostAPI> as InternalHostAPI,
        "secure-addon",
        createAddonPermissionGuard({
          addonId: "secure-addon",
          permissions: [declaredPermission("accounts", ["getAll"])],
          onDenied: warn,
        }),
      );

      expect(() =>
        sdkAPI.activities.create({} as Parameters<typeof sdkAPI.activities.create>[0]),
      ).toThrow("Addon secure-addon is not permitted to call api.activities.create");
      expect(createActivity).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        "Addon secure-addon is not permitted to call api.activities.create",
      );
    });

    it("maps UI and secrets permissions to context and scoped secret calls", () => {
      const guard = createAddonPermissionGuard({
        addonId: "ui-addon",
        permissions: [
          declaredPermission("ui", ["sidebar.addItem"]),
          declaredPermission("secrets", ["get"]),
        ],
      });

      expect(() => guard.assertAllowed("context.sidebar.addItem")).not.toThrow();
      expect(() => guard.assertAllowed("api.secrets.get")).not.toThrow();
      expect(() => guard.assertAllowed("context.router.add")).toThrow(
        "Addon ui-addon is not permitted to call context.router.add",
      );
      expect(() => guard.assertAllowed("api.secrets.set")).toThrow(
        "Addon ui-addon is not permitted to call api.secrets.set",
      );
    });

    it("ignores permission functions that were neither declared nor detected", () => {
      const allowedPaths = buildAllowedAddonPermissionPaths([
        {
          category: "activities",
          purpose: "test",
          functions: [
            { name: "create", isDeclared: false, isDetected: false },
            { name: "search", isDeclared: false, isDetected: true },
          ],
        },
      ]);

      expect(allowedPaths.has("api.activities.create")).toBe(false);
      expect(allowedPaths.has("api.activities.search")).toBe(true);
    });
  });
});
