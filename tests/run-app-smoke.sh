#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
test_directory="$(mktemp -d /tmp/dosage-app-tests.XXXXXX)"
trap 'rm -rf "$test_directory"' EXIT
export DOSAGE_PREFIX="$PWD/build/macos/Dosage.app/Contents/Resources"
export DYLD_FALLBACK_LIBRARY_PATH="$(brew --prefix)/lib"
export XDG_DATA_DIRS="$DOSAGE_PREFIX/share:$(brew --prefix)/share:/usr/share"
export GSETTINGS_SCHEMA_DIR="$DOSAGE_PREFIX/share/glib-2.0/schemas"
export GSETTINGS_BACKEND=keyfile
export XDG_DATA_HOME="$test_directory/data"
export XDG_CONFIG_HOME="$test_directory/config"
export XDG_CACHE_HOME="$test_directory/cache"
export DOSAGE_TEST_TMP="$test_directory"
export DOSAGE_NOTIFIER="$PWD/tests/fake-notifier.py"
mkdir -p "$XDG_DATA_HOME" "$XDG_CONFIG_HOME"
gjs -m tests/app-smoke.js create
gjs -m tests/app-smoke.js reload
