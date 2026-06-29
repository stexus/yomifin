#!/usr/bin/env bash
# yomifin regression guards — run ALL JS-side smoke tests for the harvested
# Yomitan language layer. Run this after any change under utils/yomifin/ or after
# re-vendoring Yomitan (see utils/yomifin/yomitan/VENDOR.md).
#
# These are fast, run in plain JS (no device needed), and are the first line of
# defense against regressions in deinflection / lookup / loading. Device-only
# concerns (Hermes Intl, the RN popup) are validated separately on the iPad.
#
#   1. deinflector smoke  — engine + JA rules reduce conjugations to lemmas (node)
#   2. lookup integration — zip loader → in-memory DB → Translator → lookup() with
#                           complex sentences + forward-greedy boundaries (bun)
#   3. structured content — pure renderer helpers + real-JMdict tree walk (bun)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "── [1/5] deinflector smoke ─────────────────────────────────────────"
./scripts/yomifin-deinflect-smoke.sh

echo
echo "── [2/5] lookup integration (loader + DB + Translator + API) ───────"
bun utils/yomifin/lookup.test.ts

echo
echo "── [3/5] structured-content renderer helpers ───────────────────"
bun utils/yomifin/structuredContent.test.ts

echo
echo "── [4/5] sqlite backend (parity with in-memory + optional real db) ─"
bun utils/yomifin/SqliteDictionaryDatabase.test.ts

echo
echo "── [5/5] dictionary importer (idempotent + parity, synthetic + real) ─"
bun utils/yomifin/importDictionary.test.ts

echo
echo "✅ all yomifin regression guards passed"
