import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAddonContext,
  getDynamicNavItems,
  getDynamicRoutes,
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
  delete (window as unknown as { __wealthfolio_query_client__?: unknown })
    .__wealthfolio_query_client__;
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
    (window as unknown as { __wealthfolio_query_client__?: unknown }).__wealthfolio_query_client__ =
      {
        invalidateQueries,
        refetchQueries,
        clear,
      };
    const context = createAddonContext("query-addon");

    const queryClient = context.api.query.getClient() as {
      invalidateQueries(queryKey: string | string[]): unknown;
      refetchQueries(queryKey: string | string[]): unknown;
      clear?: unknown;
    };
    queryClient.invalidateQueries("accounts");
    queryClient.refetchQueries(["holdings"]);

    expect(queryClient.clear).toBeUndefined();
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["accounts"], exact: false });
    expect(refetchQueries).toHaveBeenCalledWith({ queryKey: ["holdings"], exact: false });
    expect(clear).not.toHaveBeenCalled();
  });
});
