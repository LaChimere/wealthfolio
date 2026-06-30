import type { UnlistenFn, WindowTheme, WindowThemePreference } from "../types";

const noopUnlisten: UnlistenFn = () => Promise.resolve();

export const setWindowTheme = (_theme: WindowThemePreference): Promise<void> => {
  return Promise.resolve();
};

export const getWindowTheme = (): Promise<WindowTheme> => {
  const prefersDark =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  return Promise.resolve(prefersDark ? "dark" : "light");
};

export const listenWindowThemeChanged = (
  _handler: (theme: WindowTheme) => void,
): Promise<UnlistenFn> => {
  return Promise.resolve(noopUnlisten);
};

export const toggleWindowFullscreen = (): Promise<void> => {
  return Promise.resolve();
};
