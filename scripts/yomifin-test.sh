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

echo "── [1/19] deinflector smoke ────────────────────────────────────────"
./scripts/yomifin-deinflect-smoke.sh

echo
echo "── [2/19] lookup integration (loader + DB + Translator + API) ──────"
bun utils/yomifin/lookup.test.ts

echo
echo "── [3/19] structured-content renderer + HTML serializer ──────────────────────"
bun utils/yomifin/structuredContent.test.ts

echo
echo "── [4/19] sqlite backend (parity with in-memory + optional real db) "
bun utils/yomifin/SqliteDictionaryDatabase.test.ts

echo
echo "── [5/19] dictionary importer (idempotent + parity) ────────────────"
bun utils/yomifin/importDictionary.test.ts

echo
echo "── [6/19] dictionary config reconciler + popup selection model ─────"
bun utils/yomifin/dictionaryConfig.test.ts

echo
echo "── [7/19] marker engine (Phase 8 field templates) ──────────────────"
bun utils/yomifin/markers.test.ts

echo
echo "── [8/19] sense-level selection (paths + flatten) ──────────────────"
bun utils/yomifin/senses.test.ts

echo
echo "── [9/19] cue store range logic (multi-sentence cards) ─────────────"
bun utils/yomifin/cues.test.ts

echo
echo "── [10/19] word-audio sources + field seeding ──────────────────────"
bun utils/yomifin/wordAudio.test.ts

echo
echo "── [11/19] content-derived media keys (dedup / batch mining) ────────"
bun utils/yomifin/mediaKey.test.ts

echo
echo "── [12/19] profiles (JA/ZH bundles) ────────────────────────────────"
bun utils/yomifin/profiles.test.ts

echo
echo "── [13/19] subtitle formats (ASS/VTT/SRT dispatch) ──────────────────"
bun utils/yomifin/subtitleParse.test.ts

echo
echo "── [14/19] subtitle sync estimation (offset correlation) ───────────"
bun utils/yomifin/subSync.test.ts

echo
echo "── [15/19] jimaku.cc client (request shape / errors) ───────────────"
bun utils/yomifin/jimaku.test.ts

echo
echo "── [16/19] anki settings export/import (transfer schema) ───────────"
bun utils/yomifin/ankiSettingsTransfer.test.ts

echo
echo "── [17/19] yozora api client (urls / auth / error codes) ───────────────"
bun utils/yozora/api.test.ts

echo
echo "── [18/19] yozora display helpers ───────────────────────────────────────────"
bun utils/yozora/display.test.ts

echo
echo "── [19/19] yozora filter models ──────────────────────────────────────────────"
bun utils/yozora/filters.test.ts

echo
echo "── [optional] subSync ↔ real alass cross-check (skips if not installed) ─"
bun scripts/yomifin-sync-crosscheck.ts

echo
echo "✅ all yomifin regression guards passed"
