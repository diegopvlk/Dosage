#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
test_directory="$(mktemp -d /tmp/dosage-tests.XXXXXX)"
trap 'rm -rf "$test_directory"' EXIT
export DOSAGE_TEST_TMP="$test_directory"
export HOME="$test_directory/home"
export XDG_CACHE_HOME="$test_directory/cache"
mkdir -p "$HOME"
export DOSAGE_MACOS_LAUNCHER="$test_directory/launcher & test"
printf '#!/bin/sh\nexit 0\n' > "$DOSAGE_MACOS_LAUNCHER"
chmod +x "$DOSAGE_MACOS_LAUNCHER"
export DOSAGE_NOTIFIER="$PWD/tests/fake-notifier.py"
export DYLD_FALLBACK_LIBRARY_PATH="$(brew --prefix)/lib"
gjs -m tests/macos.js
/usr/bin/python3 - <<'PY'
import os
import pathlib
import plistlib
path = pathlib.Path.home() / 'Library/LaunchAgents/io.github.diegopvlk.Dosage.plist'
agent = plistlib.loads(path.read_bytes())
assert agent['ProgramArguments'] == [os.environ['DOSAGE_MACOS_LAUNCHER'], '--startup']
assert agent['RunAtLoad'] is True
print('PASS: LaunchAgent plist parses and preserves the executable path')
PY
