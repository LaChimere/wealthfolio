import { afterEach, describe, expect, it, vi } from "vitest";

import { notifyUnauthorized } from "@/lib/auth-token";
import { exportDataFile } from "./exports";

vi.mock("@/lib/auth-token", () => ({
  notifyUnauthorized: vi.fn(),
}));

const notifyUnauthorizedMock = vi.mocked(notifyUnauthorized);

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("web exports adapter", () => {
  it("downloads exported content using backend filenames", async () => {
    let clickedDownload = "";
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clickedDownload = this.download;
    });
    const createObjectUrl = vi.fn().mockReturnValue("blob:export");
    const revokeObjectUrl = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: createObjectUrl,
      revokeObjectURL: revokeObjectUrl,
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ id: "activity-1" }]), {
        status: 200,
        headers: {
          "content-disposition": 'attachment; filename="activities_2026-06-20.json"',
          "content-type": "application/json; charset=utf-8",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(exportDataFile("JSON", "activities")).resolves.toEqual({
      status: "saved",
      filename: "activities_2026-06-20.json",
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/utilities/export/activities/json", {
      method: "GET",
      credentials: "same-origin",
    });
    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledOnce();
    expect(clickedDownload).toBe("activities_2026-06-20.json");
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:export");
    expect(document.querySelector("a")).toBeNull();
  });

  it("returns empty without downloading when the backend has no export content", async () => {
    const createObjectUrl = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL: createObjectUrl });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(exportDataFile("CSV", "accounts")).resolves.toEqual({ status: "empty" });
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it("uses fallback filenames when backend export responses omit Content-Disposition", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-21T12:00:00.000Z"));
    let clickedDownload = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clickedDownload = this.download;
    });
    const createObjectUrl = vi.fn().mockReturnValue("blob:export");
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: createObjectUrl,
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([123, 125]))));

    await expect(exportDataFile("JSON", "goals")).resolves.toEqual({
      status: "saved",
      filename: "goals_2026-06-21.json",
    });
    expect(clickedDownload).toBe("goals_2026-06-21.json");
  });

  it("notifies on unauthorized export responses and surfaces backend errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ message: "Unauthorized" }, { status: 401, statusText: "Unauthorized" }),
        ),
    );

    await expect(exportDataFile("CSV", "accounts")).rejects.toThrow("Unauthorized");
    expect(notifyUnauthorizedMock).toHaveBeenCalledOnce();
  });
});
