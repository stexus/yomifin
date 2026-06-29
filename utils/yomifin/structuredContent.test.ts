/*
 * Regression guard for the pure structured-content helpers (RN-free).
 * Run: bun utils/yomifin/structuredContent.test.ts
 *
 * If ./JMdict.zip is present, also walks real JMdict glossary trees to ensure the
 * classifier/normalizer never throw on real data (the zip is gitignored).
 */
import { existsSync, readFileSync } from "node:fs";
import {
  classify,
  getListBullet,
  groupChildren,
  mapStyleToRN,
  normalizeGlossary,
  type SCContent,
  toChildArray,
} from "./structuredContent";

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

// classify
check("classify string = inline", classify("hi") === "inline");
check(
  "classify span = inline",
  classify({ tag: "span", content: "x" }) === "inline",
);
check("classify ul = block", classify({ tag: "ul", content: [] }) === "block");
check("classify array = block", classify(["a", "b"]) === "block");

// toChildArray
check("toChildArray single → [single]", toChildArray("x").length === 1);
check("toChildArray array passthrough", toChildArray(["a", "b"]).length === 2);
check("toChildArray null → []", toChildArray(null).length === 0);

// groupChildren: inline runs coalesce, blocks stand alone
const grouped = groupChildren([
  "a",
  { tag: "span", content: "b" },
  { tag: "ul", content: [] },
  "c",
]);
check(
  "groupChildren coalesces inline runs around blocks",
  grouped.length === 3 &&
    grouped[0].kind === "inline" &&
    grouped[0].nodes.length === 2 &&
    grouped[1].kind === "block" &&
    grouped[2].kind === "inline",
  JSON.stringify(grouped.map((g) => [g.kind, g.nodes.length])),
);

// getListBullet
check("bullet disc → •", getListBullet("disc", false, 0) === "•");
check("bullet circle → •", getListBullet("circle", false, 0) === "•");
check("bullet none → empty", getListBullet("none", false, 0) === "");
check("bullet literal '➡️ ' preserved", getListBullet("'➡️ '", false, 0) === "➡️");
check("bullet ordered → 1.", getListBullet(undefined, true, 0) === "1.");
check("bullet default → •", getListBullet(undefined, false, 0) === "•");

// mapStyleToRN
check(
  "style italic+bold",
  (() => {
    const s = mapStyleToRN({ fontStyle: "italic", fontWeight: "bold" });
    return s.fontStyle === "italic" && s.fontWeight === "bold";
  })(),
);
check(
  "style fontSize 65% → 9px",
  mapStyleToRN({ fontSize: "65%" }).fontSize === 9,
);
check(
  "style color passthrough",
  mapStyleToRN({ color: "#abc" }).color === "#abc",
);
check(
  "style decoration array joined",
  mapStyleToRN({ textDecorationLine: ["underline", "line-through"] })
    .textDecorationLine === "underline line-through",
);
check("style empty → {}", Object.keys(mapStyleToRN(undefined)).length === 0);

// normalizeGlossary (glossary wrapper shapes)
check("normalize string passthrough", normalizeGlossary("hi") === "hi");
check(
  "normalize {type:text}",
  normalizeGlossary({ type: "text", text: "a def" }) === "a def",
);
check(
  "normalize {type:image} → null",
  normalizeGlossary({ type: "image", path: "x" }) === null,
);
check(
  "normalize {type:structured-content} → inner tree",
  (() => {
    const inner = { tag: "ul", content: [] };
    return (
      normalizeGlossary({ type: "structured-content", content: inner }) ===
      inner
    );
  })(),
);
check(
  "normalize real SC node passthrough (has tag)",
  (() => {
    const n = { tag: "span", content: "x" };
    return normalizeGlossary(n) === n;
  })(),
);

// Real-data walk (optional)
if (existsSync("./JMdict.zip")) {
  // lazy import to avoid requiring fflate when zip absent
  const { unzipSync, strFromU8 } = await import("fflate");
  const zip = unzipSync(new Uint8Array(readFileSync("./JMdict.zip")));
  const bank = JSON.parse(strFromU8(zip["term_bank_1.json"])) as unknown[][];
  let nodes = 0;
  const walk = (n: SCContent) => {
    nodes++;
    classify(n);
    if (typeof n === "object" && n !== null && !Array.isArray(n)) {
      mapStyleToRN(n.style);
      for (const g of groupChildren(toChildArray(n.content)))
        for (const c of g.nodes) walk(c);
    } else if (Array.isArray(n)) {
      for (const g of groupChildren(n)) for (const c of g.nodes) walk(c);
    }
  };
  try {
    let scItems = 0;
    let nonNullNormalized = 0;
    for (const e of bank.slice(0, 5000)) {
      for (const item of e[5] as unknown[]) {
        // exercise the real glossary-item normalize path (wrappers included)
        const tree = normalizeGlossary(item);
        if (tree !== null && tree !== undefined) nonNullNormalized++;
        if (
          typeof item === "object" &&
          item !== null &&
          (item as { type?: string }).type === "structured-content"
        ) {
          scItems++;
        }
        walk(tree);
      }
    }
    check(
      `real JMdict normalize+walk (${nodes} nodes; ${scItems} SC items, ${nonNullNormalized} non-null)`,
      scItems > 0 && nonNullNormalized > 0,
    );
  } catch (err) {
    check("real JMdict walk", false, String(err));
  }
} else {
  console.log("  SKIP  real JMdict walk (./JMdict.zip not present)");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
