#!/usr/bin/env bash
# snapshot-version.sh — freeze the current CSS build under a pinned version path.
#
# A pinned URL must serve identical bytes forever, so a snapshot is written once
# and never overwritten. Re-running for a version that already exists is an
# error, not a no-op: silently republishing different bytes at a pinned URL is
# precisely the failure this guards against.
#
# Usage:
#   scripts/snapshot-version.sh            # version from the latest git tag
#   scripts/snapshot-version.sh 1.3.2      # explicit version
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="${1:-$(git describe --tags --abbrev=0 2>/dev/null || true)}"
VERSION="${VERSION#v}"

if [ -z "$VERSION" ]; then
	echo "error: no version given and no git tag found" >&2
	exit 1
fi

SRC="src/static"
DEST="$SRC/v$VERSION"

for f in style.css style.min.css; do
	if [ ! -f "$SRC/$f" ]; then
		echo "error: $SRC/$f is missing — build before snapshotting" >&2
		exit 1
	fi
done

if [ -e "$DEST" ]; then
	echo "error: $DEST already exists." >&2
	echo "       Pinned versions are immutable. Cut a new version instead." >&2
	exit 1
fi

mkdir -p "$DEST"
cp "$SRC/style.css" "$SRC/style.min.css" "$DEST/"

echo "pinned v$VERSION"
for f in style.css style.min.css; do
	printf '  /v%s/%-14s %8s B\n' "$VERSION" "$f" "$(wc -c < "$DEST/$f" | tr -d ' ')"
done

echo
echo "Consumers can now pin this exact build:"
echo "  <link rel=\"stylesheet\" href=\"https://startr.style/v$VERSION/style.min.css\""
printf '        integrity="sha384-%s"\n' \
	"$(openssl dgst -sha384 -binary "$DEST/style.min.css" | openssl base64 -A)"
echo '        crossorigin="anonymous">'
