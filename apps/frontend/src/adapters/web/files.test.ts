import { afterEach, describe, expect, it } from "vitest";

import { openAddonPackageDialog, openCsvFileDialog } from "./files";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("web files adapter", () => {
  it("reads selected CSV files and cleans up the hidden input", async () => {
    const selection = openCsvFileDialog();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(["date,amount\n2026-01-01,10"], "import.csv", { type: "text/csv" });

    expect(input?.accept).toBe(".csv,text/csv");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input?.dispatchEvent(new Event("change"));

    await expect(selection).resolves.toBe("date,amount\n2026-01-01,10");
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("rejects non-CSV file selections", async () => {
    const selection = openCsvFileDialog();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });

    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input?.dispatchEvent(new Event("change"));

    await expect(selection).rejects.toThrow("Please select a .csv file.");
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
});
