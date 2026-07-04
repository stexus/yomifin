/*
 * Regression guard for the Anki settings export/import schema (pure —
 * ankiSettingsTransfer.ts; the share-sheet/document-picker driver lives in the
 * Settings → Anki screen and is device-tested).
 * Run: bun utils/yomifin/ankiSettingsTransfer.test.ts
 */

import type { AnkiConfig } from "./ankiConfig";
import {
  applyAnkiSettingsImport,
  buildAnkiSettingsExport,
  parseAnkiSettingsExport,
  serializeAnkiSettings,
} from "./ankiSettingsTransfer";
import type { ProfileSettingsSource } from "./profiles";

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

const jaConfig = {
  url: "http://10.0.0.193:8765",
  deckName: "Mining",
  modelName: "Lapis-Jp",
  fieldTemplates: { Expression: "{expression}" },
  tags: ["yomifin"],
  allowDuplicate: false,
  htmlGlossary: true,
  wordAudioSources: [{ type: "jpod101", enabled: true }],
} as AnkiConfig;

const zhConfig = {
  ...jaConfig,
  deckName: "Hanzi",
  modelName: "Lapis-Zh",
} as AnkiConfig;

// --- export shape -----------------------------------------------------------------------

{
  // JA stored under the LEGACY key (no-migration design) — export must see it.
  const settings: ProfileSettingsSource = {
    yomifinAnkiConfig: jaConfig,
    yomifinProfiles: { zh: { ankiConfig: zhConfig } },
  };
  const doc = buildAnkiSettingsExport(
    settings,
    new Date("2026-07-03T00:00:00Z"),
  );
  check(
    "export type/version",
    doc.type === "yomifin-anki-settings" && doc.version === 1,
  );
  check("export exportedAt", doc.exportedAt === "2026-07-03T00:00:00.000Z");
  check(
    "export includes legacy-key JA + profile-map ZH",
    doc.profiles.ja?.deckName === "Mining" &&
      doc.profiles.zh?.deckName === "Hanzi",
  );
}

{
  // Unconfigured profiles are omitted; an empty install still exports (empty profiles).
  const doc = buildAnkiSettingsExport({});
  check(
    "empty install exports no profiles",
    Object.keys(doc.profiles).length === 0,
  );
}

// --- serialize → parse round-trip ----------------------------------------------------------

{
  const settings: ProfileSettingsSource = {
    yomifinProfiles: {
      ja: { ankiConfig: jaConfig },
      zh: { ankiConfig: zhConfig },
    },
  };
  const parsed = parseAnkiSettingsExport(serializeAnkiSettings(settings));
  check(
    "round-trip preserves both profiles",
    JSON.stringify(parsed.ja) === JSON.stringify(jaConfig) &&
      JSON.stringify(parsed.zh) === JSON.stringify(zhConfig),
  );
}

// --- parse validation ----------------------------------------------------------------------

function throwsWith(json: string, needle: string): boolean {
  try {
    parseAnkiSettingsExport(json);
    return false;
  } catch (e) {
    return (e as Error).message.includes(needle);
  }
}

check("parse rejects non-JSON", throwsWith("not json", "Not valid JSON"));
check(
  "parse rejects wrong type",
  throwsWith(
    '{"type":"other","version":1,"profiles":{"ja":{}}}',
    "Not a yomifin",
  ),
);
check(
  "parse rejects future version",
  throwsWith(
    '{"type":"yomifin-anki-settings","version":2,"profiles":{"ja":{}}}',
    "Unsupported export version",
  ),
);
check(
  "parse rejects empty profiles",
  throwsWith(
    '{"type":"yomifin-anki-settings","version":1,"profiles":{}}',
    "no profile settings",
  ),
);
check(
  "parse drops unknown profile keys",
  (() => {
    const out = parseAnkiSettingsExport(
      `{"type":"yomifin-anki-settings","version":1,"profiles":{"ja":${JSON.stringify(jaConfig)},"ko":{"deckName":"x"}}}`,
    );
    return out.ja !== undefined && !("ko" in out);
  })(),
);

// --- applyAnkiSettingsImport merge semantics -------------------------------------------------

{
  const existing = {
    ja: {
      dictionaryConfig: { JMdict: { enabled: true, order: 0, tint: "#fff" } },
    },
  } as Parameters<typeof applyAnkiSettingsImport>[0];
  const next = applyAnkiSettingsImport(existing, { ja: jaConfig });
  check(
    "import merges ankiConfig, preserves dictionaryConfig",
    next?.ja?.ankiConfig?.deckName === "Mining" &&
      JSON.stringify(next?.ja?.dictionaryConfig) ===
        JSON.stringify(existing?.ja?.dictionaryConfig),
  );
  check("import leaves absent profiles untouched", next?.zh === undefined);

  const both = applyAnkiSettingsImport(null, { ja: jaConfig, zh: zhConfig });
  check(
    "import into empty map creates both profiles",
    both?.ja?.ankiConfig?.deckName === "Mining" &&
      both?.zh?.ankiConfig?.deckName === "Hanzi",
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
