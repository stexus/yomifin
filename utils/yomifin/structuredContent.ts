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
