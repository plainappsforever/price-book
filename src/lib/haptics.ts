import * as Haptics from 'expo-haptics';

/** Key tick (D19, setting "haptics", default on). Silently does nothing where the device has no haptics. */
export function keyTick(enabled: boolean): void {
  if (!enabled) return;
  Haptics.selectionAsync().catch(() => undefined);
}
