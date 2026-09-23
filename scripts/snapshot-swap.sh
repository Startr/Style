#!/usr/bin/env bash
# snapshot-swap.sh — freeze the current Startr Swap build under a pinned version path.
#
# A pinned URL must serve identical bytes forever, so a snapshot is written once
# and never overwritten. Re-running for a version that already exists is an
# error, not a no-op: silently republishing different bytes at a pinned URL is
# precisely the failure this guards against. The gate in
# scripts/gates/startr-swap/check.py holds the pin afterwards.
#
# Usage:
#   scripts/snapshot-swap.sh 1        # writes src/static/v1/swap.js + swap.js.sha256
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="${1:-}"
VERSION="${VERSION#v}"

if [ -z "$VERSION" ]; then
	echo "usage: scripts/snapshot-swap.sh <version>   e.g. 1" >&2
	exit 1
fi

SRC="src/static/swap.js"
DEST="src/static/v$VERSION"

if [ ! -f "$SRC" ]; then
	echo "error: $SRC is missing" >&2
	exit 1
fi

if [ -e "$DEST/swap.js" ]; then
	echo "error: $DEST/swap.js already exists." >&2
	echo "       Pinned versions are immutable. Cut a new version instead." >&2
	exit 1
fi

mkdir -p "$DEST"
cp "$SRC" "$DEST/swap.js"
shasum -a 256 "$DEST/swap.js" | awk '{print $1}' > "$DEST/swap.js.sha256"

printf 'pinned /v%s/swap.js  %s B  sha256 %s…\n' \
	"$VERSION" "$(wc -c < "$DEST/swap.js" | tr -d ' ')" "$(cut -c1-12 "$DEST/swap.js.sha256")"

echo
echo "Consumers pin this exact build:"
echo "  <script defer src=\"https://startr.style/v$VERSION/swap.js\""
printf '          integrity="sha384-%s"\n' \
	"$(openssl dgst -sha384 -binary "$DEST/swap.js" | openssl base64 -A)"
echo '          crossorigin="anonymous"></script>'
