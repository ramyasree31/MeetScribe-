#!/bin/bash
set -e

PROFILE_ID="${PROFILE_ID:-bot001}"
PROFILE_DIR="/app/profiles/${PROFILE_ID}"
mkdir -p "$PROFILE_DIR"

# Remove any stale singleton locks
rm -f "$PROFILE_DIR/SingletonLock" "$PROFILE_DIR/SingletonCookie" "$PROFILE_DIR/SingletonSocket"

# Virtual display
export DISPLAY=:99
Xvfb :99 -screen 0 1280x800x24 -ac &
sleep 2

# VNC server (no password)
x11vnc -display :99 -nopw -forever -shared -quiet &
sleep 1

# noVNC websocket proxy → browser UI at port 6080
websockify --web /usr/share/novnc 6080 localhost:5900 &
sleep 1

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Bot Profile Authentication (ARM64 native Chromium)"
echo "═══════════════════════════════════════════════════════"
echo "  1. Open http://localhost:6080/vnc.html in your browser"
echo "  2. Click 'Connect'"
echo "  3. Sign into riteshmeetscribe@gmail.com"
echo "  4. Visit https://meet.google.com — confirm you see your meetings"
echo "  5. Close the browser window here OR press Ctrl+C"
echo "═══════════════════════════════════════════════════════"
echo ""

# Find Playwright's Chromium binary
CHROMIUM_BIN=$(find /root/.cache/ms-playwright -name "chrome" -o -name "chromium" 2>/dev/null | grep -v crash | head -1)
if [ -z "$CHROMIUM_BIN" ]; then
  CHROMIUM_BIN=$(which chromium 2>/dev/null || which chromium-browser 2>/dev/null)
fi

echo "Using Chromium: $CHROMIUM_BIN"

"$CHROMIUM_BIN" \
  --no-sandbox \
  --disable-setuid-sandbox \
  --no-first-run \
  --no-default-browser-check \
  --disable-blink-features=AutomationControlled \
  --disable-infobars \
  --password-store=basic \
  --window-size=1280,800 \
  --user-data-dir="$PROFILE_DIR" \
  https://accounts.google.com/ &

CHROME_PID=$!
wait $CHROME_PID || true

echo ""
echo "Browser closed. Exporting cookies from profile..."

node -e "
const { chromium } = require('./node_modules/playwright');
const fs = require('fs');
const path = require('path');
const profileDir = process.env.PROFILE_DIR || '$PROFILE_DIR';

(async () => {
  // Remove locks before opening
  for (const f of ['SingletonLock','SingletonCookie','SingletonSocket']) {
    try { fs.unlinkSync(path.join(profileDir, f)); } catch {}
  }

  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--password-store=basic'],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const allCookies = await ctx.cookies([
    'https://google.com',
    'https://accounts.google.com',
    'https://myaccount.google.com',
    'https://meet.google.com',
    'https://workspace.google.com',
  ]);

  const google = allCookies.filter(c => c.domain.endsWith('.google.com') || c.domain === 'google.com');

  // Write to both bot001 and bot001-fresh so the bot picks them up immediately
  for (const outDir of [profileDir, '/app/profiles/bot001-fresh']) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'cookies.json'), JSON.stringify(google, null, 2));
  }

  console.log('Exported ' + google.length + ' cookies → ' + profileDir + '/cookies.json');
  await ctx.close();
})().catch(e => { console.error(e.message); process.exit(1); });
" PROFILE_DIR="$PROFILE_DIR"

echo ""
echo "✅ Done! Profile saved to: $PROFILE_DIR"
echo "   The bot will now join meetings as a signed-in user."
