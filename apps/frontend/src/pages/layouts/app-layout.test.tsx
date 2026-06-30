import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AppLayout } from "./app-layout";
import { useSettings } from "@/hooks/use-settings";

vi.mock("@/components/app-launcher", () => ({ default: () => null }));
vi.mock("@/components/mobile-loading-indicator", () => ({ MobileLoadingIndicator: () => null }));
vi.mock("@/components/sonner", () => ({ Toaster: () => null }));
vi.mock("@/components/update-dialog", () => ({ UpdateDialog: () => null }));
vi.mock("@/context/portfolio-sync-context", () => ({
  PortfolioSyncProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/features/devices-sync/hooks/use-active-app-sync-trigger", () => ({
  useActiveAppSyncTrigger: vi.fn(),
}));
vi.mock("@/hooks/use-navigation-event-listener", () => ({ default: vi.fn() }));
vi.mock("@/hooks/use-platform", () => ({
  useIsMobileViewport: () => false,
  usePlatform: () => ({ isDesktop: true, isMobile: false }),
}));
vi.mock("@/hooks/use-settings", () => ({ useSettings: vi.fn() }));
vi.mock("@/pages/layouts/navigation/app-navigation", () => ({ useNavigation: () => ({}) }));
vi.mock("@/pages/layouts/navigation/navigation-mode-context", () => ({
  NavigationModeProvider: ({ children }: { children: ReactNode }) => children,
  useNavigationMode: () => ({ isFocusMode: false, isLaunchBar: false }),
}));
vi.mock("@/use-global-event-listener", () => ({ default: vi.fn() }));

describe("AppLayout", () => {
  it("shows a retryable error state when settings fail to load", () => {
    const refetch = vi.fn();
    vi.mocked(useSettings).mockReturnValue({
      data: undefined,
      error: new Error("settings endpoint failed"),
      isError: true,
      isFetching: false,
      isSuccess: false,
      refetch,
    } as unknown as ReturnType<typeof useSettings>);

    render(
      <MemoryRouter>
        <AppLayout />
      </MemoryRouter>,
    );

    expect(screen.getByText("Unable to load settings")).toBeInTheDocument();
    expect(screen.getByText("settings endpoint failed")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledOnce();
  });
});
