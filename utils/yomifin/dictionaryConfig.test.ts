/*
 * Regression guard for the pure per-dictionary config reconciler + the popup selection
 * model (both RN-free). Run: bun utils/yomifin/dictionaryConfig.test.ts
 */
import {
  DICTIONARY_TINT_PALETTE,
  type DictionaryConfig,
  defaultTint,
  enabledTitlesInOrder,
  materializeConfig,
  resolveDictionaryConfig,
  tintMap,
} from "./dictionaryConfig";
import type { LookupResult } from "./lookup";
import { selectionEquals, selectionGlossary } from "./selection";

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

// --- resolveDictionaryConfig ---------------------------------------------------

// No config: all enabled, installed order preserved, stable default tints.
{
  const r = resolveDictionaryConfig(["A", "B", "C"], {});
  check(
    "no-config keeps installed order",
    r.map((x) => x.title).join(",") === "A,B,C",
  );
  check(
    "no-config all enabled",
    r.every((x) => x.enabled),
  );
  check(
    "no-config orders are 0..n",
    r.map((x) => x.order).join(",") === "0,1,2",
  );
  check("no-config tint is stable default", r[0].tint === defaultTint("A"));
}

// Config sets an explicit priority order that overrides installed (alphabetical) order.
{
  const config: DictionaryConfig = {
    A: { enabled: true, order: 2, tint: "#111111" },
    B: { enabled: false, order: 0, tint: "#222222" },
    C: { enabled: true, order: 1, tint: "#333333" },
  };
  const r = resolveDictionaryConfig(["A", "B", "C"], config);
  check("config order wins", r.map((x) => x.title).join(",") === "B,C,A");
  check(
    "config keeps disabled flag",
    r.find((x) => x.title === "B")?.enabled === false,
  );
  check(
    "config keeps custom tint",
    r.find((x) => x.title === "A")?.tint === "#111111",
  );
  check(
    "enabledTitlesInOrder filters + orders",
    enabledTitlesInOrder(r).join(",") === "C,A",
  );
}

// New (uninstalled-in-config) dictionaries append after configured ones.
{
  const config: DictionaryConfig = {
    B: { enabled: true, order: 0, tint: "#222222" },
  };
  const r = resolveDictionaryConfig(["A", "B", "C"], config);
  check(
    "new dicts append after configured",
    r.map((x) => x.title).join(",") === "B,A,C",
  );
}

// Config entries for uninstalled dictionaries are ignored.
{
  const config: DictionaryConfig = {
    GONE: { enabled: true, order: 0, tint: "#000000" },
    A: { enabled: true, order: 1, tint: "#111111" },
  };
  const r = resolveDictionaryConfig(["A"], config);
  check("uninstalled config ignored", r.length === 1 && r[0].title === "A");
}

// materialize round-trips.
{
  const r = resolveDictionaryConfig(["A", "B"], {});
  const m = materializeConfig(r);
  const r2 = resolveDictionaryConfig(["A", "B"], m);
  check(
    "materialize round-trips order",
    r.map((x) => x.title).join(",") === r2.map((x) => x.title).join(","),
  );
  check("tintMap covers all titles", Object.keys(tintMap(r)).length === 2);
}

check(
  "defaultTint is from the palette",
  DICTIONARY_TINT_PALETTE.includes(defaultTint("SomeDict")),
);

// --- selection model -----------------------------------------------------------

const sampleResult: LookupResult = {
  matchedLength: 2,
  matchedText: "猫",
  entries: [
    {
      term: "猫",
      reading: "ねこ",
      wordClasses: [],
      inflectionChain: [],
      definitions: [
        { dictionary: "DictA", tags: [], glossary: ["cat", "feline"] },
        { dictionary: "DictB", tags: [], glossary: ["a cat (animal)"] },
      ],
    },
  ],
};

check("selectionEquals(null,null)", selectionEquals(null, null));
check(
  "selectionEquals same definition",
  selectionEquals(
    { kind: "definition", paneIndex: 0, dictionary: "DictA", glossIndex: 1 },
    { kind: "definition", paneIndex: 0, dictionary: "DictA", glossIndex: 1 },
  ),
);
check(
  "selectionEquals differs on glossIndex",
  !selectionEquals(
    { kind: "definition", paneIndex: 0, dictionary: "DictA", glossIndex: 0 },
    { kind: "definition", paneIndex: 0, dictionary: "DictA", glossIndex: 1 },
  ),
);

check(
  "selectionGlossary(null) = []",
  selectionGlossary(sampleResult, null).length === 0,
);
check(
  "selectionGlossary dictionary = whole block",
  JSON.stringify(
    selectionGlossary(sampleResult, {
      kind: "dictionary",
      paneIndex: 0,
      dictionary: "DictA",
    }),
  ) === JSON.stringify(["cat", "feline"]),
);
check(
  "selectionGlossary definition = one item",
  JSON.stringify(
    selectionGlossary(sampleResult, {
      kind: "definition",
      paneIndex: 0,
      dictionary: "DictA",
      glossIndex: 1,
    }),
  ) === JSON.stringify(["feline"]),
);
check(
  "selectionGlossary unresolved dict = []",
  selectionGlossary(sampleResult, {
    kind: "dictionary",
    paneIndex: 0,
    dictionary: "Missing",
  }).length === 0,
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
