#!/bin/bash
set -e

APP_NAME="Hyperlight"
BUNDLE_DIR="$APP_NAME.app"

echo "Building macOS application bundle: $BUNDLE_DIR"

mkdir -p "$BUNDLE_DIR/Contents/MacOS"
mkdir -p "$BUNDLE_DIR/Contents/Resources"

# Compile Swift binary with Apple Silicon optimizations
swiftc -O -target arm64-apple-macos13.0 mac_app/main.swift -o "$BUNDLE_DIR/Contents/MacOS/$APP_NAME"

# Copy Info.plist and AppIcon
cp mac_app/Info.plist "$BUNDLE_DIR/Contents/Info.plist"
if [ -f mac_app/AppIcon.icns ]; then
    cp mac_app/AppIcon.icns "$BUNDLE_DIR/Contents/Resources/AppIcon.icns"
fi

chmod +x "$BUNDLE_DIR/Contents/MacOS/$APP_NAME"

# Ad-hoc sign with mic entitlement so getUserMedia can prompt for access
codesign -s - --entitlements mac_app/entitlements.plist --force "$BUNDLE_DIR" >/dev/null

echo "Successfully built $BUNDLE_DIR"
