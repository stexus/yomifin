import ExpoModulesCore
import UIKit

/// One TextKit stack (storage → layout manager → container). Two identical stacks
/// are used so the stroke pass and the fill pass never mutate a shared NSTextStorage
/// inside draw() (attribute edits there trigger display invalidation → redraw loop).
private final class TextStack {
  let storage = NSTextStorage()
  let layoutManager = NSLayoutManager()
  let container = NSTextContainer(size: .zero)

  init() {
    container.lineFragmentPadding = 0
    layoutManager.addTextContainer(container)
    storage.addLayoutManager(layoutManager)
  }

  func setText(_ text: String, attributes: [NSAttributedString.Key: Any]) {
    storage.setAttributedString(NSAttributedString(string: text, attributes: attributes))
  }

  func layout(width: CGFloat) -> CGRect {
    container.size = CGSize(width: width, height: .greatestFiniteMagnitude)
    layoutManager.ensureLayout(for: container)
    return layoutManager.usedRect(for: container)
  }

  func draw(at origin: CGPoint) {
    let range = layoutManager.glyphRange(for: container)
    layoutManager.drawGlyphs(forGlyphRange: range, at: origin)
  }
}

/// YOMIFIN: crisp outlined subtitle text — the thing React Native cannot draw.
///
/// RN's `textShadow*` is a blur, and the stacked-copies JS trick anti-aliases into
/// mush. iOS' real mechanism is an attributed-string STROKE: this view renders the
/// text twice with TextKit — pass 1 stroke-only (`.strokeWidth` positive, doubled so
/// the requested width lands fully OUTSIDE the glyph edge, round line joins), pass 2
/// plain fill on top. Same technique as native players (Infuse et al.).
///
/// It also owns tap handling: `layoutManager.glyphIndex(for:)` maps a touch to a
/// character index (emitted via `onCharacterTap`), so the JS overlay no longer needs
/// per-token Pressables — geometry and hit-testing come from the SAME layout.
/// Sizing: JS provides the width; the view reports the wrapped text height through
/// `onMeasured` (one event per text/width change).
final class OutlinedTextExpoView: ExpoView {
  private let strokeStack = TextStack()
  private let fillStack = TextStack()

  // Props (defaults match the JS overlay)
  private var text: String = ""
  private var fontSize: CGFloat = 32
  private var fontWeightValue: Int = 600
  private var lineHeightPt: CGFloat = 0 // 0 = font default
  private var strokeWidth: CGFloat = 2 // pt, fully outside the glyph
  private var fillColor: UIColor = .white
  private var strokeColor: UIColor = .black

  private var lastEmittedHeight: CGFloat = -1
  private var lastLayoutWidth: CGFloat = -1

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

    var fillAttrs: [NSAttributedString.Key: Any] = [
      .font: font,
      .paragraphStyle: para,
      .foregroundColor: fillColor,
    ]
    fillStack.setText(text, attributes: fillAttrs)

    // Stroke pass: positive .strokeWidth = stroke WITHOUT fill. The value is a
    // PERCENTAGE of the font size, and the stroke straddles the glyph edge — so a
    // line width of 2×strokeWidth puts `strokeWidth` pt fully outside the glyph.
    fillAttrs[.foregroundColor] = strokeColor
    fillAttrs[.strokeColor] = strokeColor
    fillAttrs[.strokeWidth] = fontSize > 0 ? Double((strokeWidth * 2 / fontSize) * 100) : 0
    strokeStack.setText(text, attributes: fillAttrs)

    lastLayoutWidth = -1 // force re-measure
    setNeedsLayout()
    setNeedsDisplay()
  }

  // MARK: - Layout / measurement

  override func layoutSubviews() {
    super.layoutSubviews()
    let width = bounds.width
    guard width > 0 else { return }
    if abs(width - lastLayoutWidth) < 0.5 { return }
    lastLayoutWidth = width
    _ = strokeStack.layout(width: width)
    let used = fillStack.layout(width: width)
    let height = ceil(used.height) + strokeWidth * 2
    if abs(height - lastEmittedHeight) > 0.5 {
      lastEmittedHeight = height
      onMeasured(["height": Double(height)])
    }
    setNeedsDisplay()
  }

  override func draw(_ rect: CGRect) {
    guard !text.isEmpty, bounds.width > 0 else { return }
    if lastLayoutWidth < 0 {
      _ = strokeStack.layout(width: bounds.width)
      _ = fillStack.layout(width: bounds.width)
      lastLayoutWidth = bounds.width
    }
    let origin = CGPoint(x: 0, y: strokeWidth)
    if strokeWidth > 0, let ctx = UIGraphicsGetCurrentContext() {
      ctx.saveGState()
      // Round joins/caps keep CJK corners from spiking (miter is the default).
      ctx.setLineJoin(.round)
      ctx.setLineCap(.round)
      strokeStack.draw(at: origin)
      ctx.restoreGState()
    }
    fillStack.draw(at: origin)
  }

  // MARK: - Tap → character index

  /// Where a point maps to an actual glyph (with slop). Used BOTH for tap handling
  /// and for hit-testing: `glyphIndex(for:)` clamps to the nearest glyph, so without
  /// the bounding-rect check every point in the view would "hit".
  private func glyphHit(at point: CGPoint) -> Int? {
    guard fillStack.storage.length > 0 else { return nil }
    var p = point
    p.y -= strokeWidth
    let lm = fillStack.layoutManager
    let glyphIndex = lm.glyphIndex(for: p, in: fillStack.container)
    let glyphRect = lm.boundingRect(
      forGlyphRange: NSRange(location: glyphIndex, length: 1),
      in: fillStack.container
    )
    guard glyphRect.insetBy(dx: -10, dy: -8).contains(p) else { return nil }
    let charIndex = lm.characterIndexForGlyph(at: glyphIndex)
    return charIndex < fillStack.storage.length ? charIndex : nil
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
