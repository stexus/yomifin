import ExpoModulesCore

public class GestureSurfaceModule: Module {
  public func definition() -> ModuleDefinition {
    Name("YomifinGestureSurface")

    // Synchronous binary probe: `requireOptionalNativeModule("YomifinGestureSurface")`
    // returning null in JS proves a STALE binary (GestureOverlay then falls back to
    // the legacy RNGH tap tree + MpvPlayerView window seam). Bump on any behavior
    // change so Metro logs can prove which binary is on-device.
    // v1 = initial tree (UIKit-default ~350ms double-tap window);
    // v2 = TimedDoubleTapRecognizer — configurable window (doubleTapMaxIntervalMs,
    //      default 220ms) so single tap fires sooner.
    Function("apiVersion") {
      return 2
    }

    View(GestureSurfaceView.self) {
      Prop("doubleTapEnabled") { (view: GestureSurfaceView, enabled: Bool) in
        view.doubleTapEnabled = enabled
      }

      Prop("doubleTapMaxIntervalMs") { (view: GestureSurfaceView, ms: Int) in
        view.doubleTapMaxIntervalMs = ms
      }

      Events("onSingleTap", "onDoubleTap", "onTwoFingerTap")
    }
  }
}
