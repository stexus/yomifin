import ExpoModulesCore
import UIKit
#if !os(tvOS)
import UIKit.UIGestureRecognizerSubclass
#endif

#if !os(tvOS)
/// UITapGestureRecognizer(numberOfTapsRequired: 2) whose inter-tap window is
/// CONFIGURABLE. UIKit's built-in window (~350ms, not exposed) is exactly the
/// single-tap latency behind `require(toFail:)` — device-verified as sluggish.
/// After the first tap lifts with the recognizer still .possible, we schedule a
/// forced .failed transition `maxIntervalMs` later; a second touch beginning in
/// time cancels it and UIKit proceeds with normal double-tap recognition.
/// (A second tap landing AFTER the window becomes a fresh single tap — same
/// trade-off the old RNGH maxDelay(280) made.)
private class TimedDoubleTapRecognizer: UITapGestureRecognizer {
  var maxIntervalMs: Int = 220
  private var pendingFail: DispatchWorkItem?

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
    pendingFail?.cancel()
    pendingFail = nil
    super.touchesBegan(touches, with: event)
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
    super.touchesEnded(touches, with: event)
    guard state == .possible else { return }
    let item = DispatchWorkItem { [weak self] in
      guard let self, self.state == .possible else { return }
      self.state = .failed // releases the require(toFail:) chain → single tap fires
    }
    pendingFail = item
    DispatchQueue.main.asyncAfter(
      deadline: .now() + .milliseconds(maxIntervalMs), execute: item)
  }

  override func reset() {
    pendingFail?.cancel()
    pendingFail = nil
    super.reset()
  }
}
#endif

/// YOMIFIN: unified native gesture surface (FEATURES backlog "all-native gesture
/// surface", triggered by drag-anywhere-to-seek).
///
/// ONE UIKit recognizer tree for every TAP gesture over the video, replacing the
/// RNGH tap recognizers + the window-level two-finger seam (MpvPlayerView seam v2)
/// + the tapSuppression/grace-delay dedup between them:
///
///   - singleTap    (1 touch, 1 tap)  → onSingleTap  { x, y }
///   - doubleTap    (1 touch, 2 taps) → onDoubleTap  { x, y }  (gated by the
///     `doubleTapEnabled` prop; when enabled, singleTap waits for its failure —
///     UIKit's own disambiguation, no JS timers)
///   - twoFingerTap (2 touches, 1 tap) → onTwoFingerTap
///
/// UIKit arbitration does natively what RNGH could not (RNGH cannot recognize
/// multi-touch taps on iOS, period — see YOMIFIN_CONTEXT gotcha): a second finger
/// fails the 1-touch recognizers, `require(toFail:)` sequences single after
/// double/two-finger, and a disabled recognizer counts as already-failed so
/// single-tap fires with zero delay when double-tap seek is off.
///
/// This view sits exactly where GestureOverlay's dim View sits (above the video,
/// below buttons), so — unlike the old MpvPlayerView window recognizer — it
/// view-locally sees every touch that isn't claimed by a control button.
///
/// PAN deliberately stays in RNGH (GestureOverlay): drag-anywhere-to-seek needs a
/// worklet `onUpdate` writing SharedValues on the UI thread (zero per-frame bridge
/// traffic); native pan events would re-introduce exactly the per-frame JS traffic
/// that made drag-to-seek attempt 1 laggy. Taps and pans are disjoint by UIKit
/// semantics (movement fails taps; RNGH's pan needs minDistance), so the two trees
/// coexist with no suppression coupling at all.
class GestureSurfaceView: ExpoView {
  let onSingleTap = EventDispatcher()
  let onDoubleTap = EventDispatcher()
  let onTwoFingerTap = EventDispatcher()

#if !os(tvOS)
  private var singleTapRecognizer: UITapGestureRecognizer!
  private var doubleTapRecognizer: TimedDoubleTapRecognizer!
  private var twoFingerRecognizer: UITapGestureRecognizer!
#endif

  var doubleTapEnabled: Bool = true {
    didSet {
#if !os(tvOS)
      // A disabled recognizer immediately satisfies require(toFail:), so singleTap
      // loses its recognition delay the moment double-tap seek is turned off.
      doubleTapRecognizer?.isEnabled = doubleTapEnabled
#endif
    }
  }

  /// Inter-tap window for double-tap recognition — and therefore the single-tap
  /// latency while double-tap seek is enabled (apiVersion 2).
  var doubleTapMaxIntervalMs: Int = 220 {
    didSet {
#if !os(tvOS)
      doubleTapRecognizer?.maxIntervalMs = doubleTapMaxIntervalMs
#endif
    }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
#if !os(tvOS)
    isUserInteractionEnabled = true

    let twoFinger = UITapGestureRecognizer(target: self, action: #selector(handleTwoFingerTap(_:)))
    twoFinger.numberOfTapsRequired = 1
    twoFinger.numberOfTouchesRequired = 2

    let double = TimedDoubleTapRecognizer(target: self, action: #selector(handleDoubleTap(_:)))
    double.numberOfTapsRequired = 2
    double.numberOfTouchesRequired = 1
    double.maxIntervalMs = doubleTapMaxIntervalMs

    let single = UITapGestureRecognizer(target: self, action: #selector(handleSingleTap(_:)))
    single.numberOfTapsRequired = 1
    single.numberOfTouchesRequired = 1

    // Arbitration: single fires only once double (when enabled) and two-finger have
    // failed; double waits for two-finger (a lone touch fails the 2-touch recognizer
    // at touch-end, so the added latency is imperceptible).
    single.require(toFail: double)
    single.require(toFail: twoFinger)
    double.require(toFail: twoFinger)

    for recognizer in [twoFinger, double, single] {
      // Pure observers of the touch stream: never cancel/delay RN or RNGH touches.
      recognizer.cancelsTouchesInView = false
      recognizer.delaysTouchesBegan = false
      recognizer.delaysTouchesEnded = false
      recognizer.delegate = self
      addGestureRecognizer(recognizer)
    }
    twoFingerRecognizer = twoFinger
    doubleTapRecognizer = double
    singleTapRecognizer = single
#endif
  }

#if !os(tvOS)
  @objc private func handleSingleTap(_ recognizer: UITapGestureRecognizer) {
    guard recognizer.state == .ended else { return }
    let p = recognizer.location(in: self)
    onSingleTap(["x": Double(p.x), "y": Double(p.y)])
  }

  @objc private func handleDoubleTap(_ recognizer: UITapGestureRecognizer) {
    guard recognizer.state == .ended else { return }
    let p = recognizer.location(in: self)
    onDoubleTap(["x": Double(p.x), "y": Double(p.y)])
  }

  @objc private func handleTwoFingerTap(_ recognizer: UITapGestureRecognizer) {
    guard recognizer.state == .ended else { return }
    onTwoFingerTap([:])
  }
#endif
}

#if !os(tvOS)
extension GestureSurfaceView: UIGestureRecognizerDelegate {
  public func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer,
    shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
  ) -> Bool {
    // Coexist with recognizers we don't own (RNGH's pan on the wrapping RN view)
    // so UIKit recognizer-prevention can never kill our taps — the exact failure
    // mode of the old seam v1. Keep default exclusivity WITHIN our own tree so the
    // require(toFail:) sequencing above stays authoritative.
    return otherGestureRecognizer.view != self
  }
}
#endif
