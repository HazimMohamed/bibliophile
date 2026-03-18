#!/usr/bin/env bash
# deploy.sh — Idempotent deploy script for Bibliophile
# Must be run as root (or with sudo).
# Usage: sudo ./deploy.sh [--skip-deps]
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/opt/bibliophile"
SERVICE_NAME="bibliophile-backend"
NGINX_CONF_SRC="$REPO_DIR/nginx/bibliophile.conf"
SYSTEMD_SRC="$REPO_DIR/systemd/$SERVICE_NAME.service"
SKIP_DEPS=false

for arg in "$@"; do
    case $arg in
        --skip-deps) SKIP_DEPS=true ;;
        *) echo "Unknown argument: $arg"; exit 1 ;;
    esac
done

# ── 1. Create system user ────────────────────────────────────────────────────
if ! id -u bibliophile &>/dev/null; then
    echo "→ Creating system user 'bibliophile'..."
    useradd --system --no-create-home --shell /usr/sbin/nologin bibliophile
else
    echo "→ User 'bibliophile' already exists."
fi

# ── 2. Sync repo to install dir (preserve data/) ────────────────────────────
echo "→ Syncing repo to $INSTALL_DIR..."
rsync -a --delete \
    --exclude='.git' \
    --exclude='data/' \
    --exclude='.env' \
    --exclude='__pycache__' \
    --exclude='*.pyc' \
    --exclude='node_modules' \
    --exclude='frontend/dist' \
    "$REPO_DIR/" "$INSTALL_DIR/"

# Ensure data dirs exist with correct ownership
mkdir -p "$INSTALL_DIR/data/books" "$INSTALL_DIR/data/annotations"
chown -R bibliophile:bibliophile "$INSTALL_DIR/data"

# ── 3. Python virtualenv + deps ──────────────────────────────────────────────
if [ "$SKIP_DEPS" = false ]; then
    echo "→ Setting up Python virtualenv..."
    python3 -m venv "$INSTALL_DIR/.venv"
    "$INSTALL_DIR/.venv/bin/pip" install --quiet --upgrade pip
    "$INSTALL_DIR/.venv/bin/pip" install --quiet -r "$INSTALL_DIR/requirements.txt"
else
    echo "→ Skipping Python deps (--skip-deps)."
fi

# ── 4. Build frontend ────────────────────────────────────────────────────────
if [ "$SKIP_DEPS" = false ]; then
    echo "→ Building frontend..."
    cd "$INSTALL_DIR/frontend"
    npm ci --silent
    npm run build --silent
    cd "$REPO_DIR"
else
    echo "→ Running frontend build (skipping npm ci)..."
    cd "$INSTALL_DIR/frontend"
    npm run build --silent
    cd "$REPO_DIR"
fi

# ── 5. Install nginx config ──────────────────────────────────────────────────
echo "→ Installing nginx config..."
cp "$NGINX_CONF_SRC" /etc/nginx/sites-available/bibliophile

if [ ! -L /etc/nginx/sites-enabled/bibliophile ]; then
    ln -s /etc/nginx/sites-available/bibliophile /etc/nginx/sites-enabled/bibliophile
fi

# Disable default site to avoid port 80 conflict
if [ -L /etc/nginx/sites-enabled/default ]; then
    echo "→ Disabling nginx default site..."
    rm /etc/nginx/sites-enabled/default
fi

nginx -t  # validate config before reloading

# ── 6. Install systemd service ───────────────────────────────────────────────
echo "→ Installing systemd service..."
cp "$SYSTEMD_SRC" /etc/systemd/system/$SERVICE_NAME.service
systemctl daemon-reload
systemctl enable $SERVICE_NAME

# ── 7. Restart services ──────────────────────────────────────────────────────
echo "→ Restarting services..."
systemctl restart $SERVICE_NAME
systemctl reload-or-restart nginx

# ── 8. Print Tailscale IP ────────────────────────────────────────────────────
echo ""
echo "✓ Deploy complete!"
TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || echo "unavailable — is Tailscale running?")
echo "  Tailscale IP : $TAILSCALE_IP"
echo "  Open on phone: http://$TAILSCALE_IP"
echo ""
echo "Verify:"
echo "  systemctl status $SERVICE_NAME"
echo "  curl http://localhost/api/books"
echo "  journalctl -u $SERVICE_NAME -f"
