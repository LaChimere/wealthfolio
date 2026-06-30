import { useCallback } from "react";

/**
 * Hook to trigger haptic feedback on supported web/mobile devices.
 * @returns A function to trigger haptic feedback
 */
export function useHapticFeedback() {
  const triggerHaptic = useCallback(() => {
    navigator.vibrate?.(30);
  }, []);

  const triggerHapticPattern = useCallback((count = 3, intervalMs = 80) => {
    if (!navigator.vibrate) {
      return;
    }

    navigator.vibrate(
      Array.from({ length: count }, () => 50).flatMap((value) => [value, intervalMs]),
    );
  }, []);

  return { triggerHaptic, triggerHapticPattern };
}
