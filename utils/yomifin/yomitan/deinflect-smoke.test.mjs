/*
 * Phase 2 smoke test for the harvested Yomitan deinflector.
 *
 * Verifies the engine (language-transformer.js) + JA rules (japanese-transforms.js)
 * lift cleanly and reduce conjugated forms back to their dictionary lemmas.
 *
 * Run: node utils/yomifin/yomitan/deinflect-smoke.test.mjs
 * (uses a generated package.json {"type":"module"} via the runner; see below)
 */

import {LanguageTransformer} from './language-transformer.js';
import {japaneseTransforms} from './japanese-transforms.js';

const lt = new LanguageTransformer();
lt.addDescriptor(japaneseTransforms);

/**
 * @param {string} source conjugated input
 * @returns {Set<string>} all candidate deinflected forms
 */
function deinflectForms(source) {
    return new Set(lt.transform(source).map((r) => r.text));
}

// Each case is a single conjugated WORD that the deinflector must reduce to its
// lemma directly. Cases like 見せてくれた→見せる or 静かじゃない→静か are intentionally
// NOT here: they resolve via the Translator's forward-greedy substring shortening
// (見せて→見せる) or zero-deinflection exact match on a shorter substring (静か),
// which is the next Phase 2 build step, not the raw deinflector. See PHASE2_YOMITAN.md.
/** @type {[string, string][]} input → expected lemma that must appear among candidates */
const cases = [
    ['好きでした', '好き'],
    ['食べさせられた', '食べる'],
    ['食べた', '食べる'],
    ['食べない', '食べる'],
    ['行きました', '行く'],
    ['読まなかった', '読む'],
    ['泳いでいる', '泳ぐ'],
    ['見せて', '見せる'],
    ['高かった', '高い'],
    ['高くない', '高い'],
    ['来られる', '来る'],
    ['しました', 'する'],
];

let pass = 0;
let fail = 0;
for (const [input, expected] of cases) {
    const forms = deinflectForms(input);
    const ok = forms.has(expected);
    if (ok) {
        pass++;
        console.log(`  PASS  ${input}  ->  ${expected}`);
    } else {
        fail++;
        console.log(`  FAIL  ${input}  ->  expected ${expected}`);
        console.log(`        got: ${[...forms].join(', ')}`);
    }
}

console.log(`\n${pass}/${cases.length} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
