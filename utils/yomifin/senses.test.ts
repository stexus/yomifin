/*
 * Regression guard for Phase 8 sense-level selection (pure, RN-free): sense-boundary
 * detection inside one glossary item's structured-content tree, path resolution, and
 * the sense case of selectionGlossary/flattenSelectionText.
 * Run: bun utils/yomifin/senses.test.ts
 */
import type { LookupResult } from "./lookup";
import { flattenSelectionText, selectionGlossary } from "./selection";
import {
  senseSegments,
  senseTargets,
  serializePath,
  subtreeAtPath,
} from "./senses";
import { scToText } from "./structuredContent";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
}

// --- JMdict shape: one wrapper item, all senses in a nested <ol> --------------------

const jmdictItem = {
  type: "structured-content",
  content: [
    {
      tag: "ol",
      content: [
        { tag: "li", content: "to read" },
        { tag: "li", content: "to recite" },
        { tag: "li", content: "to guess; to predict" },
      ],
    },
    { tag: "div", content: "JMdict attribution" },
  ],
};

{
  const targets = senseTargets(jmdictItem);
  check("jmdict: 3 sense targets", targets.length === 3);
  check(
    "jmdict: paths point into the ol",
    targets.map(serializePath).join("|") === "0.0|0.1|0.2",
    targets.map(serializePath).join("|"),
  );
  const sub = subtreeAtPath(jmdictItem, [0, 2]) as { content?: unknown };
  check(
    "jmdict: subtree is the 3rd li",
    sub?.content === "to guess; to predict",
  );
}

// --- list at the ROOT (no wrapper array) ---------------------------------------------

{
  const rootList = {
    tag: "ul",
    content: [
      { tag: "li", content: "sense A" },
      { tag: "li", content: "sense B" },
    ],
  };
  const targets = senseTargets(rootList);
  check("root list: 2 targets", targets.length === 2);
  check(
    "root list: paths are direct indices",
    targets.map(serializePath).join("|") === "0|1",
  );
}

// --- fallback: no list, ≥2 top-level blocks ------------------------------------------

{
  const blocks = {
    type: "structured-content",
    content: [
      { tag: "div", content: "first definition" },
      { tag: "div", content: "second definition" },
      "inline stray",
    ],
  };
  const targets = senseTargets(blocks);
  check("block fallback: 2 targets (blocks only)", targets.length === 2);
  check(
    "block fallback: inline child skipped",
    targets.map(serializePath).join("|") === "0|1",
  );
}

// --- resilience: shapes with NO sense granularity ------------------------------------

check("plain string: no targets", senseTargets("just text").length === 0);
check(
  "single inline run: no targets",
  senseTargets({ type: "structured-content", content: "one line" }).length ===
    0,
);
check(
  "single block child: no targets",
  senseTargets({
    type: "structured-content",
    content: [{ tag: "div", content: "only one" }],
  }).length === 0,
);
check(
  "1-item list: no targets (nothing to isolate)",
  senseTargets({
    tag: "ol",
    content: [{ tag: "li", content: "single" }],
  }).length === 0,
);
check("null-ish content survives", senseTargets(null).length === 0);
check(
  "dangling path resolves to undefined",
  subtreeAtPath(jmdictItem, [0, 99]) === undefined,
);

// --- selectionGlossary / flattenSelectionText with kind:"sense" ----------------------

const sampleResult = {
  matchedLength: 2,
  matchedText: "読む",
  entries: [
    {
      term: "読む",
      reading: "よむ",
      wordClasses: [],
      inflectionChain: [],
      definitions: [{ dictionary: "JMdict", tags: [], glossary: [jmdictItem] }],
    },
  ],
} as unknown as LookupResult;

{
  const sel = {
    kind: "sense" as const,
    paneIndex: 0,
    dictionary: "JMdict",
    glossIndex: 0,
    path: [0, 1],
  };
  const items = selectionGlossary(sampleResult, sel);
  check("selectionGlossary sense: one subtree", items.length === 1);
  check(
    "flattenSelectionText sense: exactly that sense",
    flattenSelectionText(sampleResult, sel) === "to recite",
    JSON.stringify(flattenSelectionText(sampleResult, sel)),
  );
  check(
    "flatten dangling sense path = '' (falls back upstream)",
    flattenSelectionText(sampleResult, { ...sel, path: [9, 9] }) === "",
  );
  check(
    "flatten definition selection: whole item",
    flattenSelectionText(sampleResult, {
      kind: "definition",
      paneIndex: 0,
      dictionary: "JMdict",
      glossIndex: 0,
    }).includes("to read"),
  );
}

// --- TEXTUAL segmentation (tier 2): blob dictionaries with glyph-marked senses -------
// The 三省堂/新明解 shape that structural detection can't see (user-reported case).

const BLOB_TEXT =
  "㊀領地・荘園(ショウエン)の持主。\n㊁〔戦国時代以後の〕大名。\n㊂〔中世ヨーロッパの封建社会で〕騎士として農民を支配した人。";

{
  // Shape 1: plain string with \n separators.
  const segs = senseSegments(BLOB_TEXT);
  check("blob string: 3 segments", segs.length === 3, `got ${segs.length}`);
  check(
    "blob string: segment 2 is exactly ㊁",
    scToText(segs[1]) === "㊁〔戦国時代以後の〕大名。",
    scToText(segs[1] ?? ""),
  );
  check(
    "blob string: structural tier finds nothing",
    senseTargets(BLOB_TEXT).length === 0,
  );
}

{
  // Shape 2: {type:"text"} wrapper.
  const segs = senseSegments({ type: "text", text: BLOB_TEXT });
  check("blob text-wrapper: 3 segments", segs.length === 3);
}

{
  // Shape 3: structured content — div with inline runs separated by <br>.
  const item = {
    type: "structured-content",
    content: {
      tag: "div",
      content: [
        "㊀領地・荘園(ショウエン)の持主。",
        { tag: "br" },
        { tag: "span", content: "㊁〔戦国時代以後の〕大名。" },
        { tag: "br" },
        "㊂〔中世ヨーロッパの封建社会で〕騎士として農民を支配した人。",
      ],
    },
  };
  const segs = senseSegments(item);
  check("blob div+br: 3 segments", segs.length === 3, `got ${segs.length}`);
  check(
    "blob div+br: span styling survives in segment",
    scToText(segs[1]) === "㊁〔戦国時代以後の〕大名。",
  );
}

{
  // Shape 4: all senses on ONE line — split before circled glyphs mid-string.
  const segs = senseSegments("㊀持主。㊁大名。㊂騎士。");
  check("blob one-line: 3 segments via glyph split", segs.length === 3);
  check("blob one-line: first segment", scToText(segs[0]) === "㊀持主。");
}

{
  // Marker grouping: continuation lines attach to the previous marker line.
  const segs = senseSegments(
    "①first sense\ncontinuation of first\n②second sense",
  );
  check("marker grouping: 2 segments", segs.length === 2, `got ${segs.length}`);
  check(
    "marker grouping: continuation kept with ① (newline preserved)",
    scToText(segs[0]) === "①first sense\ncontinuation of first",
    JSON.stringify(scToText(segs[0] ?? "")),
  );
}

{
  // No markers, ≥2 lines → one segment per line.
  const segs = senseSegments("line one\nline two");
  check("plain 2 lines: 2 segments", segs.length === 2);
}

// Resilience: shapes that must yield NO textual segments (coarse selection remains).
check("single line: no segments", senseSegments("ただの一行。").length === 0);
check(
  "structural (JMdict) tree: segmentation stays out",
  senseSegments(jmdictItem).length === 0,
);
check("null: no segments", senseSegments(null).length === 0);
check(
  "numbered ascii markers work too",
  senseSegments("1. read\n2. recite\n3. guess").length === 3,
);

// --- selectionGlossary / flattenSelectionText with kind:"segment" --------------------

const blobResult = {
  matchedLength: 2,
  matchedText: "領主",
  entries: [
    {
      term: "領主",
      reading: "りょうしゅ",
      wordClasses: [],
      inflectionChain: [],
      definitions: [{ dictionary: "新明解", tags: [], glossary: [BLOB_TEXT] }],
    },
  ],
} as unknown as LookupResult;

{
  const sel = {
    kind: "segment" as const,
    paneIndex: 0,
    dictionary: "新明解",
    glossIndex: 0,
    segIndex: 2,
  };
  check(
    "flatten segment selection: exactly ㊂",
    flattenSelectionText(blobResult, sel) ===
      "㊂〔中世ヨーロッパの封建社会で〕騎士として農民を支配した人。",
    flattenSelectionText(blobResult, sel),
  );
  check(
    "segment out of range = [] → '' (falls back upstream)",
    flattenSelectionText(blobResult, { ...sel, segIndex: 99 }) === "",
  );
  check(
    "selectionGlossary segment: one item",
    selectionGlossary(blobResult, sel).length === 1,
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
