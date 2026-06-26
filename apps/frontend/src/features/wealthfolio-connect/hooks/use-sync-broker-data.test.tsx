import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSyncBrokerData } from "./use-sync-broker-data";

const mocks = vi.hoisted(() => ({
  syncBrokerData: vi.fn(),
  toast: {
    loading: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../services/broker-service", () => ({
  syncBrokerData: mocks.syncBrokerData,
}));

vi.mock("@wealthfolio/ui/components/ui/use-toast", () => ({
  toast: mocks.toast,
}));

afterEach(() => {
  mocks.syncBrokerData.mockReset();
  mocks.toast.loading.mockClear();
  mocks.toast.error.mockClear();
});

describe("useSyncBrokerData", () => {
  it("relies on broker sync events for loading toasts after sync starts", async () => {
    mocks.syncBrokerData.mockResolvedValue(undefined);
    const { result } = renderHook(() => useSyncBrokerData(), { wrapper: createWrapper() });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.toast.loading).not.toHaveBeenCalled();
  });

  it("surfaces sync start failures", async () => {
    mocks.syncBrokerData.mockRejectedValue(new Error("forbidden"));
    const { result } = renderHook(() => useSyncBrokerData(), { wrapper: createWrapper() });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Failed to start sync: forbidden"),
    );
  });
});

function createWrapper() {
  const queryClient = new QueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}
