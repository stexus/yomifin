/*
 * Phase 8 — sense-level (fine-grained) selection inside ONE glossary item.
 *
 * Many dictionaries (e.g. JMdict) pack ALL of a word's senses into a SINGLE
 * structured-content blob — one glossary item holding a nested <ol>/<ul> of senses —
 * so Phase 7's item-level selection can only select the whole tree. This module finds
 * the individually-selectable "sense" nodes inside such a tree and addresses them by
 * PATH (index chain through the tree), so the renderer can make them tappable and the
 * marker engine can flatten exactly one sense.
 *
 * Two tiers, tried in order (both degrade gracefully — never fail):
 *
 * STRUCTURAL (senseTargets — paths into the SC tree):
 *   1. The first <ol>/<ul> with ≥2 items reachable through block containers → its
 *      <li> children are the sense targets (the JMdict shape).
 *   2. Otherwise, if the root has ≥2 top-level BLOCK children → each is a target.
 *
 * TEXTUAL (senseSegments — for dictionaries that pack all senses into ONE text blob
 * where boundaries are glyphs, e.g. ㊀㊁… or ①②… lines separated by <br>/\n — the
 * 三省堂/新明解 shape). Only consulted when the structural tier finds nothing:
 *   3. Locate the item's top-level INLINE sequence (descending through single-block
 *      wrappers), split it into LINES at <br> / "\n" / before circled sense glyphs,
 *      then group lines into senses: ≥2 marker-prefixed lines → each starts a segment
 *      (continuation lines attach to the previous); else ≥2 plain lines → one segment
 *      per line. Splitting happens on the TREE (not flattened text) so styling/ruby
 *      survive rendering. Segments are addressed by INDEX and re-derived at resolve
 *      time (selection is ephemeral per popup, so this can't dangle).
 *   4. Otherwise (single line / unrecognized layout) → NO sense granularity; the
 *      coarse Phase 7 selection (whole item / whole dictionary block) remains.
 *
 * Path semantics (must match components/yomifin/StructuredContent.tsx):
 *   each step indexes into the node's children, where children =
 *     - the elements themselves, if the node is an array
 *     - toChildArray(node.content), if the node is an SCNode
 *   starting from normalizeGlossary(item).
 */
import {
  classify,
  LIST_TAGS,
  normalizeGlossary,
  type SCContent,
  type SCNode,
  scToText,
  toChildArray,
} from "./structuredContent";

export type SensePath = number[];

export function serializePath(path: SensePath): string {
  return path.join(".");
}

/** A node's children under the path semantics above. */
function childrenOf(node: SCContent): SCContent[] {
  if (node === null || node === undefined || typeof node === "string")
    return [];
  if (Array.isArray(node)) return node;
  return toChildArray((node as SCNode).content);
}

/**
 * Walk `path` down a glossary item's tree. Returns the subtree, or undefined if the
 * path no longer resolves (callers treat that as "no selection" and fall back).
 */
export function subtreeAtPath(
  item: unknown,
  path: SensePath,
): SCContent | undefined {
  let node: SCContent = normalizeGlossary(item);
  for (const idx of path) {
    const kids = childrenOf(node);
    if (idx < 0 || idx >= kids.length) return undefined;
    node = kids[idx];
  }
  return node;
}

/** Don't chase lists arbitrarily deep — senses live near the top of real dicts. */
const MAX_LIST_SEARCH_DEPTH = 4;

/** DFS for the first ol/ul with ≥2 children, descending only through block nodes. */
function findSenseList(
  node: SCContent,
  path: SensePath,
  depth: number,
): { path: SensePath; node: SCNode } | null {
  if (node === null || node === undefined || typeof node === "string")
    return null;
  if (!Array.isArray(node)) {
    const el = node as SCNode;
    if (typeof el.tag === "string" && LIST_TAGS.has(el.tag)) {
      return toChildArray(el.content).length >= 2 ? { path, node: el } : null;
    }
    if (classify(el) !== "block") return null; // don't descend into inline runs
  }
  if (depth >= MAX_LIST_SEARCH_DEPTH) return null;
  const kids = childrenOf(node);
  for (let i = 0; i < kids.length; i++) {
    const found = findSenseList(kids[i], [...path, i], depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * The selectable sense paths for one glossary item. Empty array = no sub-item
 * granularity available (selection stays at the Phase 7 coarse level).
 */
export function senseTargets(item: unknown): SensePath[] {
  const root = normalizeGlossary(item);
  if (root === null || root === undefined || typeof root === "string")
    return [];

  const list = findSenseList(root, [], 0);
  if (list) {
    return childrenOf(list.node).map((_, i) => [...list.path, i]);
  }

  // Fallback: ≥2 top-level block children → each is a target.
  const kids = childrenOf(root);
  const blockIndices: number[] = [];
  for (let i = 0; i < kids.length; i++) {
    if (classify(kids[i]) === "block") blockIndices.push(i);
  }
  if (blockIndices.length >= 2) return blockIndices.map((i) => [i]);
  return [];
}

// ---------------------------------------------------------------------------------
// Textual segmentation (tier 2) — blob dictionaries with glyph-marked senses.
// ---------------------------------------------------------------------------------

/**
 * Circled/enclosed sense glyphs (㊀-㊉ ㊀…, ①-⑳ ①…, ㉑-㉟ ㉑…, ㊱-㊿ ㊱…,
 * ⑴-⒇ ⑴…, ⒈-⒛ ⒈…, ❶-❿ ❶…, ⓫-⓴ ⓫…). These never appear in prose, so
 * splitting a string BEFORE any occurrence is safe even mid-line.
 */
const CIRCLED_GLYPH =
  "\u3280-\u3289\u2460-\u2473\u3251-\u325f\u32b1-\u32bf\u2474-\u2487\u2488-\u249b\u2776-\u277f\u24eb-\u24f4";
const CIRCLED_SPLIT_RE = new RegExp(`(?=[${CIRCLED_GLYPH}])`);

/**
 * "This line starts a new sense": a circled glyph, a bracketed number ((1) （1） [1]
 * 【1】 〔1〕), a number + separator (1. 1) 1、), or a kanji numeral + 、. Only ever
 * tested at line starts (except circled glyphs, which also split mid-line above).
 */
const LINE_MARKER_RE = new RegExp(
  `^\\s*(?:[${CIRCLED_GLYPH}]|[（(〔\\[【]?[0-9０-９]{1,2}[)）〕\\]】]|[0-9０-９]{1,2}[.)．）、]|[一二三四五六七八九十]{1,3}、)`,
);

const MAX_WRAPPER_DEPTH = 4;

/**
 * The item's top-level inline sequence: the children of the (possibly wrapped) single
 * container whose children are all inline (strings / spans / br…). null when the tree
 * has sibling blocks (that's the structural tier's territory) or is unrecognizable.
 */
function findInlineSequence(
  node: SCContent,
  depth: number,
): SCContent[] | null {
  if (node === null || node === undefined) return null;
  if (typeof node === "string") return [node];
  if (!Array.isArray(node) && classify(node) === "inline") return [node];
  const kids = childrenOf(node);
  const blocks = kids.filter((k) => classify(k) === "block");
  if (blocks.length === 0) return kids; // pure inline sequence
  if (blocks.length === 1 && kids.length === 1 && depth < MAX_WRAPPER_DEPTH) {
    return findInlineSequence(kids[0], depth + 1); // single wrapper → descend
  }
  return null;
}

function hasText(node: SCContent): boolean {
  return scToText(node).trim() !== "";
}

/** Split an inline sequence into LINES at <br>, "\n", and before circled glyphs. */
function splitLines(seq: SCContent[]): SCContent[][] {
  const lines: SCContent[][] = [];
  let cur: SCContent[] = [];
  const endLine = () => {
    if (cur.some(hasText)) lines.push(cur);
    cur = [];
  };
  for (const node of seq) {
    if (typeof node === "string") {
      const pieces = node.split("\n").flatMap((p) => p.split(CIRCLED_SPLIT_RE));
      pieces.forEach((piece, i) => {
        if (i > 0) endLine();
        if (piece) cur.push(piece);
      });
    } else if ((node as SCNode)?.tag === "br") {
      endLine();
    } else {
      cur.push(node);
    }
  }
  endLine();
  return lines;
}

/**
 * Diagnostic: true when an item's flattened text clearly contains ≥2 sense glyphs.
 * The popup logs the raw item shape when BOTH tiers come up empty despite this, so
 * an unhandled dictionary layout can be diagnosed from device logs and the heuristic
 * extended from evidence.
 */
export function looksLikeMissedSenses(item: unknown): boolean {
  const text = scToText(normalizeGlossary(item));
  const matches = text.match(new RegExp(`[${CIRCLED_GLYPH}]`, "g"));
  return (matches?.length ?? 0) >= 2;
}

/**
 * Textual sense segments for one glossary item (tier 2 — call only when
 * senseTargets() is empty). Each segment is renderable SCContent (an inline-node
 * array; multi-line segments keep "\n" separators). [] = no textual granularity.
 */
export function senseSegments(item: unknown): SCContent[] {
  const root = normalizeGlossary(item);
  if (root === null || root === undefined) return [];
  const seq = findInlineSequence(root, 0);
  if (!seq) return [];
  const lines = splitLines(seq);

  const isMarkerLine = lines.map((line) =>
    LINE_MARKER_RE.test(line.map(scToText).join("").trimStart()),
  );
  const markerCount = isMarkerLine.filter(Boolean).length;

  let groups: SCContent[][][];
  if (markerCount >= 2) {
    // Marker lines start senses; continuation lines attach to the previous one.
    groups = [];
    for (let i = 0; i < lines.length; i++) {
      if (isMarkerLine[i] || groups.length === 0) groups.push([lines[i]]);
      else groups[groups.length - 1].push(lines[i]);
    }
  } else if (lines.length >= 2) {
    groups = lines.map((line) => [line]); // no markers: one segment per line
  } else {
    return [];
  }
  if (groups.length < 2) return [];

  return groups.map((group) =>
    group.flatMap((line, i) => (i === 0 ? line : ["\n", ...line])),
  );
}
