import { describe, expect, test } from "bun:test";
import path from "node:path";

import {
  createSanitizedDeepLinkDescription,
  findDeepLinkUrls,
  getProtocolClientRegistration,
  isDeepLinkUrl,
} from "./deep-links";

describe("Electron deep-link helpers", () => {
  test("accepts only Wealthfolio custom protocol URLs", () => {
    expect(isDeepLinkUrl("wealthfolio://auth/callback?code=abc")).toBe(true);
    expect(isDeepLinkUrl("Wealthfolio://auth/callback?code=abc")).toBe(true);
    expect(isDeepLinkUrl("wealthfolio:/auth/callback?code=abc")).toBe(false);
    expect(isDeepLinkUrl("wealthfolio:auth/callback?code=abc")).toBe(false);
    expect(isDeepLinkUrl("wealthfoliox://auth/callback?code=abc")).toBe(false);
    expect(isDeepLinkUrl("https://wealthfolio.app/auth/callback")).toBe(false);
  });

  test("finds deep links in process argv without treating executable path as a URL", () => {
    expect(
      findDeepLinkUrls([
        "wealthfolio://auth/callback?ignored=exec",
        "--",
        "--flag",
        "wealthfolio://auth/callback?code=abc",
        "https://wealthfolio.app",
        "Wealthfolio://auth/callback?error=denied",
      ]),
    ).toEqual(["wealthfolio://auth/callback?code=abc", "Wealthfolio://auth/callback?error=denied"]);
  });

  test("sanitizes deep-link descriptions before logging", () => {
    expect(createSanitizedDeepLinkDescription("wealthfolio://auth/callback?code=secret")).toBe(
      "wealthfolio://auth/callback",
    );
  });

  test("uses documented protocol-client arguments in supported dev modes", () => {
    expect(getProtocolClientRegistration(false, "darwin", ["/App"], "/Electron.app")).toEqual({});
    expect(
      getProtocolClientRegistration(true, "darwin", ["/electron", "./main.js"], "/electron"),
    ).toBeNull();
    expect(
      getProtocolClientRegistration(true, "win32", ["/electron", "./main.js"], "/electron"),
    ).toEqual({
      executablePath: "/electron",
      args: [path.resolve("./main.js")],
    });
    expect(getProtocolClientRegistration(true, "linux", ["/electron"], "/electron")).toBeNull();
  });
});
