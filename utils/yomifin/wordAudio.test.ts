/*
 * Regression guard for the Phase 8 word-audio SOURCE logic (pure parts only —
 * wordAudioSources.ts; the network driver wordAudio.ts is device-tested).
 * Run: bun utils/yomifin/wordAudio.test.ts
 */

import { seedFieldTemplates } from "./ankiFieldSeeds";
import {
  audioExtensionForMime,
  azureTtsSsml,
  azureTtsUrl,
  azureVoiceLang,
  base64ToBytes,
  bytesToBase64,
  commonsImageInfoUrl,
  customAudioUrl,
  defaultWordAudioSources,
  extractJishoAudioUrl,
  jpod101Url,
  mergeWordAudioSources,
  normalizePinyinReading,
  numberedPinyinSyllable,
  parseCommonsImageInfo,
  parseCustomJsonAudio,
  type WordAudioSourceConfig,
  wiktionaryAudioUrls,
} from "./wordAudioSources";

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

// --- jpod101 URL construction (Yomitan semantics) -------------------------------------

check(
  "jpod101 kanji+kana",
  jpod101Url("読む", "よむ") ===
    "https://assets.languagepod101.com/dictionary/japanese/audiomp3.php?kanji=%E8%AA%AD%E3%82%80&kana=%E3%82%88%E3%82%80",
  jpod101Url("読む", "よむ"),
);
check(
  "jpod101 kana-only term sends kana alone",
  jpod101Url("あっさり", "あっさり") ===
    "https://assets.languagepod101.com/dictionary/japanese/audiomp3.php?kana=%E3%81%82%E3%81%A3%E3%81%95%E3%82%8A",
);
check(
  "jpod101 katakana term counts as kana",
  jpod101Url("イケメン", "イケメン").includes("kana=") &&
    !jpod101Url("イケメン", "イケメン").includes("kanji="),
);

// --- jisho scrape extraction ------------------------------------------------------------

const jishoHtml = `
<div class="concept_light">
  <audio id="audio_読む:よむ" preload="none">
    <source src="//d1vjc5dkcd3yh2.cloudfront.net/audio/abc.mp3" type="audio/mpeg">
    <source src="//d1vjc5dkcd3yh2.cloudfront.net/audio_ogg/abc.ogg" type="audio/ogg">
  </audio>
</div>`;

check(
  "jisho extracts + normalizes protocol-relative src",
  extractJishoAudioUrl(jishoHtml, "読む", "よむ") ===
    "https://d1vjc5dkcd3yh2.cloudfront.net/audio/abc.mp3",
);
check(
  "jisho no match = null",
  extractJishoAudioUrl(jishoHtml, "書く", "かく") === null,
);
check(
  "jisho kana-only anchor fallback",
  extractJishoAudioUrl(
    `<audio id="audio_ねこ"><source src="https://x/y.mp3"></audio>`,
    "猫",
    "ねこ",
  ) === "https://x/y.mp3",
);

// --- custom URL + custom JSON --------------------------------------------------------------

check(
  "custom URL substitution",
  customAudioUrl("https://x/a?k={term}&r={reading}", "読む", "よむ") ===
    "https://x/a?k=%E8%AA%AD%E3%82%80&r=%E3%82%88%E3%82%80",
);
check(
  "custom URL {expression} alias",
  customAudioUrl("https://x/{expression}", "猫", "ねこ") ===
    "https://x/%E7%8C%AB",
);
check(
  "custom JSON audioSourceList",
  JSON.stringify(
    parseCustomJsonAudio(
      '{"type":"audioSourceList","audioSources":[{"url":"https://a/1.mp3"},{"url":"https://a/2.mp3"}]}',
    ),
  ) === JSON.stringify(["https://a/1.mp3", "https://a/2.mp3"]),
);
check(
  "custom JSON bare array of strings",
  JSON.stringify(parseCustomJsonAudio('["https://a/1.mp3"]')) ===
    JSON.stringify(["https://a/1.mp3"]),
);
check(
  "custom JSON garbage = []",
  parseCustomJsonAudio("not json").length === 0,
);
check(
  "custom JSON wrong shape = []",
  parseCustomJsonAudio('{"foo":1}').length === 0,
);

// --- pinyin normalization + numbered syllable --------------------------------------------

check(
  "pinyin normalize lowercase",
  normalizePinyinReading("Zhōngguó") === "zhōngguó",
);
check(
  "pinyin normalize strips separators",
  normalizePinyinReading("nǐ hǎo") === "nǐhǎo" &&
    normalizePinyinReading("xī'ān") === "xīān",
);
check(
  "pinyin normalize u:/v → ü",
  normalizePinyinReading("nu:3") === "nü3" &&
    normalizePinyinReading("nv3") === "nü3",
);
check(
  "pinyin normalize NFC (combining marks)",
  normalizePinyinReading("ni\u030c") === "nǐ",
);
check(
  "non-pinyin reading rejected",
  normalizePinyinReading("ねこ") === "" && normalizePinyinReading("") === "",
);

check("numbered: mǎ → ma3", numberedPinyinSyllable("mǎ") === "ma3");
check("numbered: hǎo → hao3", numberedPinyinSyllable("hǎo") === "hao3");
check(
  "numbered: zhuāng → zhuang1",
  numberedPinyinSyllable("zhuāng") === "zhuang1",
);
check(
  "numbered: multi-syllable (nǐhǎo) rejected",
  numberedPinyinSyllable("nǐhǎo") === null,
);
check(
  "numbered: one mark but two syllables (xièxie) rejected",
  numberedPinyinSyllable("xièxie") === null,
);
check(
  "numbered: toneless (ma) rejected",
  numberedPinyinSyllable("ma") === null,
);

// --- wiktionary (Wikimedia Commons) URLs -----------------------------------------------
// Commons zh files are named by PINYIN (Zh-nǐ.ogg / Zh-māma.ogg / Zh-hao3.ogg), NOT hanzi
// — building zh-你.ogg was the original bug (common words all 404'd).

const fp = (name: string) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}`;

check(
  "wiktionary zh: pinyin (.ogg/.oga) + numbered + hanzi last resort",
  JSON.stringify(wiktionaryAudioUrls("zh", "你", "nǐ")) ===
    JSON.stringify([
      fp("zh-nǐ.ogg"),
      fp("zh-nǐ.oga"),
      fp("zh-ni3.ogg"),
      fp("zh-你.ogg"),
    ]),
  JSON.stringify(wiktionaryAudioUrls("zh", "你", "nǐ")),
);
check(
  "wiktionary zh multi-syllable: no numbered candidate",
  JSON.stringify(wiktionaryAudioUrls("zh", "妈妈", "māma")) ===
    JSON.stringify([fp("zh-māma.ogg"), fp("zh-māma.oga"), fp("zh-妈妈.ogg")]),
  JSON.stringify(wiktionaryAudioUrls("zh", "妈妈", "māma")),
);
check(
  "wiktionary zh non-pinyin reading: hanzi candidate only",
  JSON.stringify(wiktionaryAudioUrls("zh", "你好", "")) ===
    JSON.stringify([fp("zh-你好.ogg")]),
);
check(
  "wiktionary ja: term + reading, kanji-named",
  JSON.stringify(wiktionaryAudioUrls("ja", "猫", "ねこ")) ===
    JSON.stringify([
      fp("ja-猫.ogg"),
      fp("ja-猫.oga"),
      fp("ja-ねこ.ogg"),
      fp("ja-ねこ.oga"),
    ]),
);
check(
  "wiktionary empty term+reading = []",
  wiktionaryAudioUrls("zh", "", "").length === 0,
);

// --- Commons imageinfo API (preferred over blind FilePath probing — one query, no
// 404 storm; Wikimedia was observed 429-ing repeated probe misses) ---------------------

check(
  "commons imageinfo url batches all candidates",
  commonsImageInfoUrl(["zh-nǐ.ogg", "zh-ni3.ogg"]) ===
    `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url&titles=${encodeURIComponent("File:zh-nǐ.ogg|File:zh-ni3.ogg")}`,
);

{
  // Realistic response shape: `normalized` maps our titles to MediaWiki's ucfirst
  // form, `pages` is keyed by pageid (order meaningless), missing files have no
  // imageinfo. Candidate ORDER must be preserved in the output.
  const body = JSON.stringify({
    batchcomplete: "",
    query: {
      normalized: [
        { from: "File:zh-nǐ.ogg", to: "File:Zh-nǐ.ogg" },
        { from: "File:zh-nǐ.oga", to: "File:Zh-nǐ.oga" },
        { from: "File:zh-ni3.ogg", to: "File:Zh-ni3.ogg" },
      ],
      pages: {
        "999": {
          title: "File:Zh-ni3.ogg",
          imageinfo: [{ url: "https://upload.wikimedia.org/x/ni3.ogg" }],
        },
        "-1": { title: "File:Zh-nǐ.oga", missing: "" },
        "123": {
          title: "File:Zh-nǐ.ogg",
          imageinfo: [{ url: "https://upload.wikimedia.org/x/nǐ.ogg" }],
        },
      },
    },
  });
  const names = ["zh-nǐ.ogg", "zh-nǐ.oga", "zh-ni3.ogg"];
  check(
    "commons imageinfo parse: existing urls in candidate order, missing dropped",
    JSON.stringify(parseCommonsImageInfo(body, names)) ===
      JSON.stringify([
        "https://upload.wikimedia.org/x/nǐ.ogg",
        "https://upload.wikimedia.org/x/ni3.ogg",
      ]),
    JSON.stringify(parseCommonsImageInfo(body, names)),
  );
  check(
    "commons imageinfo parse: garbage / wrong shape = []",
    parseCommonsImageInfo("not json", names).length === 0 &&
      parseCommonsImageInfo("{}", names).length === 0,
  );
}

// --- Azure TTS helpers ------------------------------------------------------------------

check(
  "azure url",
  azureTtsUrl("eastasia") ===
    "https://eastasia.tts.speech.microsoft.com/cognitiveservices/v1",
);
check(
  "azure voice lang zh",
  azureVoiceLang("zh-CN-XiaoxiaoNeural") === "zh-CN",
);
check("azure voice lang ja", azureVoiceLang("ja-JP-NanamiNeural") === "ja-JP");
check(
  "azure voice lang 3-letter primary (wuu)",
  azureVoiceLang("wuu-CN-XiaotongNeural") === "wuu-CN",
);
check("azure voice lang garbage → en-US", azureVoiceLang("nope") === "en-US");
check(
  "azure ssml shape + escaping",
  azureTtsSsml("zh-CN-XiaoxiaoNeural", "你<好>&") ===
    "<speak version='1.0' xml:lang='zh-CN'><voice name='zh-CN-XiaoxiaoNeural'>你&lt;好&gt;&amp;</voice></speak>",
  azureTtsSsml("zh-CN-XiaoxiaoNeural", "你<好>&"),
);

// --- per-language defaults + stored-config merge ----------------------------------------

{
  const ja = defaultWordAudioSources("ja");
  const zh = defaultWordAudioSources("zh");
  check(
    "ja defaults lead with jpod101, azure last + disabled",
    ja[0].type === "jpod101" &&
      ja[ja.length - 1].type === "azure-tts" &&
      ja[ja.length - 1].enabled === false,
  );
  check(
    "zh defaults lead with wiktionary(zh) enabled, azure last + disabled",
    zh[0].type === "wiktionary" &&
      zh[0].enabled === true &&
      zh[0].lang === "zh" &&
      zh[zh.length - 1].type === "azure-tts" &&
      zh[zh.length - 1].enabled === false,
  );

  // A config stored BEFORE wiktionary/azure existed keeps its order and settings,
  // and picks the new types up appended with default config.
  const legacy: WordAudioSourceConfig[] = [
    { type: "jisho", enabled: false },
    { type: "jpod101", enabled: true },
    { type: "custom", enabled: true, url: "https://x/{term}" },
  ];
  const merged = mergeWordAudioSources(legacy, ja);
  check(
    "merge keeps stored order/settings, appends new types",
    merged.length === 5 &&
      merged[0].type === "jisho" &&
      merged[0].enabled === false &&
      merged[2].url === "https://x/{term}" &&
      merged[3].type === "wiktionary" &&
      merged[4].type === "azure-tts",
    JSON.stringify(merged),
  );
  check(
    "merge with empty stored = defaults",
    mergeWordAudioSources([], zh) === zh &&
      mergeWordAudioSources(null, zh) === zh,
  );
}

// --- mime / base64 helpers -------------------------------------------------------------------

check("mime mp3 default", audioExtensionForMime("audio/mpeg") === "mp3");
check("mime m4a", audioExtensionForMime("audio/mp4") === "m4a");
check("mime null → mp3", audioExtensionForMime(null) === "mp3");

check("base64 empty", bytesToBase64(new Uint8Array([])) === "");
check(
  "base64 known vector",
  bytesToBase64(new Uint8Array([77, 97, 110])) === "TWFu",
);
check("base64 padding 1", bytesToBase64(new Uint8Array([77, 97])) === "TWE=");
check("base64 padding 2", bytesToBase64(new Uint8Array([77])) === "TQ==");

// base64ToBytes round-trips (popup 🔊 playback writes fetched clips to disk)
{
  const cases = [
    new Uint8Array([]),
    new Uint8Array([77]),
    new Uint8Array([77, 97]),
    new Uint8Array([77, 97, 110]),
    new Uint8Array(Array.from({ length: 300 }, (_, i) => (i * 7 + 3) % 256)),
  ];
  let ok = true;
  for (const bytes of cases) {
    const round = base64ToBytes(bytesToBase64(bytes));
    if (round.length !== bytes.length) ok = false;
    else
      for (let i = 0; i < bytes.length; i++)
        if (round[i] !== bytes[i]) ok = false;
  }
  check("base64ToBytes round-trips", ok);
}

// --- field template seeding (ankiConfig heuristics, RN-free shim) ---------------------------

{
  const seeded = seedFieldTemplates([
    "Expression",
    "ExpressionReading",
    "Sentence",
    "SentenceAudio",
    "Glossary",
    "Picture",
    "ExpressionAudio",
    "MiscInfo",
  ]);
  check("seed Expression", seeded.Expression === "{expression}");
  check("seed ExpressionReading", seeded.ExpressionReading === "{reading}");
  check("seed Sentence", seeded.Sentence === "{sentence}");
  check("seed SentenceAudio", seeded.SentenceAudio === "{sentence-audio}");
  check("seed Glossary", seeded.Glossary === "{glossary}");
  check("seed Picture", seeded.Picture === "{picture}");
  check("seed ExpressionAudio", seeded.ExpressionAudio === "{audio}");
  check("seed unknown stays empty", seeded.MiscInfo === "");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
