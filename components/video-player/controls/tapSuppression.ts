/*
 * Shared guard between the NATIVE two-finger-tap seam (MpvPlayerView's window-level
 * UITapGestureRecognizer → onTwoFingerTap, handled in direct-player) and the RNGH tap
 * recognizers in GestureOverlay.
 *
 * A two-finger tap also satisfies RNGH's single/double-tap criteria (its iOS tap
 * handler counts taps per touchesBegan event), so when the native recognizer fires,
 * the JS taps that recognize moments later (they sit behind Exclusive-failure delays)
 * must be swallowed. Module-level timestamp — both sides are player-screen-scoped.
 */

let suppressedUntil = 0;

/** Called when the native two-finger tap fires: swallow JS taps for a beat. */
export function suppressTaps(ms = 450): void {
  suppressedUntil = Date.now() + ms;
}

/** True while JS single/double-tap recognitions should be ignored. */
export function tapsSuppressed(): boolean {
  return Date.now() < suppressedUntil;
}
