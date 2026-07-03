/*
 * Profiles (JA/ZH bundles) — pure resolution logic.
 *   - legacy single-profile keys ARE the JA profile (no-migration design)
 *   - profile map shadows legacy once written
 *   - zh starts empty; language tag → profile mapping (auto-select seam)
 *
 * Run: bun utils/yomifin/profiles.test.ts
 */
import type { AnkiConfig } from "./ankiConfig";
import {
  activeProfileId,
  profileIdForLanguageTag,
  resolveProfile,
  withProfileData,
} from "./profiles";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}  got=${JSON.stringify(got)}`);
  }
}

const legacyDict = { JMdict: { enabled: true, order: 0, tint: "#6cb6ff" } };
const legacyAnki = { deckName: "Testing" } as unknown as AnkiConfig;
const zhAnki = { deckName: "Hanzi" } as unknown as AnkiConfig;

// --- legacy fallback: ja resolves from the old keys when no profile entry ------
{
  const s = {
    yomifinDictionaryConfig: legacyDict,
    yomifinAnkiConfig: legacyAnki,
  };
  const ja = resolveProfile(s, "ja");
  check(
    "ja falls back to legacy keys",
    ja.dictionaryConfig === legacyDict &&
      ja.ankiConfig === legacyAnki &&
      ja.language === "ja",
    ja,
  );
  const zh = resolveProfile(s, "zh");
  check(
    "zh never reads legacy keys",
    Object.keys(zh.dictionaryConfig).length === 0 &&
      zh.ankiConfig === null &&
      zh.language === "zh",
    zh,
  );
}

// --- profile map shadows legacy ------------------------------------------------
{
  const jaDict = { JMdict: { enabled: false, order: 0, tint: "#fff" } };
  const s = {
    yomifinDictionaryConfig: legacyDict,
    yomifinAnkiConfig: legacyAnki,
    yomifinProfiles: {
      ja: { dictionaryConfig: jaDict },
      zh: { ankiConfig: zhAnki },
    },
  };
  const ja = resolveProfile(s, "ja");
  check(
    "ja profile map shadows legacy dict, keeps legacy anki",
    ja.dictionaryConfig === jaDict && ja.ankiConfig === legacyAnki,
    ja,
  );
  const zh = resolveProfile(s, "zh");
  check(
    "zh profile anki resolves, dict defaults empty",
    zh.ankiConfig === zhAnki && Object.keys(zh.dictionaryConfig).length === 0,
    zh,
  );
}

// --- active profile ------------------------------------------------------------
check("active defaults to ja", activeProfileId({}) === "ja");
check(
  "active honors zh",
  activeProfileId({ yomifinActiveProfile: "zh" }) === "zh",
);

// --- language-tag mapping (auto-select) -----------------------------------------
const tagCases: [string | null | undefined, string | null][] = [
  ["jpn", "ja"],
  ["ja", "ja"],
  ["ja-JP", "ja"],
  ["zho", "zh"],
  ["chi", "zh"],
  ["zh", "zh"],
  ["zh-Hant", "zh"],
  ["cmn", "zh"],
  ["yue", "zh"],
  ["eng", null],
  ["", null],
  [null, null],
  [undefined, null],
];
for (const [tag, expected] of tagCases) {
  const got = profileIdForLanguageTag(tag);
  check(`tag ${JSON.stringify(tag)} → ${expected}`, got === expected, got);
}

// --- withProfileData merge -----------------------------------------------------
{
  const base = { zh: { ankiConfig: zhAnki } };
  const next = withProfileData(base, "zh", { dictionaryConfig: legacyDict });
  check(
    "withProfileData merges without dropping siblings",
    next.zh?.ankiConfig === zhAnki && next.zh?.dictionaryConfig === legacyDict,
    next,
  );
  const fresh = withProfileData(undefined, "ja", { ankiConfig: legacyAnki });
  check(
    "withProfileData handles empty map",
    fresh.ja?.ankiConfig === legacyAnki,
    fresh,
  );
}

console.log(`\n${pass}/${pass + fail} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
