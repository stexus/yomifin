import CoreText
import ExpoModulesCore
import UIKit

/// YOMIFIN: crisp outlined subtitle text — the thing React Native cannot draw.
///
/// Rendering evolution (each step device-verified against the previous):
///  1. RN textShadow → blur, not an outline.
///  2. JS stacked copies → fuzzy (blur AA) and geometry-fragile.
///  3. NSAttributedString `.strokeWidth` two-pass → real stroke, but CoreText's
///     attribute stroking uses MITER joins and ignores the context's line-join
///     setting → blocky/spiky corners on dense CJK.
///  4. Glyph-vector-path stroke (round joins) + TextKit fill on top → corners
///     fixed, but the outline was UNEVEN: the visible border is "stroke minus
///     fill", and TextKit's rasterizer positions glyphs with subpixel differences
///     vs the raw path (origin rounding/smoothing), so the border came out fat on
///     one side, thin on the other.
///  5. ONE geometry source, like libass — stroke AND fill are both rendered from
///     the same glyph vector path (nonzero winding), so registration is exact by
///     construction. Only glyphs with NO vector outline (color/bitmap glyphs,
///     i.e. emoji) are TextKit-drawn, individually, on top — no outline, same as
///     libass.
///  6. CURRENT: BOTTOM-aligned draw. The overlay is bottom-anchored and sizes
///     this view from a GUESSED height first, then the native `onMeasured`
///     height — a top-aligned draw made the visible line jump when that height
///     settled. Drawing from the bottom (empty space goes above the text) pins
///     the on-screen line regardless of the frame height; tap hit-testing uses
///     the same origin so touches still land on the glyphs.
///
/// One TextKit stack drives everything — layout, measurement (`onMeasured`),
/// per-character tap hit-testing (`onCharacterTap`), the outline path AND the
/// fill pass — so geometry cannot disagree between them. Off-glyph touches pass
/// through (`point(inside:)`) so controls-toggle taps beside the text still work.
final class OutlinedTextExpoView: ExpoView {
  private let textStorage = NSTextStorage()
  private let layoutManager = NSLayoutManager()
  private let textContainer = NSTextContainer(size: .zero)

  // Props (defaults match the JS overlay)
  private var text: String = ""
  private var fontSize: CGFloat = 32
  private var fontWeightValue: Int = 500
  private var lineHeightPt: CGFloat = 0 // 0 = font default
  private var strokeWidth: CGFloat = 1.5 // pt, fully outside the glyph
  private var fillColor: UIColor = .white
  private var strokeColor: UIColor = .black

  private var outlinePath: CGPath?
  /// Glyph indexes with no vector outline (emoji/bitmap glyphs) — TextKit-drawn.
  private var colorGlyphIndexes: [Int] = []
  private var lastEmittedHeight: CGFloat = -1
  private var lastLayoutWidth: CGFloat = -1
  /// Y of the last draw's text origin (bottom-aligned) — kept so tap hit-testing
  /// uses the SAME vertical offset the glyphs were actually drawn at.
  private var drawOriginY: CGFloat = 0

  let onCharacterTap = EventDispatcher()
  let onMeasured = EventDispatcher()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    isOpaque = false
    backgroundColor = .clear
    contentMode = .redraw
    clipsToBounds = false
    // CRITICAL: custom-drawn layers default to 1× contentsScale in this context
    // (observed on device as fuzzy/blocky glyphs — the view was rendering at
    // non-retina resolution and being upscaled). Draw at the screen's scale.
    contentScaleFactor = UIScreen.main.scale
    layer.contentsScale = UIScreen.main.scale

    textContainer.lineFragmentPadding = 0
    layoutManager.addTextContainer(textContainer)
    textStorage.addLayoutManager(layoutManager)

    let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
    addGestureRecognizer(tap)
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    // Re-assert on window attach (the authoritative screen is known here; also
    // guards against anything in the view-recycling path resetting it).
    if let scale = window?.screen.scale, scale != layer.contentsScale {
      contentScaleFactor = scale
      layer.contentsScale = scale
      setNeedsDisplay()
    }
  }

  // MARK: - Prop setters (each stores + schedules one rebuild; cheap for cue-sized text)

  func setText(_ value: String) { text = value; rebuild() }
  func setFontSize(_ value: Double) { fontSize = CGFloat(value); rebuild() }
  func setFontWeight(_ value: Int) { fontWeightValue = value; rebuild() }
  func setLineHeight(_ value: Double) { lineHeightPt = CGFloat(value); rebuild() }
  func setStrokeWidth(_ value: Double) { strokeWidth = CGFloat(value); rebuild() }
  func setTextColor(_ value: UIColor?) { fillColor = value ?? .white; rebuild() }
  func setStrokeColor(_ value: UIColor?) { strokeColor = value ?? .black; rebuild() }

  private func uiFontWeight() -> UIFont.Weight {
    switch fontWeightValue {
    case ..<350: return .light
    case ..<450: return .regular
    case ..<550: return .medium
    case ..<650: return .semibold
    case ..<750: return .bold
    default: return .heavy
    }
  }

  private func rebuild() {
    let para = NSMutableParagraphStyle()
    para.alignment = .center
    para.lineBreakMode = .byWordWrapping
    if lineHeightPt > 0 {
      para.minimumLineHeight = lineHeightPt
      para.maximumLineHeight = lineHeightPt
    }
    let font = UIFont.systemFont(ofSize: fontSize, weight: uiFontWeight())
    textStorage.setAttributedString(
      NSAttributedString(
        string: text,
        attributes: [.font: font, .paragraphStyle: para, .foregroundColor: fillColor]
      )
    )
    outlinePath = nil
    lastLayoutWidth = -1 // force re-measure
    setNeedsLayout()
    setNeedsDisplay()
  }

  // MARK: - Layout / measurement

  private func ensureLaidOut(width: CGFloat) {
    if abs(width - lastLayoutWidth) < 0.5 { return }
    lastLayoutWidth = width
    outlinePath = nil
    textContainer.size = CGSize(width: width, height: .greatestFiniteMagnitude)
    layoutManager.ensureLayout(for: textContainer)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let width = bounds.width
    guard width > 0 else { return }
    ensureLaidOut(width: width)
    let used = layoutManager.usedRect(for: textContainer)
    let height = ceil(used.height) + strokeWidth * 2
    if abs(height - lastEmittedHeight) > 0.5 {
      lastEmittedHeight = height
      // `scale` is a diagnostic: JS warns if the layer is rasterizing below the
      // screen scale (the fuzzy/blocky 1× bug — provable from Metro, not vibes).
      onMeasured(["height": Double(height), "scale": Double(layer.contentsScale)])
    }
    setNeedsDisplay()
  }

  // MARK: - Outline path (glyph vectors from the SAME TextKit layout)

  private func buildOutlinePath() -> CGPath {
    let path = CGMutablePath()
    colorGlyphIndexes = []
    let glyphRange = layoutManager.glyphRange(for: textContainer)
    layoutManager.enumerateLineFragments(forGlyphRange: glyphRange) {
      [weak self] fragmentRect, _, _, lineGlyphRange, _ in
      guard let self else { return }
      let lm = self.layoutManager
      for glyphIndex in lineGlyphRange.location..<(lineGlyphRange.location + lineGlyphRange.length) {
        guard lm.isValidGlyphIndex(glyphIndex) else { continue }
        let glyph = lm.cgGlyph(at: glyphIndex)
        if glyph == 0 { continue } // control/blank glyphs have no outline
        let charIndex = lm.characterIndexForGlyph(at: glyphIndex)
        guard charIndex < self.textStorage.length,
          // Post-layout, NSTextStorage's attribute fixing has substituted the
          // EFFECTIVE font per run (e.g. Hiragino for JP under .systemFont), so
          // this font matches the glyph ids TextKit produced.
          let font = self.textStorage.attribute(.font, at: charIndex, effectiveRange: nil)
            as? UIFont
        else { continue }
        // Baseline origin in container coords (top-left origin, y-down); glyph
        // paths are in font space (y-up) → translate to baseline, flip y.
        let location = lm.location(forGlyphAt: glyphIndex)
        var transform = CGAffineTransform(
          translationX: fragmentRect.origin.x + location.x,
          y: fragmentRect.origin.y + location.y
        ).scaledBy(x: 1, y: -1)
        // CTFont is toll-free bridged with UIFont (documented) — same object.
        let ctFont = unsafeBitCast(font, to: CTFont.self)
        if let glyphPath = CTFontCreatePathForGlyph(ctFont, glyph, &transform) {
          path.addPath(glyphPath)
        } else {
          // No vector outline. Whitespace/control glyphs are simply blank; a
          // color/bitmap glyph (emoji) must be drawn by TextKit in draw().
          let ch = (self.textStorage.string as NSString).character(at: charIndex)
          let isWhitespace =
            Unicode.Scalar(ch).map { CharacterSet.whitespacesAndNewlines.contains($0) }
            ?? false
          if !isWhitespace {
            self.colorGlyphIndexes.append(glyphIndex)
          }
        }
      }
    }
    return path
  }

  /// Bottom-aligned text origin for the current frame. Empty space (from a frame
  /// taller than the text — e.g. the pre-measurement guess) sits ABOVE the text,
  /// keeping the bottom edge — and thus the on-screen line — fixed.
  private func textOrigin() -> CGPoint {
    let usedHeight = ceil(layoutManager.usedRect(for: textContainer).height)
    let y = max(strokeWidth, bounds.height - usedHeight - strokeWidth)
    return CGPoint(x: 0, y: y)
  }

  override func draw(_ rect: CGRect) {
    guard !text.isEmpty, bounds.width > 0, let ctx = UIGraphicsGetCurrentContext()
    else { return }
    ensureLaidOut(width: bounds.width)
    let origin = textOrigin()
    drawOriginY = origin.y
    if outlinePath == nil { outlinePath = buildOutlinePath() }

    if let path = outlinePath, !path.isEmpty {
      ctx.saveGState()
      ctx.translateBy(x: origin.x, y: origin.y)
      if strokeWidth > 0 {
        ctx.addPath(path)
        // ROUND joins are the whole point: CoreText's own `.strokeWidth`
        // attribute stroking miters corners (blocky on CJK, device-observed).
        ctx.setLineJoin(.round)
        ctx.setLineCap(.round)
        ctx.setLineWidth(strokeWidth * 2) // half falls inside, covered by the fill
        ctx.setStrokeColor(strokeColor.cgColor)
        ctx.strokePath()
      }
      // Fill from the SAME path as the stroke (nonzero winding = font contour
      // convention). Filling via TextKit instead put a subpixel-shifted fill over
      // the stroke — device-observed as an UNEVEN border.
      ctx.addPath(path)
      ctx.setFillColor(fillColor.cgColor)
      ctx.fillPath(using: .winding)
      ctx.restoreGState()
    }

    // Color/bitmap glyphs (no vector outline — emoji): TextKit draws them, un-
    // outlined, exactly where the layout put them.
    for glyphIndex in colorGlyphIndexes {
      layoutManager.drawGlyphs(
        forGlyphRange: NSRange(location: glyphIndex, length: 1), at: origin)
    }
  }

  // MARK: - Tap → character index

  /// Where a point maps to an actual glyph (with slop). Used BOTH for tap handling
  /// and for hit-testing: `glyphIndex(for:)` clamps to the nearest glyph, so without
  /// the bounding-rect check every point in the view would "hit".
  private func glyphHit(at point: CGPoint) -> Int? {
    guard textStorage.length > 0 else { return nil }
    var p = point
    // Match draw()'s bottom-aligned origin so taps land on the visible glyphs.
    p.y -= drawOriginY
    let glyphIndex = layoutManager.glyphIndex(for: p, in: textContainer)
    let glyphRect = layoutManager.boundingRect(
      forGlyphRange: NSRange(location: glyphIndex, length: 1),
      in: textContainer
    )
    guard glyphRect.insetBy(dx: -10, dy: -8).contains(p) else { return nil }
    let charIndex = layoutManager.characterIndexForGlyph(at: glyphIndex)
    return charIndex < textStorage.length ? charIndex : nil
  }

  /// The view spans the full subtitle strip; only GLYPHS may swallow touches.
  /// Off-glyph touches must fall through to the layers below (controls toggle,
  /// gesture overlay) exactly like the old per-token Pressables did.
  override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
    return glyphHit(at: point) != nil
  }

  @objc private func handleTap(_ gesture: UITapGestureRecognizer) {
    guard let charIndex = glyphHit(at: gesture.location(in: self)) else { return }
    onCharacterTap(["index": charIndex])
  }
}
