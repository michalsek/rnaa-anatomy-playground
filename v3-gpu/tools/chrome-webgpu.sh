#!/bin/sh
# Drop-in Chrome for the anatomy skill's capture.mjs / drive.mjs (they read $CHROME_PATH and spawn it
# with their own fixed flag list + "about:blank"). This script appends extra flags and execs the
# real binary, so stderr ("DevTools listening on ws://…") still reaches chrome-port.mjs unchanged.
#   CHROME_PATH=$PWD/chrome-webgpu.sh node ~/.claude/skills/anatomy/scripts/drive.mjs page.html '[…]'
# Extra flags: $CHROME_EXTRA_FLAGS (space-separated) — defaults to full-precision timestamp queries.
REAL="${CHROME_REAL:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
exec "$REAL" "$@" ${CHROME_EXTRA_FLAGS:---enable-unsafe-webgpu --enable-webgpu-developer-features}
