import { afterEach, describe, expect, it } from "vitest";

import { openAddonPackageDialog } from "./files";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("web files adapter", () => {
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
});
