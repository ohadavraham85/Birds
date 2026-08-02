/* lib/haptics.ts — a short vibration pulse on interactive taps, when the
 * device supports the Vibration API (most Android browsers; iOS Safari does
 * not implement it, so calls there are silently a no-op). Wired globally in
 * main.ts via delegated listeners so new buttons/controls get it for free,
 * rather than threading a call through every view. */

export function haptic(ms = 8): void {
  try { navigator.vibrate?.(ms); } catch { /* unsupported — no-op */ }
}
