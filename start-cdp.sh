#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "/home/server/.config/chrome_cdp_profile" ]; then
    PROFILE_DIR="${CHROME_PROFILE_DIR:-/home/server/.config/chrome_cdp_profile}"
else
    PROFILE_DIR="${CHROME_PROFILE_DIR:-$SCRIPT_DIR/chrome_profile}"
fi
mkdir -p "$PROFILE_DIR"
export DISPLAY="${DISPLAY:-:0}"
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"
rm -f "$PROFILE_DIR"/Singleton* 2>/dev/null || true
PORT=${CDP_PORT:-9333}

# Check if already running
if curl -s --noproxy "*" "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
    echo "============================================================"
    echo "[INFO] Chrome CDP is ALREADY running and healthy on port $PORT!"
    echo "============================================================"
    exit 0
fi

# Find Chrome binary
CHROME_BIN=""
for candidate in google-chrome google-chrome-stable chromium chromium-browser /opt/google/chrome/chrome; do
    if command -v "$candidate" >/dev/null 2>&1; then
        CHROME_BIN="$(command -v "$candidate")"
        break
    elif [ -x "$candidate" ]; then
        CHROME_BIN="$candidate"
        break
    fi
done

if [ -z "$CHROME_BIN" ]; then
    echo "[ERROR] Google Chrome / Chromium not found. Please install Chrome."
    exit 1
fi

echo "Found Chrome at: $CHROME_BIN"
echo "Launching Chrome CDP on port $PORT..."

# Launch Chrome in background
nohup "$CHROME_BIN" \
    --remote-debugging-address=0.0.0.0 \
    --remote-debugging-port=$PORT \
    --remote-allow-origins="*" \
    --user-data-dir="$PROFILE_DIR" \
    --no-first-run \
    --no-default-browser-check \
    --no-sandbox \
    --disable-dev-shm-usage \
    --disable-background-timer-throttling \
    --disable-backgrounding-occluded-windows \
    --disable-renderer-backgrounding \
    "https://higgsfield.ai/ai/video" </dev/null > /dev/null 2>&1 &
disown || true

echo "Verifying CDP health on http://127.0.0.1:$PORT/json/version..."

for i in $(seq 1 10); do
    sleep 0.5
    if curl -s --noproxy "*" "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
        echo "============================================================"
        echo "[SUCCESS] Chrome CDP is active, bound, and ready for connections!"
        echo "  Port:     $PORT"
        echo "  Profile:  $PROFILE_DIR"
        echo "============================================================"
        exit 0
    fi
done

echo "============================================================"
echo "[INFO] Chrome process launched."
echo "============================================================"
