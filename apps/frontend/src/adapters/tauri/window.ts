import { getCurrentWindow } from "@tauri-apps/api/window";

import type { UnlistenFn, WindowTheme, WindowThemePreference } from "../types";

const normalizeWindowTheme = (theme: unknown): WindowTheme => {
  return theme === "dark" ? "dark" : "light";
};

export const setWindowTheme = async (theme: WindowThemePreference): Promise<void> => {
  await getCurrentWindow().setTheme(theme);
};

export const getWindowTheme = async (): Promise<WindowTheme> => {
  return normalizeWindowTheme(await getCurrentWindow().theme());
};

export const listenWindowThemeChanged = async (
  handler: (theme: WindowTheme) => void,
): Promise<UnlistenFn> => {
  const unlisten = await getCurrentWindow().onThemeChanged(({ payload }) => {
    handler(normalizeWindowTheme(payload));
  });
  return async () => {
    unlisten();
  };
};

export const toggleWindowFullscreen = async (): Promise<void> => {
  const currentWindow = getCurrentWindow();
  await currentWindow.setFullscreen(!(await currentWindow.isFullscreen()));
};
