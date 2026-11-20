#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

KEYSTORE="$ROOT_DIR/android/sarihbricks-release.keystore"
KEYSTORE_PROPS="$ROOT_DIR/android/keystore.properties"

read_prop() {
  local key="$1"
  if [ -f "$KEYSTORE_PROPS" ]; then
    grep -E "^${key}=" "$KEYSTORE_PROPS" | head -n 1 | cut -d'=' -f2- | tr -d '\r'
  fi
}

KEY_ALIAS="${SARIHBRICKS_KEY_ALIAS:-$(read_prop keyAlias)}"
KEY_PASS="${SARIHBRICKS_KEY_PASSWORD:-$(read_prop keyPassword)}"
STORE_PASS="${SARIHBRICKS_KEYSTORE_PASSWORD:-$(read_prop storePassword)}"

if [ -z "$KEY_ALIAS" ] || [ -z "$KEY_PASS" ] || [ -z "$STORE_PASS" ]; then
  echo "Erreur : identifiants de signature manquants." >&2
  echo "Créez $KEYSTORE_PROPS avec :" >&2
  echo "  storePassword=..." >&2
  echo "  keyAlias=..." >&2
  echo "  keyPassword=..." >&2
  echo "Ou définissez SARIHBRICKS_KEYSTORE_PASSWORD, SARIHBRICKS_KEY_ALIAS et SARIHBRICKS_KEY_PASSWORD." >&2
  exit 1
fi

if [ ! -f "$KEYSTORE" ]; then
  echo "Création de la clé de signature locale : $KEYSTORE"
  "$JAVA_HOME/bin/keytool" -genkeypair -v \
    -keystore "$KEYSTORE" \
    -alias "$KEY_ALIAS" \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -storepass "$STORE_PASS" \
    -keypass "$KEY_PASS" \
    -dname "CN=Mohamed Sarih, OU=SarihBricks, O=Sarih, L=Paris, ST=IDF, C=FR"
fi

echo "1/3 — Build de production du jeu (dist/)..."
npm run build

echo "2/3 — Synchronisation Capacitor vers Android..."
npx cap sync android

echo "3/3 — Assemblage et signature de l'APK..."
GRADLE_ARGS=("assembleRelease" "--no-daemon")
VERSION_FILE="$ROOT_DIR/android/.version-code"
if [ -n "${SARIHBRICKS_VERSION_CODE:-}" ]; then
  VERSION_CODE="$SARIHBRICKS_VERSION_CODE"
else
  PREV_CODE=1
  if [ -f "$VERSION_FILE" ]; then
    PREV_CODE="$(tr -d '[:space:]' < "$VERSION_FILE")"
  fi
  VERSION_CODE=$((PREV_CODE + 1))
  echo "$VERSION_CODE" > "$VERSION_FILE"
fi
GRADLE_ARGS+=("-PversionCode=$VERSION_CODE")
if [ -n "${SARIHBRICKS_VERSION_NAME:-}" ]; then
  GRADLE_ARGS+=("-PversionName=$SARIHBRICKS_VERSION_NAME")
fi

(cd "$ROOT_DIR/android" && ./gradlew "${GRADLE_ARGS[@]}")

mkdir -p "$ROOT_DIR/release"
cp "$ROOT_DIR/android/app/build/outputs/apk/release/app-release.apk" "$ROOT_DIR/release/SarihBricks.apk"
echo "APK prêt : $ROOT_DIR/release/SarihBricks.apk ($(du -h "$ROOT_DIR/release/SarihBricks.apk" | cut -f1))"
