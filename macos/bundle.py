"""Package the local GTK build; Homebrew supplies the shared runtime."""
import pathlib
import plistlib
import shlex
import shutil
import subprocess
import tempfile
import sys

app = pathlib.Path(sys.argv[1]).resolve()
brew = pathlib.Path(sys.argv[2]).resolve()
resources = app / 'Contents/Resources'
version = '2.1.9'
icon_name = None
if shutil.which('rsvg-convert'):
    with tempfile.TemporaryDirectory(prefix='dosage-icon-') as temporary:
        iconset = pathlib.Path(temporary) / 'Dosage.iconset'
        iconset.mkdir()
        source = pathlib.Path(__file__).resolve().parents[1] / 'data/icons/hicolor/scalable/apps/io.github.diegopvlk.Dosage.svg'
        for size in (16, 32, 128, 256, 512):
            for scale in (1, 2):
                filename = f'icon_{size}x{size}' + ('@2x' if scale == 2 else '') + '.png'
                subprocess.run(['rsvg-convert', '-w', str(size * scale), '-h', str(size * scale),
                                '-o', str(iconset / filename), str(source)], check=True)
        subprocess.run(['/usr/bin/iconutil', '-c', 'icns', '-o', str(resources / 'Dosage.icns'), str(iconset)], check=True)
        icon_name = 'Dosage.icns'
with (app / 'Contents/Info.plist').open('wb') as stream:
    plistlib.dump({
        'CFBundleName': 'Dosage',
        'CFBundleDisplayName': 'Dosage',
        'CFBundleIdentifier': 'io.github.diegopvlk.Dosage',
        'CFBundleExecutable': 'Dosage',
        **({'CFBundleIconFile': icon_name} if icon_name else {}),
        'CFBundlePackageType': 'APPL',
        'CFBundleShortVersionString': version,
        'CFBundleVersion': version,
        'NSHighResolutionCapable': True,
        # Disable App Nap so background reminder timers are not throttled.
        'NSAppSleepDisabled': True,
    }, stream)
# macOS labels notifications with the sending bundle's name and icon, so ship a
# rebranded copy of terminal-notifier instead of calling Homebrew's directly.
notifier_source = brew / 'opt/terminal-notifier/terminal-notifier.app'
notifier_app = app / 'Contents/Helpers/Dosage.app'
if notifier_app.exists():
    shutil.rmtree(notifier_app)
shutil.copytree(notifier_source, notifier_app, symlinks=True)
notifier_plist = notifier_app / 'Contents/Info.plist'
with notifier_plist.open('rb') as stream:
    info = plistlib.load(stream)
info.update({
    'CFBundleName': 'Dosage',
    'CFBundleDisplayName': 'Dosage',
    'CFBundleIdentifier': 'io.github.diegopvlk.Dosage.notifier',
    'LSUIElement': True,
})
if icon_name:
    shutil.copy2(resources / icon_name, notifier_app / 'Contents/Resources' / icon_name)
    info['CFBundleIconFile'] = icon_name
    info.pop('CFBundleIconName', None)  # Asset-catalog icon would win over the .icns.
with notifier_plist.open('wb') as stream:
    plistlib.dump(info, stream)
subprocess.run(['/usr/bin/codesign', '--force', '--deep', '--sign', '-', str(notifier_app)], check=True)
notifier_executable = notifier_app / 'Contents/MacOS' / info['CFBundleExecutable']
launcher = app / 'Contents/MacOS/Dosage'
launcher.write_text('''#!/bin/bash
set -euo pipefail
contents="$(cd "$(dirname "$0")/.." && pwd)"
resources="$contents/Resources"
export PATH=BREW_BIN:/usr/bin:/bin:/usr/sbin:/sbin
export GI_TYPELIB_PATH=BREW_TYPELIB
export DYLD_FALLBACK_LIBRARY_PATH=BREW_LIB
export XDG_DATA_DIRS="$resources/share:BREW_SHARE:/usr/local/share:/usr/share"
export XDG_DATA_HOME="${DOSAGE_DATA_HOME:-$HOME/Library/Application Support/Dosage}"
export XDG_CONFIG_HOME="${DOSAGE_CONFIG_HOME:-$XDG_DATA_HOME/config}"
export GSETTINGS_SCHEMA_DIR="$resources/share/glib-2.0/schemas"
export GSETTINGS_BACKEND=keyfile
export DOSAGE_PREFIX="$resources"
export DOSAGE_MACOS_LAUNCHER="$contents/MacOS/Dosage"
export DOSAGE_NOTIFIER="$contents/Helpers/Dosage.app/Contents/MacOS/NOTIFIER_EXEC"
mkdir -p "$XDG_DATA_HOME" "$XDG_CONFIG_HOME"
exec BREW_GJS -m "$resources/bin/io.github.diegopvlk.Dosage" "$@"
'''.replace('BREW_BIN', shlex.quote(str(brew / 'bin')))
   .replace('BREW_TYPELIB', shlex.quote(str(brew / 'lib/girepository-1.0')))
   .replace('BREW_LIB', shlex.quote(str(brew / 'lib')))
   .replace('BREW_SHARE', str(brew / 'share'))
   .replace('NOTIFIER_EXEC', notifier_executable.name)
   .replace('BREW_GJS', shlex.quote(str(brew / 'bin/gjs'))))
launcher.chmod(0o755)
