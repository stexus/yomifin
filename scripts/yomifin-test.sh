#!/usr/bin/env bash
# yomifin regression guards — run ALL JS-side smoke tests for the harvested
# Yomitan language layer. Run this after any change under utils/yomifin/ or after
# re-vendoring Yomitan (see utils/yomifin/yomitan/VENDOR.md).
#
# These are fast, run in plain JS (no device needed), and are the first line of
# defense against regressions in deinflection / lookup / loading. Device-only
# concerns (Hermes Intl, the RN popup) are validated separately on the iPad.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "── [1/11] deinflector smoke ────────────────────────────────────────"
./scripts/yomifin-deinflect-smoke.sh

echo
echo "── [2/11] lookup integration (loader + DB + Translator + API) ──────"
bun utils/yomifin/lookup.test.ts

echo
echo "── [3/11] structured-content renderer + HTML serializer ──────────────────────"
bun utils/yomifin/structuredContent.test.ts

echo
echo "── [4/11] sqlite backend (parity with in-memory + optional real db) "
bun utils/yomifin/SqliteDictionaryDatabase.test.ts

echo
echo "── [5/11] dictionary importer (idempotent + parity) ────────────────"
bun utils/yomifin/importDictionary.test.ts

echo
echo "── [6/11] dictionary config reconciler + popup selection model ─────"
bun utils/yomifin/dictionaryConfig.test.ts

echo
echo "── [7/11] marker engine (Phase 8 field templates) ──────────────────"
bun utils/yomifin/markers.test.ts

echo
echo "── [8/11] sense-level selection (paths + flatten) ──────────────────"
bun utils/yomifin/senses.test.ts

echo
echo "── [9/11] cue store range logic (multi-sentence cards) ─────────────"
bun utils/yomifin/cues.test.ts

echo
echo "── [10/11] word-audio sources + field seeding ──────────────────────"
bun utils/yomifin/wordAudio.test.ts

echo
echo "── [11/11] content-derived media keys (dedup / batch mining) ────────"
bun utils/yomifin/mediaKey.test.ts

echo
echo "✅ all yomifin regression guards passed"
