import {
  getWindowTheme,
  isDesktop,
  listenWindowThemeChanged,
  logger,
  setWindowTheme,
} from "@/adapters";
import type { UnlistenFn } from "@/adapters";
import { createContext, ReactNode, useContext, useEffect, useState } from "react";

import { useSettings } from "@/hooks/use-settings";
import { useSettingsMutation } from "@/hooks/use-settings-mutation";
import { Settings, SettingsContextType } from "@/lib/types";

interface ExtendedSettingsContextType extends SettingsContextType {
  updateSettings: (
    updates: Partial<
      Pick<
        Settings,
        | "theme"
        | "font"
        | "baseCurrency"
        | "timezone"
        | "onboardingCompleted"
        | "menuBarVisible"
        | "syncEnabled"
      >
    >,
  ) => Promise<void>;
  refetch: () => Promise<void>;
}

const SettingsContext = createContext<ExtendedSettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { data, isLoading, isError, refetch } = useSettings();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [accountsGrouped, setAccountsGrouped] = useState(true);

  const updateMutation = useSettingsMutation(setSettings, applySettingsToDocument);

  const updateBaseCurrency = async (baseCurrency: Settings["baseCurrency"]) => {
    if (!settings) throw new Error("Settings not loaded");
    await updateMutation.mutateAsync({ baseCurrency });
  };

  // Batch update function
  const updateSettings = async (
    updates: Partial<
      Pick<
        Settings,
        | "theme"
        | "font"
        | "baseCurrency"
        | "timezone"
        | "onboardingCompleted"
        | "menuBarVisible"
        | "syncEnabled"
      >
    >,
  ) => {
    if (!settings) throw new Error("Settings not loaded");
    await updateMutation.mutateAsync(updates);
  };

  useEffect(() => {
    if (data) {
      setSettings(data);
      applySettingsToDocument(data);
    }
  }, [data]);

  // Cleanup any lingering listeners when provider unmounts
  useEffect(() => {
    return () => {
      try {
        cleanupSystemThemeListeners();
      } catch {
        // noop
      }
    };
  }, []);

  const contextValue: ExtendedSettingsContextType = {
    settings,
    isLoading,
    isError,
    updateBaseCurrency,
    updateSettings,
    refetch: async () => {
      await refetch();
    },
    accountsGrouped,
    setAccountsGrouped,
  };

  return <SettingsContext.Provider value={contextValue}>{children}</SettingsContext.Provider>;
}

export function useSettingsContext() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettingsContext must be used within a SettingsProvider");
  }
  return context;
}
// Keep references to system theme listeners so we can clean up when switching modes
let windowThemeUnlisten: UnlistenFn | null = null;
let windowThemeListenerGeneration = 0;
let mediaQueryList: MediaQueryList | null = null;
let mediaQueryUnsubscribe: (() => void) | null = null;

// Apply the resolved theme (light or dark) to the DOM
function applyResolvedTheme(resolved: "light" | "dark") {
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add(resolved);
  document.documentElement.style.colorScheme = resolved;
}

// Cleanup any existing system listeners
function cleanupSystemThemeListeners() {
  windowThemeListenerGeneration += 1;
  if (windowThemeUnlisten) {
    const unlisten = windowThemeUnlisten;
    windowThemeUnlisten = null;
    void unlisten().catch(() => {
      // noop
    });
  }
  if (mediaQueryUnsubscribe) {
    try {
      mediaQueryUnsubscribe();
    } catch {
      // noop
    }
    mediaQueryUnsubscribe = null;
  }
  mediaQueryList = null;
}

// Helper function to apply settings to the document
const applySettingsToDocument = (newSettings: Settings) => {
  // Font classes
  document.body.classList.remove("font-mono", "font-sans", "font-serif");
  document.body.classList.add(newSettings.font);

  // Cache theme/font in localStorage for pre-auth usage (login screen)
  try {
    localStorage.setItem("wealthfolio-theme", newSettings.theme);
  } catch {
    // noop – localStorage may be unavailable
  }

  // Always clean up previous listeners before applying a new theme mode
  cleanupSystemThemeListeners();

  // Handle theme mode
  if (newSettings.theme === "system") {
    // Resolve initial theme from media query (immediate), fallback to light
    let initial: "light" | "dark" = "light";
    if (typeof window !== "undefined" && window.matchMedia) {
      mediaQueryList = window.matchMedia("(prefers-color-scheme: dark)");
      initial = mediaQueryList.matches ? "dark" : "light";
      if (!isDesktop) {
        const handler = (e: MediaQueryListEvent) =>
          applyResolvedTheme(e.matches ? "dark" : "light");
        if (mediaQueryList.addEventListener) {
          mediaQueryList.addEventListener("change", handler);
          mediaQueryUnsubscribe = () => mediaQueryList?.removeEventListener("change", handler);
        } else {
          // Legacy API support - addListener is deprecated but needed for older browsers
          mediaQueryList.addListener(handler);
          mediaQueryUnsubscribe = () => {
            try {
              mediaQueryList?.removeListener(handler);
            } catch {
              // noop
            }
          };
        }
      }
    }

    // On desktop, also sync the native window theme + listen to OS changes.
    if (isDesktop) {
      const listenerGeneration = windowThemeListenerGeneration;
      (async () => {
        try {
          await setWindowTheme(null);
          const current = await getWindowTheme();
          if (listenerGeneration !== windowThemeListenerGeneration) {
            return;
          }
          if (current) {
            applyResolvedTheme(current);
          }

          const unlisten = await listenWindowThemeChanged((next) => {
            if (listenerGeneration === windowThemeListenerGeneration) {
              applyResolvedTheme(next);
            }
          });
          if (listenerGeneration !== windowThemeListenerGeneration) {
            void unlisten();
            return;
          }
          windowThemeUnlisten = unlisten;
        } catch {
          logger.error("Error setting window theme.");
          if (listenerGeneration === windowThemeListenerGeneration) {
            applyResolvedTheme(initial);
          }
        }
      })();
    }

    if (!isDesktop) {
      applyResolvedTheme(initial);
    }
    return;
  }

  // Explicit light/dark mode
  const explicit = newSettings.theme === "dark" ? "dark" : "light";
  applyResolvedTheme(explicit);

  // Only call native window APIs when running the desktop app for explicit modes.
  if (isDesktop) {
    (async () => {
      try {
        await setWindowTheme(explicit);
      } catch {
        logger.error("Error setting window theme.");
      }
    })();
  }
};
