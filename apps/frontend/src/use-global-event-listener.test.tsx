import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import useGlobalEventListener from "./use-global-event-listener";

const mocks = vi.hoisted(() => {
  const listenerNames = [
    "listenPortfolioUpdateStart",
    "listenPortfolioUpdateComplete",
    "listenPortfolioUpdateError",
    "listenMarketSyncStart",
    "listenMarketSyncComplete",
    "listenMarketSyncError",
    "listenDatabaseRestored",
    "listenBrokerSyncStart",
    "listenBrokerSyncComplete",
    "listenBrokerSyncError",
  ] as const;
  const unlisteners = Object.fromEntries(listenerNames.map((name) => [name, vi.fn()])) as Record<
    (typeof listenerNames)[number],
    ReturnType<typeof vi.fn>
  >;
  return {
    brokerSyncStartHandler: undefined as ((event: unknown) => void) | undefined,
    brokerSyncCompleteHandler: undefined as ((event: unknown) => void) | undefined,
    listenerNames,
    unlisteners,
    updatePortfolio: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn(),
    logger: { debug: vi.fn(), error: vi.fn() },
    toast: {
      loading: vi.fn(),
      dismiss: vi.fn(),
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    },
  };
});

vi.mock("@/adapters", () => {
  const listeners = Object.fromEntries(
    mocks.listenerNames.map((name) => [
      name,
      vi.fn((handler?: (event: unknown) => void) => {
        if (name === "listenBrokerSyncStart") {
          mocks.brokerSyncStartHandler = handler;
        }
        if (name === "listenBrokerSyncComplete") {
          mocks.brokerSyncCompleteHandler = handler;
        }
        return Promise.resolve(mocks.unlisteners[name]);
      }),
    ]),
  );
  return {
    isDesktop: false,
    logger: mocks.logger,
    updatePortfolio: mocks.updatePortfolio,
    ...listeners,
  };
});

vi.mock("@/context/portfolio-sync-context", () => ({
  usePortfolioSyncOptional: () => undefined,
}));

vi.mock("@/hooks/use-platform", () => ({
  useIsMobileViewport: () => false,
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("sonner", () => ({
  toast: mocks.toast,
}));

afterEach(() => {
  mocks.brokerSyncStartHandler = undefined;
  mocks.brokerSyncCompleteHandler = undefined;
  mocks.updatePortfolio.mockClear();
  mocks.navigate.mockClear();
  mocks.logger.debug.mockClear();
  mocks.logger.error.mockClear();
  for (const unlisten of Object.values(mocks.unlisteners)) {
    unlisten.mockClear();
  }
  for (const toastMock of Object.values(mocks.toast)) {
    toastMock.mockClear();
  }
  vi.clearAllMocks();
});

describe("useGlobalEventListener", () => {
  it("shows and cleans up broker sync start events", async () => {
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { unmount } = renderHook(() => useGlobalEventListener(), { wrapper });
    await waitFor(() => expect(mocks.brokerSyncStartHandler).toBeDefined());

    act(() => {
      mocks.brokerSyncStartHandler?.({
        event: "broker:sync-start",
        id: 1,
        payload: null,
      });
    });

    expect(mocks.toast.loading).toHaveBeenCalledWith("Syncing broker data...", {
      id: "broker-sync-start",
    });

    unmount();
    expect(mocks.unlisteners.listenBrokerSyncStart).toHaveBeenCalledOnce();
  });

  it("opens the new-account setup modal from broker sync completion toasts", async () => {
    const dispatchEvent = vi.spyOn(window, "dispatchEvent");
    const queryClient = new QueryClient();
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }

    renderHook(() => useGlobalEventListener(), { wrapper: Wrapper });
    await waitFor(() => expect(mocks.brokerSyncCompleteHandler).toBeDefined());

    const newAccounts = [
      {
        localAccountId: "account-1",
        providerAccountId: "provider-account-1",
        defaultName: "Broker Account",
        currency: "USD",
      },
    ];
    act(() => {
      mocks.brokerSyncCompleteHandler?.({
        event: "broker:sync-complete",
        id: 2,
        payload: {
          success: true,
          message: "Sync completed.",
          newAccounts,
        },
      });
    });

    expect(mocks.toast.info).toHaveBeenCalledWith(
      "New accounts found",
      expect.objectContaining({
        description: "1 new account(s) need to be configured",
        action: expect.objectContaining({ label: "Review" }),
      }),
    );
    const toastOptions = mocks.toast.info.mock.calls[0]?.[1] as {
      action: { onClick: () => void };
    };
    toastOptions.action.onClick();
    const dispatched = dispatchEvent.mock.calls.at(-1)?.[0] as CustomEvent<typeof newAccounts>;
    expect(dispatched.type).toBe("open-new-accounts-modal");
    expect(dispatched.detail).toEqual(newAccounts);
  });
});
