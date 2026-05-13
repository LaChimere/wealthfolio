import { getElectronApi } from "./core";
import type { UnlistenFn, WindowTheme, WindowThemePreference } from "../types";

export const setWindowTheme = async (theme: WindowThemePreference): Promise<void> => {
  await getElectronApi().setWindowTheme(theme);
};

export const getWindowTheme = async (): Promise<WindowTheme> => {
  return await getElectronApi().getWindowTheme();
};

export const listenWindowThemeChanged = async (
  handler: (theme: WindowTheme) => void,
): Promise<UnlistenFn> => {
  return await getElectronApi().listen<WindowTheme>("window:theme-changed", (event) => {
    handler(event.payload);
  });
};

export const toggleWindowFullscreen = async (): Promise<void> => {
  await getElectronApi().toggleWindowFullscreen();
};
