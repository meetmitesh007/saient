#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$ROOT_DIR/android"
APK_PATH="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
AAB_PATH="$ANDROID_DIR/app/build/outputs/bundle/release/app-release.aab"
MAPPING_PATH="$ANDROID_DIR/app/build/outputs/mapping/release/mapping.txt"
SYMBOLS_PATH="$ANDROID_DIR/app/build/outputs/native-debug-symbols/release/native-debug-symbols.zip"
METADATA_PATH="$ANDROID_DIR/app/build/outputs/apk/release/output-metadata.json"

cd "$ROOT_DIR"
export NODE_ENV=production

case "${SAIENT_ALLOW_DEBUG_RELEASE:-false}" in
  1|true|TRUE|yes|YES)
    echo "Refusing production release: SAIENT_ALLOW_DEBUG_RELEASE is enabled." >&2
    exit 2
    ;;
esac

has_property_file=false
for property_file in \
  "$ROOT_DIR/release/credentials/keystore.properties" \
  "$ANDROID_DIR/keystore.properties"; do
  if [[ -f "$property_file" ]]; then
    has_property_file=true
    break
  fi
done
has_environment_signing=true
for name in \
  SAIENT_ANDROID_KEYSTORE_PATH \
  SAIENT_ANDROID_KEYSTORE_PASSWORD \
  SAIENT_ANDROID_KEY_ALIAS \
  SAIENT_ANDROID_KEY_PASSWORD; do
  if [[ -z "${!name:-}" ]]; then
    has_environment_signing=false
  fi
done
if [[ "$has_property_file" != true && "$has_environment_signing" != true ]]; then
  echo "Release signing is not configured." >&2
  echo "Run npm run android:signing:init, configure android/keystore.properties, or provide all four SAIENT_ANDROID_* variables." >&2
  exit 2
fi

if [[ -z "${ANDROID_HOME:-}" && -n "${ANDROID_SDK_ROOT:-}" ]]; then
  export ANDROID_HOME="$ANDROID_SDK_ROOT"
fi
if [[ -z "${ANDROID_HOME:-}" && ! -f "$ANDROID_DIR/local.properties" ]]; then
  adb_binary="$(command -v adb || true)"
  if [[ -n "$adb_binary" ]]; then
    sdk_candidate="$(dirname "$(dirname "$(readlink -f "$adb_binary")")")"
    if [[ -d "$sdk_candidate/platforms" && -d "$sdk_candidate/build-tools" ]]; then
      export ANDROID_HOME="$sdk_candidate"
    fi
  fi
fi
if [[ -z "${ANDROID_HOME:-}" && ! -f "$ANDROID_DIR/local.properties" ]]; then
  echo "Android SDK location is not configured." >&2
  echo "Set ANDROID_HOME (or ANDROID_SDK_ROOT), or create android/local.properties with sdk.dir." >&2
  exit 2
fi

if [[ "${SAIENT_SKIP_NPM_CI:-false}" != true ]]; then
  npm ci --include=dev
fi
npm run lint
npm run typecheck
npm run test:security
npm run test:models
npm run doctor
npm audit --audit-level=high
npx expo prebuild --clean --platform android --no-install

(
  cd "$ANDROID_DIR"
  ./gradlew :app:clean :app:bundleRelease :app:assembleRelease
)

for artifact in "$APK_PATH" "$AAB_PATH" "$MAPPING_PATH" "$SYMBOLS_PATH" "$METADATA_PATH"; do
  if [[ ! -s "$artifact" ]]; then
    echo "Expected release artifact is missing or empty: $artifact" >&2
    exit 3
  fi
done

if ! command -v apksigner >/dev/null 2>&1; then
  echo "apksigner is required to verify the release certificate." >&2
  exit 3
fi
SIGNING_REPORT="$(apksigner verify --verbose --print-certs "$APK_PATH")"
if [[ "$SIGNING_REPORT" == *"CN=Android Debug"* ]]; then
  echo "Refusing release artifact signed with the Android debug certificate." >&2
  exit 4
fi
if [[ "$SIGNING_REPORT" != *"Verifies"* ]]; then
  echo "APK signature verification did not report success." >&2
  exit 4
fi
jarsigner -verify "$AAB_PATH" >/dev/null

readarray -t VERSION_INFO < <(node - "$METADATA_PATH" <<'NODE'
const fs = require("fs");
const metadata = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const element = metadata.elements?.[0];
if (!element?.versionName || !Number.isInteger(element.versionCode)) process.exit(1);
console.log(element.versionName);
console.log(element.versionCode);
NODE
)
VERSION_NAME="${VERSION_INFO[0]}"
VERSION_CODE="${VERSION_INFO[1]}"
ARCHIVE_DIR="$ROOT_DIR/release-artifacts/android/${VERSION_NAME}-${VERSION_CODE}"
if [[ -e "$ARCHIVE_DIR" ]]; then
  echo "Release archive already exists: $ARCHIVE_DIR" >&2
  echo "Increment the Android versionCode before producing another release." >&2
  exit 5
fi

mkdir -p "$ARCHIVE_DIR"
cp "$APK_PATH" "$ARCHIVE_DIR/saient-${VERSION_NAME}-${VERSION_CODE}.apk"
cp "$AAB_PATH" "$ARCHIVE_DIR/saient-${VERSION_NAME}-${VERSION_CODE}.aab"
cp "$MAPPING_PATH" "$ARCHIVE_DIR/mapping.txt"
cp "$SYMBOLS_PATH" "$ARCHIVE_DIR/native-debug-symbols.zip"
(
  cd "$ARCHIVE_DIR"
  sha256sum ./* > SHA256SUMS
)

printf 'Verified release archive: %s\n' "$ARCHIVE_DIR"
printf '%s\n' "$SIGNING_REPORT"
