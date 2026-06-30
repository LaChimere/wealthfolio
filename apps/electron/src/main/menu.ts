import type { BrowserWindow, MenuItemConstructorOptions, MessageBoxOptions } from "electron";

type MenuModule = Pick<typeof import("electron").Menu, "buildFromTemplate" | "setApplicationMenu">;

export interface ApplicationMenuDeps {
  appName: string;
  appVersion: string;
  menu: MenuModule;
  getTargetWindow(): BrowserWindow | null;
  showMessageBox(options: MessageBoxOptions, parent?: BrowserWindow): Promise<void>;
  checkForUpdates(): Promise<unknown | null>;
  sendRendererEvent(eventName: string, payload: unknown, target?: BrowserWindow | null): void;
}

export async function handleCheckForUpdates(deps: ApplicationMenuDeps): Promise<void> {
  const parent = deps.getTargetWindow() ?? undefined;

  try {
    const updateInfo = await deps.checkForUpdates();
    if (updateInfo) {
      deps.sendRendererEvent("app:update-available", updateInfo);
      return;
    }

    await deps.showMessageBox(
      {
        type: "info",
        title: "No Updates Available",
        message: "You're already running the latest version of Wealthfolio.",
      },
      parent,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.showMessageBox(
      {
        type: "error",
        title: "Update Check Failed",
        message: `Failed to check for updates: ${message}`,
      },
      parent,
    );
  }
}

export function buildApplicationMenuTemplate(
  deps: ApplicationMenuDeps,
): MenuItemConstructorOptions[] {
  return [
    {
      label: deps.appName,
      submenu: [
        {
          id: "open_settings",
          label: "Settings...",
          click: () => {
            deps.sendRendererEvent(
              "navigate-to-route",
              { route: "/settings/general" },
              deps.getTargetWindow(),
            );
          },
        },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [{ id: "toggle_fullscreen", label: "Toggle Fullscreen", role: "togglefullscreen" }],
    },
    {
      label: "Help",
      submenu: [
        {
          id: "report_issue",
          label: "Report Issue",
          click: async () => {
            await deps.showMessageBox(
              {
                type: "info",
                title: "Report Issue",
                message: "If you encounter any issues, please email us at support@wealthfolio.app",
              },
              deps.getTargetWindow() ?? undefined,
            );
          },
        },
        { type: "separator" },
        {
          id: "check_for_update",
          label: "Check for Update",
          click: () => {
            void handleCheckForUpdates(deps);
          },
        },
        { type: "separator" },
        {
          id: "show_about_dialog",
          label: "About Wealthfolio",
          click: async () => {
            await deps.showMessageBox(
              {
                type: "info",
                title: `About ${deps.appName}`,
                message: `${deps.appName} version ${deps.appVersion}`,
              },
              deps.getTargetWindow() ?? undefined,
            );
          },
        },
      ],
    },
  ];
}

export function installApplicationMenu(deps: ApplicationMenuDeps): void {
  deps.menu.setApplicationMenu(deps.menu.buildFromTemplate(buildApplicationMenuTemplate(deps)));
}
