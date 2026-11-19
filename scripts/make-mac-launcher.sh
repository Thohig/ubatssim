#!/bin/zsh
# Builds "Ubåtssim.app": a tiny macOS app that opens the game's GitHub Pages
# site in the default browser, with the game's icon.
#
# Usage: scripts/make-mac-launcher.sh [target-folder]   (default: ~/Projekt)
#
# Uses only tools that ship with macOS: qlmanage (renders the SVG icon),
# iconutil (builds the .icns), osacompile (builds the AppleScript app) and
# codesign (ad-hoc signature).
set -euo pipefail

URL="https://thohig.github.io/ubatssim/"
APP_NAME="Ubåtssim"
REPO_DIR="${0:A:h:h}"
SOURCE_SVG="$REPO_DIR/assets/icon-square.svg"
TARGET_DIR="${1:-$HOME/Projekt}"
APP="$TARGET_DIR/$APP_NAME.app"

[[ -f "$SOURCE_SVG" ]] || { echo "Hittar inte $SOURCE_SVG" >&2; exit 1; }
[[ -d "$TARGET_DIR" ]] || { echo "Mappen $TARGET_DIR finns inte" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf -- "${WORK:?}"' EXIT
ICONSET="$WORK/AppIcon.iconset"
mkdir -p "$ICONSET"

# Render one PNG per required size (iconutil needs 1x and 2x variants).
render() { # <pixels> <file name>
  qlmanage -t -s "$1" -o "$WORK" "$SOURCE_SVG" >/dev/null 2>&1
  mv "$WORK/icon-square.svg.png" "$ICONSET/$2"
}
for s in 16 32 128 256 512; do
  render "$s" "icon_${s}x${s}.png"
  render "$((s * 2))" "icon_${s}x${s}@2x.png"
done
iconutil -c icns -o "$WORK/AppIcon.icns" "$ICONSET"

# Build the app. An existing launcher is replaced (it contains nothing else).
if [[ -d "$APP" ]]; then rm -rf -- "${APP:?}"; fi
osacompile -o "$APP" -e "open location \"$URL\""

# Use our icon: replace the default applet icon and drop the asset catalog so
# macOS does not prefer the generic script icon.
cp "$WORK/AppIcon.icns" "$APP/Contents/Resources/applet.icns"
rm -f -- "$APP/Contents/Resources/Assets.car"
/usr/libexec/PlistBuddy -c "Delete :CFBundleIconName" "$APP/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Set :CFBundleIconFile applet" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string io.github.thohig.ubatssim.launcher" "$APP/Contents/Info.plist" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier io.github.thohig.ubatssim.launcher" "$APP/Contents/Info.plist"

# Resources changed after osacompile signed the bundle: sign again (ad hoc).
codesign --force --deep --sign - "$APP" >/dev/null 2>&1

# Make Finder and the Dock pick up the new icon.
touch "$APP"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP" >/dev/null 2>&1 || true

echo "Klar: $APP öppnar $URL"
