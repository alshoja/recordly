#!/bin/bash
# ===============================
# generate-certs.sh
# Creates a locally-trusted TLS certificate (via mkcert) for the app's
# local development domains. Safe to re-run; regenerates the cert each time.
# ===============================
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT_DIR="$ROOT_DIR/certs"
APP_DOMAIN="${APP_DOMAIN:-recordly.techdev}"
API_DOMAIN="${API_DOMAIN:-api.recordly.techdev}"
PGADMIN_DOMAIN="${PGADMIN_DOMAIN:-pgadmin.recordly.techdev}"

install_mkcert() {
  if command -v mkcert >/dev/null 2>&1; then
    return 0
  fi

  echo "🔹 mkcert not found, installing..."
  case "$(uname -s)" in
    Darwin)
      if ! command -v brew >/dev/null 2>&1; then
        echo "❌ Homebrew is required to install mkcert automatically on macOS."
        echo "   Install it from https://brew.sh, then re-run this script."
        exit 1
      fi
      brew install mkcert nss
      ;;
    Linux)
      sudo apt-get update && sudo apt-get install -y libnss3-tools curl
      curl -L "https://dl.filippo.io/mkcert/latest?for=linux/amd64" -o /tmp/mkcert
      chmod +x /tmp/mkcert
      sudo mv /tmp/mkcert /usr/local/bin/mkcert
      ;;
    *)
      echo "❌ Unsupported OS for automatic mkcert install."
      echo "   Install mkcert manually: https://github.com/FiloSottile/mkcert#installation"
      exit 1
      ;;
  esac
}

install_mkcert

echo "🔹 Installing local mkcert CA into your system/browser trust store..."
mkcert -install

mkdir -p "$CERT_DIR"
echo "🔹 Generating certificate for $APP_DOMAIN, $API_DOMAIN and $PGADMIN_DOMAIN..."
mkcert \
  -cert-file "$CERT_DIR/local-cert.pem" \
  -key-file "$CERT_DIR/local-key.pem" \
  "$APP_DOMAIN" "$API_DOMAIN" "$PGADMIN_DOMAIN"

echo "✔ Certificate written to $CERT_DIR/local-cert.pem"
