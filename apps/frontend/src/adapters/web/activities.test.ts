import { afterEach, describe, expect, it, vi } from "vitest";

import { notifyUnauthorized } from "@/lib/auth-token";
import { parseCsv } from "./activities";

vi.mock("@/lib/auth-token", () => ({
  notifyUnauthorized: vi.fn(),
}));

const notifyUnauthorizedMock = vi.mocked(notifyUnauthorized);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("web activities adapter", () => {
  it("parses CSV files with multipart form data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        headers: ["Date", "Amount"],
        rows: [{ Date: "2026-06-21", Amount: "42" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["Date,Amount\n2026-06-21,42"], "import.csv", { type: "text/csv" });
    const config = { delimiter: ",", mappings: { date: "Date", amount: "Amount" } };

    await expect(parseCsv(file, config)).resolves.toEqual({
      headers: ["Date", "Amount"],
      rows: [{ Date: "2026-06-21", Amount: "42" }],
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/activities/import/parse", {
      method: "POST",
      body: expect.any(FormData),
      credentials: "same-origin",
    });
    const formData = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(formData.get("file")).toBe(file);
    expect(formData.get("config")).toBe(JSON.stringify(config));
  });

  it("surfaces backend parse errors from JSON or text responses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ message: "bad mapping" }, { status: 400 }))
      .mockResolvedValueOnce(
        new Response("plain parse failure", {
          status: 422,
          headers: { "content-type": "text/plain" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["bad"], "bad.csv", { type: "text/csv" });
    const config = { delimiter: ",", mappings: {} };

    await expect(parseCsv(file, config)).rejects.toThrow("Failed to parse CSV: bad mapping");
    await expect(parseCsv(file, config)).rejects.toThrow(
      "Failed to parse CSV: plain parse failure",
    );
  });

  it("notifies on unauthorized parse responses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ message: "Unauthorized" }, { status: 401, statusText: "Unauthorized" }),
        ),
    );
    const file = new File(["bad"], "bad.csv", { type: "text/csv" });
    const config = { delimiter: ",", mappings: {} };

    await expect(parseCsv(file, config)).rejects.toThrow("Failed to parse CSV: Unauthorized");
    expect(notifyUnauthorizedMock).toHaveBeenCalledOnce();
  });
});
