#!/bin/bash
set -e

# ── Local Android APK build ──────────────────────────────────
# Uses the WSL-local Android SDK (not the Windows shim used for dev)
# This overrides ANDROID_HOME just for this script's lifetime

export ANDROID_HOME="$HOME/android"
export ANDROID_SDK_ROOT="${ANDROID_HOME}"
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64/
export PATH="${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${ANDROID_HOME}/tools:${ANDROID_HOME}/tools/bin:${PATH}"

echo "[build-apk] Using ANDROID_HOME=${ANDROID_HOME}"
echo "[build-apk] SDK version: $(sdkmanager --version 2>/dev/null || echo 'sdkmanager not found')"

# Ensure we're in the mobile app directory
cd "$(dirname "$0")/.."

# Step 1: Generate native Android project
echo "[build-apk] Running expo prebuild..."
npx expo prebuild --platform android --clean

# Step 2: Build APK
echo "[build-apk] Building APK with Gradle..."
cd android
./gradlew assembleRelease --no-daemon

# Step 3: Locate the output
APK_PATH=$(find . -name "*.apk" -path "*/release/*" | head -1)
if [ -n "$APK_PATH" ]; then
  DEST="../../build/hisaabo-$(date +%Y%m%d).apk"
  mkdir -p "$(dirname "$DEST")"
  cp "$APK_PATH" "$DEST"
  echo ""
  echo "[build-apk] APK ready: $DEST"
  echo "[build-apk] Size: $(du -h "$DEST" | cut -f1)"
else
  echo "[build-apk] WARNING: APK not found in release output"
  echo "[build-apk] Check android/app/build/outputs/apk/"
fi
