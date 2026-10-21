#!/bin/bash
# Builds a menu bar .app bundle at macos/build/ChainYourMac.app
set -euo pipefail
cd "$(dirname "$0")/.."
swift build -c release
APP=build/ChainYourMac.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp .build/release/ChainYourMac "$APP/Contents/MacOS/ChainYourMac"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Chain Your Mac</string>
  <key>CFBundleIdentifier</key><string>com.chainyourmac.app</string>
  <key>CFBundleExecutable</key><string>ChainYourMac</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
</dict></plist>
PLIST
codesign --force --sign - "$APP"
echo "Built $APP"
