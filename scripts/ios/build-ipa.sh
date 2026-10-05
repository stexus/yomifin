#!/usr/bin/env bash
# Backwards-compatible stable build command. Always preserves the stable ID.
set -euo pipefail
exec bash "$(dirname "$0")/build-variant.sh" stable
