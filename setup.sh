#!/bin/bash
# ===============================
# start.sh - cross-platform dev setup
# Linux / macOS version
# ===============================
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OS="$(uname -s)"

remove_path() {
  local path="$1"

  if [ ! -e "$path" ]; then
    return 0
  fi

  if rm -rf "$path" 2>/dev/null; then
    return 0
  fi

  echo "⚠ Could not remove $path with current permissions."

  if [ "$OS" = "Darwin" ]; then
    echo "🔹 Removing macOS ACL restrictions from $path..."
    chmod -RN "$path" 2>/dev/null || sudo chmod -RN "$path"

    if rm -rf "$path" 2>/dev/null; then
      return 0
    fi
  fi

  if [ "$OS" = "Darwin" ] || [ "$OS" = "Linux" ]; then
    echo "🔹 Taking ownership of $path, then removing it..."
    sudo chown -R "$(id -u):$(id -g)" "$path"
    rm -rf "$path" 2>/dev/null || sudo rm -rf "$path"
  else
    echo "❌ Please remove $path manually, then run setup again."
    exit 1
  fi
}

install_dependencies() {
  local service_dir="$1"
  local service_name="$2"

  echo "🔹 Installing $service_name dependencies..."
  cd "$ROOT_DIR/$service_dir"
  remove_path node_modules
  corepack enable
  yarn install
}

# Step 0: copy .env.example to .env if not exists
if [ ! -f "$ROOT_DIR/.env" ]; then
  echo "🔹 Creating .env from .env.example..."
  cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
fi

# Load APP_DOMAIN / API_DOMAIN from .env (fall back to defaults)
APP_DOMAIN="$(grep -E '^APP_DOMAIN=' "$ROOT_DIR/.env" | cut -d '=' -f2-)"
API_DOMAIN="$(grep -E '^API_DOMAIN=' "$ROOT_DIR/.env" | cut -d '=' -f2-)"
APP_DOMAIN="${APP_DOMAIN:-recordly.techdev}"
API_DOMAIN="${API_DOMAIN:-api.recordly.techdev}"

add_hosts_entry() {
  local domain="$1"
  local hosts_file="/etc/hosts"

  if grep -qE "^[0-9.]+[[:space:]]+$domain([[:space:]]|\$)" "$hosts_file" 2>/dev/null; then
    echo "✔ $domain already present in $hosts_file"
    return 0
  fi

  echo "🔹 Adding $domain to $hosts_file..."
  local line="127.0.0.1 $domain"

  if sudo -n true 2>/dev/null || [ -t 0 ]; then
    echo "$line" | sudo tee -a "$hosts_file" >/dev/null
    return 0
  fi

  # No interactive terminal for sudo's password prompt (e.g. run from an IDE
  # or agent-driven shell) — fall back to a GUI elevation prompt.
  if [ "$OS" = "Darwin" ] && command -v osascript >/dev/null 2>&1; then
    osascript -e "do shell script \"echo '$line' >> $hosts_file\" with administrator privileges" >/dev/null
    return 0
  fi

  if command -v pkexec >/dev/null 2>&1; then
    pkexec sh -c "echo '$line' >> $hosts_file"
    return 0
  fi

  echo "❌ Could not get elevated privileges to edit $hosts_file (no TTY for sudo password)."
  echo "   Add this line manually: $line"
  exit 1
}

# Step 0b: point the local domains at this machine and generate trusted TLS certs
if [ "$OS" = "Darwin" ] || [ "$OS" = "Linux" ]; then
  add_hosts_entry "$APP_DOMAIN"
  add_hosts_entry "$API_DOMAIN"

  echo "🔹 Setting up local TLS certificate for $APP_DOMAIN and $API_DOMAIN..."
  APP_DOMAIN="$APP_DOMAIN" API_DOMAIN="$API_DOMAIN" "$ROOT_DIR/certs/generate-certs.sh"
else
  echo "⚠ Automatic /etc/hosts and mkcert setup is only supported on macOS/Linux."
  echo "  Add '127.0.0.1 $APP_DOMAIN' and '127.0.0.1 $API_DOMAIN' to your hosts file"
  echo "  and run certs/generate-certs.sh manually (see docs/DEVELOPMENT.md)."
fi

# Step 1: fix permissions (optional, avoids npm EACCES errors)
# Step 1: fix permissions (Linux only)
echo "🔹 Fixing project folder permissions..."

if [ "$OS" = "Linux" ]; then
  sudo chown -R "$USER:$USER" "$ROOT_DIR"
  echo "✔ chown applied (Linux)"
else
  echo "⚠ Skipping chown (not needed on $OS)"
fi

# Step 2: install worker dependencies
install_dependencies "ocr-worker" "OCR worker"

# Step 2: install backend dependencies
install_dependencies "backend" "backend"

# Step 3: install frontend dependencies
install_dependencies "frontend" "frontend"

# Step 4: bring up Docker Compose
echo "🔹 Bringing up Docker Compose..."
cd "$ROOT_DIR"
docker compose down
docker compose up -d --build

echo "🔹 Seeding development data..."
for attempt in {1..12}; do
  if docker compose exec -T backend yarn seed 100; then
    break
  fi

  if [ "$attempt" -eq 12 ]; then
    echo "❌ Development seed failed after backend startup retries."
    exit 1
  fi

  echo "⚠ Backend not ready for seeding yet. Retrying in 5 seconds..."
  sleep 5
done

echo "✅ Setup complete!"
echo "Frontend: https://$APP_DOMAIN"
echo "Backend: https://$API_DOMAIN"
echo "OCR Worker: http://localhost:6000"
echo "pgAdmin: http://localhost:8080 (Email: admin@example.com, Password: admin123)"
echo "Seed users: admin1@example.com through admin10@example.com (Password: Admin@123456)"
