import { describe, expect, test } from "bun:test";
import type { BrowserWindow, MessageBoxOptions } from "electron";

import {
  buildApplicationMenuTemplate,
  handleCheckForUpdates,
  installApplicationMenu,
  type ApplicationMenuDeps,
} from "./menu";

interface TestMenuItem {
  id?: string;
  label?: string;
  submenu?: TestMenuItem[];
  click?: (item: unknown, window?: BrowserWindow) => void | Promise<void>;
}

function createDeps(overrides: Partial<ApplicationMenuDeps> = {}) {
  const messages: Array<{ eventName: string; payload: unknown; target?: BrowserWindow | null }> =
    [];
  const dialogs: MessageBoxOptions[] = [];
  const targetWindow = {} as BrowserWindow;
  let installedMenu: unknown;
  let latestTemplate: unknown[] = [];

  const deps: ApplicationMenuDeps = {
    appName: "Wealthfolio",
    appVersion: "3.4.0",
    menu: {
      buildFromTemplate(template) {
        latestTemplate = [...template];
        return { template } as unknown as ReturnType<
          ApplicationMenuDeps["menu"]["buildFromTemplate"]
        >;
      },
      setApplicationMenu(menu) {
        installedMenu = menu;
      },
    },
    getTargetWindow() {
      return targetWindow;
    },
    async showMessageBox(options) {
      dialogs.push(options);
    },
    async checkForUpdates() {
      return null;
    },
    sendRendererEvent(eventName, payload, target) {
      messages.push({ eventName, payload, target });
    },
    ...overrides,
  };

  return {
    deps,
    dialogs,
    installedMenu: () => installedMenu,
    latestTemplate: () => latestTemplate,
    messages,
    targetWindow,
  };
}

function findMenuItem(template: TestMenuItem[], id: string): TestMenuItem | undefined {
  for (const item of template) {
    if (item.id === id) {
      return item;
    }
    if (item.submenu) {
      const found = findMenuItem(item.submenu, id);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

function requireMenuItem(template: TestMenuItem[], id: string): TestMenuItem {
  const item = findMenuItem(template, id);
  if (!item) {
    throw new Error(`Menu item not found: ${id}`);
  }
  return item;
}

describe("Electron application menu", () => {
  test("sends route navigation events from the settings menu item", () => {
    const { deps, messages, targetWindow } = createDeps();
    const template = buildApplicationMenuTemplate(deps) as TestMenuItem[];
    const settingsItem = requireMenuItem(template, "open_settings");

    settingsItem.click?.(settingsItem, targetWindow);

    expect(messages).toEqual([
      {
        eventName: "navigate-to-route",
        payload: { route: "/settings/general" },
        target: targetWindow,
      },
    ]);
  });

  test("emits update information to the renderer when an update is available", async () => {
    const updateInfo = { latestVersion: "3.5.0" };
    const { deps, dialogs, messages } = createDeps({
      async checkForUpdates() {
        return updateInfo;
      },
    });

    await handleCheckForUpdates(deps);

    expect(dialogs).toEqual([]);
    expect(messages).toEqual([
      { eventName: "app:update-available", payload: updateInfo, target: undefined },
    ]);
  });

  test("shows native dialogs for no-update and update-check error states", async () => {
    const noUpdate = createDeps();
    await handleCheckForUpdates(noUpdate.deps);
    expect(noUpdate.dialogs[0]).toMatchObject({
      title: "No Updates Available",
      type: "info",
    });

    const failed = createDeps({
      async checkForUpdates() {
        throw new Error("network unavailable");
      },
    });
    await handleCheckForUpdates(failed.deps);
    expect(failed.dialogs[0]).toMatchObject({
      title: "Update Check Failed",
      type: "error",
      message: "Failed to check for updates: network unavailable",
    });
  });

  test("installs the built application menu", () => {
    const state = createDeps();

    installApplicationMenu(state.deps);

    expect(state.latestTemplate()).not.toEqual([]);
    expect(state.installedMenu()).toEqual({ template: state.latestTemplate() });
  });
});
