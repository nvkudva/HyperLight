#!/bin/bash
set -e

APP_NAME="Smart Personal Search"
BUNDLE_DIR="$APP_NAME.app"

echo "Building macOS application bundle: $BUNDLE_DIR"

mkdir -p "$BUNDLE_DIR/Contents/MacOS"
mkdir -p "$BUNDLE_DIR/Contents/Resources"

# Compile Swift binary with Apple Silicon optimizations
swiftc -O -target arm64-apple-macos13.0 mac_app/main.swift -o "$BUNDLE_DIR/Contents/MacOS/$APP_NAME"

# Copy Info.plist
cp mac_app/Info.plist "$BUNDLE_DIR/Contents/Info.plist"

chmod +x "$BUNDLE_DIR/Contents/MacOS/$APP_NAME"

echo "Successfully built $BUNDLE_DIR"
