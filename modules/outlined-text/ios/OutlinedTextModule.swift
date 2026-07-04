import ExpoModulesCore

public class OutlinedTextModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OutlinedText")

    // JS gates on requireOptionalNativeModule("OutlinedText") != null before
    // mounting the view (a missing view renders Fabric's "Unimplemented component"
    // placeholder instead of throwing). A constant guarantees the module registers
    // a JS-visible record even though it is otherwise view-only.
    //
    // renderVersion = which DRAW implementation this binary carries (JS logs it —
    // a stale binary is otherwise indistinguishable from a broken fix):
    //   1 = NSAttributedString .strokeWidth two-pass (miter-spiked corners)
    //   2 = v1 + retina contentsScale fix
    //   3 = glyph-vector-path stroke, round joins + TextKit fill (uneven border:
    //       subpixel registration mismatch between path and TextKit rasterizers)
    //   4 = stroke AND fill from the same glyph path (libass-style, exact
    //       registration); emoji TextKit-drawn individually
    //   5 = v4 + bottom-aligned draw so the guess→measured height update never
    //       shifts the visible line (bottom-anchored overlay; text was jumping)
    // BUMP THIS on every change to OutlinedTextExpoView's rendering.
    Constants([
      "available": true,
      "renderVersion": 5
    ])

    View(OutlinedTextExpoView.self) {
      Prop("text") { (view: OutlinedTextExpoView, text: String?) in
        view.setText(text ?? "")
      }

      Prop("fontSize") { (view: OutlinedTextExpoView, size: Double?) in
        view.setFontSize(size ?? 32)
      }

      Prop("fontWeight") { (view: OutlinedTextExpoView, weight: Int?) in
        view.setFontWeight(weight ?? 600)
      }

      /// Fixed line height in pt (0 = font default).
      Prop("lineHeight") { (view: OutlinedTextExpoView, height: Double?) in
        view.setLineHeight(height ?? 0)
      }

      /// Outline thickness in pt, drawn fully OUTSIDE the glyph edge (0 = none).
      Prop("strokeWidth") { (view: OutlinedTextExpoView, width: Double?) in
        view.setStrokeWidth(width ?? 0)
      }

      Prop("textColor") { (view: OutlinedTextExpoView, color: UIColor?) in
        view.setTextColor(color)
      }

      Prop("strokeColor") { (view: OutlinedTextExpoView, color: UIColor?) in
        view.setStrokeColor(color)
      }

      Events("onCharacterTap", "onMeasured")
    }
  }
}
