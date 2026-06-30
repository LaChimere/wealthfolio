import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FixAction, HealthStatus } from "@/lib/types";
import { useExecuteHealthFix } from "./use-health";

const mocks = vi.hoisted(() => ({
  dismissHealthIssue: vi.fn(),
  executeHealthFix: vi.fn(),
  getHealthConfig: vi.fn(),
  getHealthStatus: vi.fn(),
  restoreHealthIssue: vi.fn(),
  runHealthChecks: vi.fn(),
  updateHealthConfig: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/adapters", () => ({
  dismissHealthIssue: mocks.dismissHealthIssue,
  executeHealthFix: mocks.executeHealthFix,
  getHealthConfig: mocks.getHealthConfig,
  getHealthStatus: mocks.getHealthStatus,
  restoreHealthIssue: mocks.restoreHealthIssue,
  runHealthChecks: mocks.runHealthChecks,
  updateHealthConfig: mocks.updateHealthConfig,
}));

vi.mock("@wealthfolio/ui/components/ui/use-toast", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

const healthyStatus: HealthStatus = {
  overallSeverity: "INFO",
  issueCounts: {},
  issues: [],
  checkedAt: "2026-06-30T05:00:00Z",
  isStale: false,
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

async function executeFix(action: FixAction): Promise<void> {
  const { result } = renderHook(() => useExecuteHealthFix(), { wrapper: createWrapper() });

  await act(async () => {
    await result.current.mutateAsync(action);
  });
}

describe("useExecuteHealthFix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.executeHealthFix.mockResolvedValue(undefined);
    mocks.runHealthChecks.mockResolvedValue(healthyStatus);
  });

  it.each(["sync_prices", "retry_sync", "fetch_fx"])(
    "does not show duplicate success toast for sync health fix %s",
    async (actionId) => {
      await executeFix({ id: actionId, label: "Sync", payload: {} });

      expect(mocks.executeHealthFix).toHaveBeenCalledWith({
        id: actionId,
        label: "Sync",
        payload: {},
      });
      expect(mocks.runHealthChecks).toHaveBeenCalled();
      expect(mocks.toastSuccess).not.toHaveBeenCalled();
    },
  );

  it("keeps success toast for non-sync health fixes", async () => {
    await executeFix({ id: "migrate_legacy_classifications", label: "Migrate", payload: {} });

    expect(mocks.toastSuccess).toHaveBeenCalledWith("Fix applied successfully");
  });
});
