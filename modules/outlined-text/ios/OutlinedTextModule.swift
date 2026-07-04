import ExpoModulesCore

public class OutlinedTextModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OutlinedText")

    // JS gates on requireOptionalNativeModule("OutlinedText") != null before
    // mounting the view (a missing view renders Fabric's "Unimplemented component"
    // placeholder instead of throwing). A constant guarantees the module registers
    // a JS-visible record even though it is otherwise view-only.
    Constants([
      "available": true
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
