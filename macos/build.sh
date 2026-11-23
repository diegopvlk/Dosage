#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != Darwin ]]; then
  echo 'This script builds the macOS app bundle and must run on macOS.' >&2
  exit 1
fi
brew_prefix="$(brew --prefix)"
export PATH="$brew_prefix/bin:$brew_prefix/opt/gettext/bin:$PATH"
export GI_TYPELIB_PATH="$brew_prefix/lib/girepository-1.0${GI_TYPELIB_PATH:+:$GI_TYPELIB_PATH}"
for tool in gjs meson ninja blueprint-compiler terminal-notifier; do
  if ! command -v "$tool" >/dev/null; then
    echo 'Install dependencies: brew install gjs gtk4 libadwaita meson ninja blueprint-compiler terminal-notifier' >&2
    exit 1
  fi
done
app="$PWD/build/macos/Dosage.app"
prefix="$app/Contents/Resources"
mkdir -p "$app/Contents/MacOS" "$prefix"
meson setup build/macos-build --prefix="$prefix" --libdir=lib --reconfigure
meson compile -C build/macos-build
meson install -C build/macos-build
/usr/bin/python3 macos/bundle.py "$app" "$brew_prefix"
echo "Built $app"
echo "Run: open \"$app\""
