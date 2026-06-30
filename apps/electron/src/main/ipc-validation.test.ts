import { describe, expect, test } from "bun:test";

import { validateElectronInvokeRequest } from "./ipc-validation";

describe("Electron IPC validation", () => {
  test("accepts allowlisted commands with object payloads", () => {
    expect(
      validateElectronInvokeRequest({
        command: "get_accounts",
        payload: { includeArchived: true },
      }),
    ).toEqual({
      command: "get_accounts",
      payload: { includeArchived: true },
    });
  });

  test("rejects unknown commands before they reach the sidecar", () => {
    expect(() =>
      validateElectronInvokeRequest({
        command: "delete_everything",
      }),
    ).toThrow("Electron command bridge is not connected yet: delete_everything");
  });

  test("rejects invalid request shapes", () => {
    expect(() => validateElectronInvokeRequest(null)).toThrow("Invalid Electron command request.");
    expect(() => validateElectronInvokeRequest({})).toThrow("Invalid Electron command request.");
  });

  test("rejects invalid payload shapes", () => {
    expect(() =>
      validateElectronInvokeRequest({
        command: "get_accounts",
        payload: null,
      }),
    ).toThrow("Invalid Electron command payload.");

    expect(() =>
      validateElectronInvokeRequest({
        command: "get_accounts",
        payload: [],
      }),
    ).toThrow("Invalid Electron command payload.");
  });
});
