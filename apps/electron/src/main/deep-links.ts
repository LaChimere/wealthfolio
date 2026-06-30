import path from "node:path";

export const DEEP_LINK_SCHEME = "wealthfolio";
const DEEP_LINK_PREFIX = `${DEEP_LINK_SCHEME}://`;

export interface ProtocolClientRegistration {
  args?: string[];
  executablePath?: string;
}

export function isDeepLinkUrl(value: string): boolean {
  if (!value.toLowerCase().startsWith(DEEP_LINK_PREFIX)) {
    return false;
  }

  try {
    return new URL(value).protocol.toLowerCase() === `${DEEP_LINK_SCHEME}:`;
  } catch {
    return false;
  }
}

export function findDeepLinkUrls(argv: readonly string[]): string[] {
  return argv.slice(1).filter((value) => value !== "--" && isDeepLinkUrl(value));
}

export function createSanitizedDeepLinkDescription(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return `${DEEP_LINK_SCHEME}://<invalid>`;
  }
}

export function getProtocolClientRegistration(
  defaultApp: boolean,
  platform: NodeJS.Platform,
  argv: readonly string[],
  executablePath: string,
): ProtocolClientRegistration | null {
  if (!defaultApp) {
    return {};
  }

  if (platform === "darwin") {
    return null;
  }

  const appPath = argv[1];
  if (!appPath) {
    return null;
  }

  return {
    args: [path.resolve(appPath)],
    executablePath,
  };
}
