#!/bin/bash
# Builds the signed release APK and publishes it at <site>/Jewber.apk (the server's dist/).
#   JEWBER_STATE=/path/to/state android/release.sh [keystore.properties]   # default: $JEWBER_STATE/android/keystore.properties
# The key lives beside the server's state, never in git. Lose it and phones can't update
# (they'd have to uninstall first), so back it up with the rest of the state.
set -euo pipefail
cd "$(dirname "$0")"
SIGNING=${1:-${JEWBER_STATE:?set JEWBER_STATE to the server state folder}/android/keystore.properties}
DIST=${JEWBER_DIST:-$JEWBER_STATE/dist}
K=${KIT:-$HOME/.cache/kavana-build}
export JAVA_HOME=${JAVA_HOME:-$K/jdk17} ANDROID_HOME=${ANDROID_HOME:-$K/sdk} GRADLE_USER_HOME=${GRADLE_USER_HOME:-$K/gradle} ANDROID_USER_HOME=${ANDROID_USER_HOME:-$K/dotandroid}
export PATH=$JAVA_HOME/bin:$PATH
[[ -f local.properties ]] || echo "sdk.dir=$ANDROID_HOME" > local.properties
[[ -f $SIGNING ]] || { echo "no signing properties at $SIGNING" >&2; exit 2; }
./gradlew --quiet assembleRelease -PsigningProperties="$SIGNING"
APK=app/build/outputs/apk/release/app-release.apk
[[ -f $APK ]] || { echo "the release build is not signed" >&2; exit 1; }
VERSION=$(sed -n "s/.*versionName '\(.*\)'.*/\1/p" app/build.gradle | head -1)
CODE=$(sed -n "s/.*versionCode \([0-9]*\).*/\1/p" app/build.gradle | head -1)
SIGNER=$(ls -d $ANDROID_HOME/build-tools/*/apksigner | tail -1)
$SIGNER verify --print-certs $APK | grep -E "certificate SHA-256"
mkdir -p "$DIST"
OUT=Jewber-$VERSION.apk
cp $APK "$DIST/$OUT"
SHA=$(sha256sum "$DIST/$OUT" | cut -d' ' -f1)
SIZE=$(stat -c %s "$DIST/$OUT")
printf '{"version":"%s","code":%s,"file":"%s","sha256":"%s","size":%s,"at":%s}\n' "$VERSION" "$CODE" "$OUT" "$SHA" "$SIZE" "$(date +%s)000" > "$DIST/app.json"
echo "published: $DIST/$OUT ($SIZE bytes) -> /Jewber.apk"
