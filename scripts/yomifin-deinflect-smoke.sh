#!/usr/bin/env bash
# Phase 2 deinflector smoke test runner.
#
# The harvested Yomitan deinflector files in utils/yomifin/yomitan/ are ESM (.js
# with import/export), but the repo root package.json has no "type":"module", so
# Node would parse them as CommonJS. We copy them to an isolated temp dir that
# declares {"type":"module"} and run the test there. (Metro/RN consume the .js
# files directly; this dance is only for the Node-side smoke test.)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/utils/yomifin/yomitan"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cp "$SRC"/*.js "$SRC"/*.mjs "$TMP/"
echo '{"type":"module"}' > "$TMP/package.json"
node "$TMP/deinflect-smoke.test.mjs"
