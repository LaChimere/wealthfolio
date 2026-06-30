import { afterEach, describe, expect, it, vi } from "vitest";

import { openAddonPackageDialog, openCsvFileDialog, openFileSaveDialog } from "./files";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("web files adapter", () => {
  it("does not return fake CSV paths in web mode", async () => {
    await expect(openCsvFileDialog()).rejects.toThrow(
      "CSV file path selection is only supported in the desktop app",
    );
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("cleans up the hidden addon package input when selection is cancelled", async () => {
    const selection = openAddonPackageDialog();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');

    expect(input).not.toBeNull();
    input?.dispatchEvent(new Event("cancel"));

    await expect(selection).resolves.toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("falls back to window focus when the cancel event is not emitted", async () => {
    const selection = openAddonPackageDialog();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');

    expect(input).not.toBeNull();
    window.dispatchEvent(new Event("focus"));

    await expect(selection).resolves.toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("downloads files through a temporary anchor", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const createObjectUrl = vi.fn().mockReturnValue("blob:export");
    const revokeObjectUrl = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: createObjectUrl,
      revokeObjectURL: revokeObjectUrl,
    });

    await expect(openFileSaveDialog("hello", "export.txt")).resolves.toBe(true);

    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:export");
    expect(document.querySelector("a")).toBeNull();
  });

  it("surfaces browser download failures", async () => {
    const error = new Error("object URL unavailable");
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => {
        throw error;
      }),
      revokeObjectURL: vi.fn(),
    });

    await expect(openFileSaveDialog("hello", "export.txt")).rejects.toBe(error);
  });
});
