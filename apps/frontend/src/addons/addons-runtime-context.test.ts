import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAddonContext,
  getDynamicNavItems,
  getDynamicRoutes,
  setAddonHostQueryClient,
  triggerAllDisableCallbacks,
} from "./addons-runtime-context";
import type { RuntimeAddonPermission } from "./type-bridge";

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

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  warnSpy.mockRestore();
  triggerAllDisableCallbacks();
  setAddonHostQueryClient(undefined);
  if (typeof window !== "undefined") {
    delete (window as unknown as { __wealthfolio_query_client__?: unknown })
      .__wealthfolio_query_client__;
  }
});

describe("addon runtime context permissions", () => {
  it("guards sidebar and router registration with ui permissions", () => {
    const context = createAddonContext("ui-addon", [declaredPermission("ui", ["sidebar.addItem"])]);

    expect(() =>
      context.sidebar.addItem({
        id: "allowed",
        label: "Allowed",
      }),
    ).not.toThrow();
    expect(getDynamicNavItems()).toHaveLength(1);

    expect(() =>
      context.router.add({
        path: "/blocked",
        component: React.lazy(async () => ({ default: () => null })),
      }),
    ).toThrow("Addon ui-addon is not permitted to call context.router.add");
    expect(getDynamicRoutes()).toHaveLength(0);
  });

  it("rejects external add-on navigation routes", () => {
    const context = createAddonContext("ui-addon", [
      declaredPermission("ui", ["sidebar.addItem", "router.add"]),
    ]);

    expect(() =>
      context.sidebar.addItem({
        id: "external",
        label: "External",
        route: "https://example.test",
      }),
    ).toThrow("Addon ui-addon must provide an internal app route for context.sidebar.addItem");
    expect(getDynamicNavItems()).toHaveLength(0);

    expect(() =>
      context.router.add({
        path: "//example.test",
        component: React.lazy(async () => ({ default: () => null })),
      }),
    ).toThrow("Addon ui-addon must provide an internal app route for context.router.add");
    expect(getDynamicRoutes()).toHaveLength(0);

    expect(() =>
      context.router.add({
        path: "/addons/safe",
        component: React.lazy(async () => ({ default: () => null })),
      }),
    ).not.toThrow();
    expect(getDynamicRoutes()).toEqual([{ path: "/addons/safe", component: expect.any(Object) }]);
  });

  it("blocks scoped secrets without a secrets permission", async () => {
    const context = createAddonContext("secret-addon", []);

    await expect(context.api.secrets.get("token")).rejects.toThrow(
      "Addon secret-addon is not permitted to call api.secrets.get",
    );
  });

  it("keeps legacy or dev contexts unrestricted when no permissions are available", () => {
    const context = createAddonContext("legacy-addon");

    expect(() =>
      context.sidebar.addItem({
        id: "legacy",
        label: "Legacy",
      }),
    ).not.toThrow();
    expect(getDynamicNavItems()).toHaveLength(1);
  });

  it("exposes only a limited query client facade to add-ons", () => {
    const invalidateQueries = vi.fn();
    const refetchQueries = vi.fn();
    const clear = vi.fn();
    setAddonHostQueryClient({
      invalidateQueries,
      refetchQueries,
    });
    const context = createAddonContext("query-addon");

    const queryClient = context.api.query.getClient() as {
      invalidateQueries(queryKey: string | string[]): unknown;
      refetchQueries(queryKey: string | string[]): unknown;
      clear?: unknown;
    };
    queryClient.invalidateQueries("accounts");
    queryClient.refetchQueries(["holdings"]);

    expect(queryClient.clear).toBeUndefined();
    expect(
      typeof window === "undefined"
        ? undefined
        : (window as unknown as { __wealthfolio_query_client__?: unknown })
            .__wealthfolio_query_client__,
    ).toBeUndefined();
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["accounts"], exact: false });
    expect(refetchQueries).toHaveBeenCalledWith({ queryKey: ["holdings"], exact: false });
    expect(clear).not.toHaveBeenCalled();
  });

  it("blocks query cache access for restricted add-ons without query permission", () => {
    const invalidateQueries = vi.fn();
    const refetchQueries = vi.fn();
    setAddonHostQueryClient({
      invalidateQueries,
      refetchQueries,
    });

    const blocked = createAddonContext("restricted-query-addon", []);
    expect(() => blocked.api.query.getClient()).toThrow(
      "Addon restricted-query-addon is not permitted to call api.query.getClient",
    );
    expect(() => blocked.api.query.invalidateQueries("accounts")).toThrow(
      "Addon restricted-query-addon is not permitted to call api.query.invalidateQueries",
    );
    expect(invalidateQueries).not.toHaveBeenCalled();

    const allowed = createAddonContext("allowed-query-addon", [
      declaredPermission("query", ["getClient", "invalidateQueries"]),
    ]);
    const queryClient = allowed.api.query.getClient();
    expect(queryClient).toMatchObject({
      invalidateQueries: expect.any(Function),
      refetchQueries: expect.any(Function),
    });
    queryClient?.invalidateQueries("accounts");
    allowed.api.query.invalidateQueries("accounts");
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["accounts"], exact: false });
    expect(() => allowed.api.query.refetchQueries("holdings")).toThrow(
      "Addon allowed-query-addon is not permitted to call api.query.refetchQueries",
    );
    expect(() => queryClient?.refetchQueries("holdings")).toThrow(
      "Addon allowed-query-addon is not permitted to call api.query.refetchQueries",
    );
    expect(refetchQueries).not.toHaveBeenCalled();
  });
});
