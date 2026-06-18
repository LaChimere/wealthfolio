import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryKeys } from "@/lib/query-keys";
import { useActivityImportMutations } from "./use-activity-import-mutations";

const adapterMocks = vi.hoisted(() => ({
  importActivities: vi.fn(),
  logger: { error: vi.fn() },
}));

vi.mock("@/adapters", () => adapterMocks);
vi.mock("@wealthfolio/ui/components/ui/use-toast", () => ({
  toast: vi.fn(),
}));

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useActivityImportMutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adapterMocks.importActivities.mockResolvedValue({
      activities: [],
      summary: {
        success: true,
        imported: 0,
        skipped: 0,
        duplicates: 0,
      },
      importRunId: "import-run-1",
    });
  });

  it("invalidates portfolio and holdings queries after importing activities", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 5 * 60 * 1000 },
        mutations: { retry: false },
      },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useActivityImportMutations(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.confirmImportMutation.mutateAsync({ activities: [] });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [QueryKeys.ACTIVITIES] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [QueryKeys.IMPORT_RUNS] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [QueryKeys.HOLDINGS] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [QueryKeys.PORTFOLIO_SUMMARY] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [QueryKeys.SNAPSHOTS] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [QueryKeys.NET_WORTH] });
  });
});
