#!/usr/bin/env bash
# Bundle the complete Sesasi web app with its Android integrations.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${ANDROID_HOME:?Set ANDROID_HOME to the Android SDK directory}"
: "${JAVA_HOME:?Set JAVA_HOME to JDK 17}"
export PATH="$JAVA_HOME/bin:$PATH"
sdk="$ANDROID_HOME/build-tools/35.0.0"
platform="$ANDROID_HOME/platforms/android-35/android.jar"
npm run build
mkdir -p android/build public/downloads out/downloads
stage=$(mktemp -d "$PWD/android/build/package.XXXXXX")
mkdir -p "$stage/classes" "$stage/assets" "$stage/dex"
# Exclude installers so rebuilding never recursively bundles earlier APKs.
rsync -a --exclude=/downloads/ out/ "$stage/assets/"
javac -encoding UTF-8 --release 8 -cp "$platform" -d "$stage/classes" android/src/kr/sesasi/daybook/*.java
jar cf "$stage/classes.jar" -C "$stage/classes" .
"$sdk/d8" --release --min-api 28 --lib "$platform" --output "$stage/dex" "$stage/classes.jar"
link_args=(-I "$platform" --manifest android/AndroidManifest.xml -o "$stage/app.apk")
if [[ "${SESASI_ANDROID_DEBUG:-0}" == "1" ]]; then link_args+=(--debug-mode); fi
"$sdk/aapt2" link "${link_args[@]}"
(cd "$stage" && zip -q -r app.apk assets)
(cd "$stage/dex" && zip -q "$stage/app.apk" classes.dex)
"$sdk/zipalign" -f 4 "$stage/app.apk" "$stage/aligned.apk"
key=android/build/local-debug.keystore
if [[ ! -f "$key" ]]; then
  keytool -genkeypair -keystore "$key" -storepass android -keypass android -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 3650 -dname "CN=Daybook Local Debug"
fi
"$sdk/apksigner" sign --ks "$key" --ks-pass pass:android --key-pass pass:android --out "$stage/sesasi.apk" "$stage/aligned.apk"
"$sdk/apksigner" verify "$stage/sesasi.apk"
cp "$stage/sesasi.apk" public/downloads/sesasi.apk
cp "$stage/sesasi.apk" out/downloads/sesasi.apk
