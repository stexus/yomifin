/*
 * Pure (RN-free, bun-testable) core for rendering Yomitan structured content.
 *
 * Yomitan's display/structured-content-generator.js emits DOM, which Hermes/RN can't
 * use. We port the *logic* here: node classification (inline vs block), child
 * normalization, CSS-ish style → RN-style mapping, and list bullets. The actual
 * <View>/<Text> tree lives in components/yomifin/StructuredContent.tsx and consumes
 * these helpers. Keeping the logic here means it can be unit-tested without RN.
 *
 * Structured content node (see yomitan types/ext/structured-content.d.ts):
 *   Content = string | Content[] | { tag, content?, style?, data?, lang?, href?, ... }
 */

export type SCStyle = Record<string, unknown>;

export interface SCNode {
  tag: string;
  content?: SCContent;
  style?: SCStyle;
  data?: Record<string, string>;
  lang?: string;
  href?: string;
  // image fields (path/width/height/...) — handled minimally / skipped for MVP
  [key: string]: unknown;
}

export type SCContent = string | SCContent[] | SCNode | undefined | null;

/**
 * Normalize a glossary item into a renderable structured-content tree. A Yomitan
 * glossary item may be a plain string, a structured-content tree, or a WRAPPER object
 * ({type:'structured-content'|'text'|'image', ...}). Unwrapping here means the renderer
 * always receives valid SCContent and can't choke on the wrapper shapes.
 */
export function normalizeGlossary(content: unknown): SCContent {
  if (content && typeof content === "object" && !Array.isArray(content)) {
    const obj = content as Record<string, unknown>;
    if (typeof obj.type === "string" && obj.tag === undefined) {
      switch (obj.type) {
        case "structured-content":
          return obj.content as SCContent;
        case "text":
          return typeof obj.text === "string" ? obj.text : "";
        default:
          return null; // 'image' and anything else: out of scope (definitions-only)
      }
    }
  }
  return content as SCContent;
}

/**
 * Recursively flatten structured content (or a plain string) to text. Newlines after
 * list items / <br> keep multi-sense entries readable when shipped to Anki.
 * (Moved here from anki.ts in Phase 8 so the selection/marker layer can reuse it.)
 */
export function scToText(node: SCContent): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(scToText).join("");
  const tag = (node as { tag?: string }).tag;
  const inner = scToText((node as { content?: SCContent }).content);
  if (tag === "br") return `${inner}\n`;
  if (tag === "li") return `${inner}\n`;
  return inner;
}

// --- HTML serialization (Yomitan-parity {glossary} output) ---------------------------
// Yomitan ships rendered HTML to Anki (`<div class="yomitan-glossary"><ol><li
// data-dictionary=…>…`); scToHtml is the pure serializer equivalent — same recursion
// as scToText but emitting escaped HTML with a whitelisted tag/style subset.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Tags we pass through verbatim; anything else renders as a span (content kept). */
const HTML_TAG_WHITELIST = new Set([
  "br",
  "ruby",
  "rt",
  "rp",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "span",
  "div",
  "ol",
  "ul",
  "li",
  "details",
  "summary",
  "a",
  "i",
  "b",
  "em",
  "strong",
  "sub",
  "sup",
]);

const VOID_TAGS = new Set(["br", "img"]);

/** Serialize the CSS-ish SC style subset to an inline `style="…"` string. */
export function styleToCss(style: SCStyle | undefined): string {
  if (!style) return "";
  const parts: string[] = [];
  const push = (prop: string, v: unknown) => {
    if (typeof v === "string" && v.trim() !== "")
      parts.push(`${prop}:${v.trim()}`);
    else if (typeof v === "number") parts.push(`${prop}:${v}`);
  };
  push("font-style", style.fontStyle);
  push("font-weight", style.fontWeight);
  push("font-size", style.fontSize);
  push("color", style.color);
  push("background-color", style.backgroundColor);
  push("text-align", style.textAlign);
  push("vertical-align", style.verticalAlign);
  push("margin-left", style.marginLeft);
  push("margin-right", style.marginRight);
  push("list-style-type", style.listStyleType);
  push("white-space", style.whiteSpace);
  const tdl = style.textDecorationLine;
  if (typeof tdl === "string" && tdl !== "none") {
    parts.push(`text-decoration:${tdl}`);
  } else if (Array.isArray(tdl) && tdl.length > 0) {
    parts.push(`text-decoration:${tdl.join(" ")}`);
  }
  return parts.join(";");
}

/**
 * Recursively serialize structured content to HTML. Pure — no DOM. Known gap
 * (phased separately): dictionary-internal images (gaiji) are skipped, matching
 * scToText's behavior; they need importer media support + Anki upload first.
 */
export function scToHtml(node: SCContent): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string") return escapeHtml(node);
  if (Array.isArray(node)) return node.map(scToHtml).join("");
  const sc = node as SCNode;
  const rawTag = typeof sc.tag === "string" ? sc.tag.toLowerCase() : "span";
  if (rawTag === "img") return ""; // gaiji: out of scope (see doc above)
  const tag = HTML_TAG_WHITELIST.has(rawTag) ? rawTag : "span";
  const attrs: string[] = [];
  const css = styleToCss(sc.style);
  if (css) attrs.push(`style="${escapeHtml(css)}"`);
  if (sc.data && typeof sc.data === "object") {
    for (const [k, v] of Object.entries(sc.data)) {
      if (typeof v === "string" && /^[\w-]+$/.test(k)) {
        // Yomitan prefixes structured-content data attrs with `sc-` (data-sc-name,
        // data-sc-class, …) — note CSS written for Yomitan keys on these.
        attrs.push(`data-sc-${k}="${escapeHtml(v)}"`);
      }
    }
  }
  if (typeof sc.lang === "string" && sc.lang)
    attrs.push(`lang="${escapeHtml(sc.lang)}"`);
  if (tag === "a" && typeof sc.href === "string")
    attrs.push(`href="${escapeHtml(sc.href)}"`);
  const attrStr = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
  if (VOID_TAGS.has(tag)) return `<${tag}${attrStr}>`;
  return `<${tag}${attrStr}>${scToHtml(sc.content)}</${tag}>`;
}

/**
 * Content of ONE definition (one dictionary entry): a single glossary item renders
 * bare, multiple items as a plain <ul> — matching Yomitan's `glossary-single` partial
 * (dictionary-authored lists, e.g. Jitendex's `list-style-type:"＊"` <ul>, come from
 * the structured content itself, not this wrapper).
 */
export function glossaryContentHtml(items: SCContent[]): string {
  const isLiNode = (n: SCContent): boolean =>
    typeof n === "object" &&
    n !== null &&
    !Array.isArray(n) &&
    typeof (n as SCNode).tag === "string" &&
    ((n as SCNode).tag as string).toLowerCase() === "li";
  const entries = items
    .map((item) => ({ isLi: isLiNode(item), html: scToHtml(item) }))
    .filter((e) => e.html.trim() !== "");
  if (entries.length === 0) return "";
  // A lone non-list item renders bare; anything list-ish gets ONE <ul> so extracted
  // <li> nodes (sense selections pull them out of their original list) stay valid.
  if (entries.length === 1 && !entries[0].isLi) return entries[0].html;
  return `<ul>${entries
    .map((e) => (e.isLi ? e.html : `<li>${e.html}</li>`))
    .join("")}</ul>`;
}

/** One definition (DB row): dictionary + its definition tags + glossary items. */
export interface GlossaryDefinition {
  dictionary: string;
  /** Definition tags (e.g. ★) — shown in the <i>(tag, …, dictionary)</i> prefix. */
  tags?: string[];
  items: SCContent[];
}

/**
 * Yomitan default-template parity for {glossary} (verified against real Yomitan
 * card output):
 *
 *   <div style="text-align: left;" class="yomitan-glossary">
 *     <ol>
 *       <li data-dictionary="三省堂…"><i>(三省堂…)</i> <span>…sc html…</span></li>
 *       <li data-dictionary="Jitendex…"><i>(★, Jitendex…)</i> <span>…</span></li>
 *     </ol>
 *   </div>
 *
 * Numbered <ol> only when there are ≥2 definitions; a single definition renders as a
 * bare <span> inside the wrapper (Yomitan's else-branch). `dictionaryTag: false`
 * drops the <i>(…)</i> prefix — used by {single-glossary:…}, where the dictionary is
 * already implied (Yomitan's `brief` mode).
 */
export function glossaryDefinitionsToHtml(
  defs: GlossaryDefinition[],
  opts: { dictionaryTag?: boolean } = {},
): string {
  const dictionaryTag = opts.dictionaryTag ?? true;
  const rendered = defs
    .map((def) => ({ def, html: glossaryContentHtml(def.items) }))
    .filter((r) => r.html !== "");
  if (rendered.length === 0) return "";
  const wrap = (inner: string) =>
    `<div style="text-align: left;" class="yomitan-glossary">${inner}</div>`;
  if (rendered.length === 1) return wrap(`<span>${rendered[0].html}</span>`);
  const lis = rendered.map(({ def, html }) => {
    const prefix = dictionaryTag
      ? `<i>(${escapeHtml([...(def.tags ?? []), def.dictionary].join(", "))})</i> `
      : "";
    return `<li data-dictionary="${escapeHtml(def.dictionary)}">${prefix}<span>${html}</span></li>`;
  });
  return wrap(`<ol>${lis.join("")}</ol>`);
}

/** Block-level tags get their own container (View); everything else is inline (Text). */
export const BLOCK_TAGS = new Set([
  "div",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "details",
  "summary",
]);

export const LIST_TAGS = new Set(["ul", "ol"]);

export type NodeKind = "inline" | "block";

export function classify(node: SCContent): NodeKind {
  if (node === null || node === undefined) return "inline";
  if (typeof node === "string") return "inline";
  if (Array.isArray(node)) return "block";
  if (typeof node === "object" && typeof node.tag === "string") {
    return BLOCK_TAGS.has(node.tag) ? "block" : "inline";
  }
  return "inline";
}

/** Normalize a node's `content` to a flat array of children. */
export function toChildArray(content: SCContent): SCContent[] {
  if (content === null || content === undefined) return [];
  if (Array.isArray(content)) return content;
  return [content];
}

/**
 * Group a list of children into runs of consecutive inline nodes vs standalone block
 * nodes — the standard approach for laying out mixed inline/block content in RN
 * (consecutive inline children share one <Text>; block children stand alone).
 */
export function groupChildren(
  children: SCContent[],
): Array<{ kind: NodeKind; nodes: SCContent[] }> {
  const groups: Array<{ kind: NodeKind; nodes: SCContent[] }> = [];
  for (const child of children) {
    const kind = classify(child);
    if (kind === "block") {
      groups.push({ kind: "block", nodes: [child] });
    } else {
      const last = groups[groups.length - 1];
      if (last && last.kind === "inline") {
        last.nodes.push(child);
      } else {
        groups.push({ kind: "inline", nodes: [child] });
      }
    }
  }
  return groups;
}

/** Bullet string for a list item, derived from CSS listStyleType (default '•'). */
export function getListBullet(
  listStyleType: unknown,
  ordered: boolean,
  index: number,
): string {
  if (ordered) return `${index + 1}.`;
  if (typeof listStyleType !== "string") return "•";
  // strip surrounding quotes used for literal markers e.g. "'➡️ '"
  const literal = listStyleType.replace(/^['"]|['"]$/g, "").trim();
  switch (literal) {
    case "":
    case "disc":
    case "circle":
    case "square":
    case "none":
      return literal === "none" ? "" : "•";
    default:
      return literal; // custom marker (often an emoji)
  }
}

const PERCENT_FONT_BASE = 14; // RN base font px used when SC gives a percentage size

/**
 * Map a structured-content `style` object to an RN text/view style object.
 * Only the subset that matters for readable definitions is mapped; the rest is ignored.
 */
export function mapStyleToRN(
  style: SCStyle | undefined,
): Record<string, unknown> {
  if (!style) return {};
  const out: Record<string, unknown> = {};

  if (style.fontStyle === "italic") out.fontStyle = "italic";
  if (style.fontWeight === "bold") out.fontWeight = "bold";
  if (typeof style.color === "string") out.color = style.color;
  if (typeof style.textAlign === "string") out.textAlign = style.textAlign;

  if (typeof style.fontSize === "string") {
    const fs = style.fontSize.trim();
    const pct = /^(\d+(?:\.\d+)?)%$/.exec(fs);
    if (pct) {
      out.fontSize = Math.round((Number(pct[1]) / 100) * PERCENT_FONT_BASE);
    } else {
      const px = /^(\d+(?:\.\d+)?)px$/.exec(fs);
      if (px) out.fontSize = Number(px[1]);
    }
  }

  const tdl = style.textDecorationLine;
  if (typeof tdl === "string" && tdl !== "none") {
    out.textDecorationLine = tdl;
  } else if (Array.isArray(tdl) && tdl.length > 0) {
    // RN accepts 'underline line-through' etc.
    out.textDecorationLine = tdl.join(" ");
  }

  return out;
}
