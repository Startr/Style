#!/usr/bin/env bash
# core-publish.sh — build the CSS from the core repo and publish it as the site's stylesheet.
#
# The core (Startr/WEB-startr.style.core) is the source of truth for the CSS;
# src/static/style.css is generated from it, not edited by hand. This builds
# the core into a temp dir, runs the core's parity check on the sheet it just
# built, and only then copies the result into DEST:
#
#   startr.css      -> DEST/style.css
#   startr.min.css  -> DEST/style.min.css, and DEST/startr.css (the /startr.css URL)
#   props.json      -> DEST/props.json, and DATA/props.json for the docs
#
# Nothing is copied unless the build and the parity check both pass.
#
# The live sheet is guarded. src/static/style.css floats: every consumer that
# links /style.css gets whatever sits there. The pinned copy of a release,
# src/static/v<version>/ (scripts/snapshot-version.sh), must serve the same
# bytes forever. So this refuses to overwrite src/static/style.css until the
# latest release has its snapshot, and until that snapshot holds the bytes the
# release tag shipped. A DEST other than src/static is not guarded.
#
# Usage (through make):
#   make core_publish                      # CORE=src/style-core  DEST=src/static  DATA=src/_data
#   make core_publish CORE=../WEB-startr.style.core DEST=/tmp/out DATA=/tmp/out
#   make core_publish V=1.3.3              # guard another version than the latest tag
#
# Environment (the make target passes these): CORE, DEST, DATA. Argument 1: version.
set -euo pipefail

cd "$(dirname "$0")/.."

CORE="${CORE:-src/style-core}"
DEST="${DEST:-src/static}"
DATA="${DATA:-src/_data}"
LIVE="src/static"

die() {
	echo "error: $*" >&2
	exit 1
}

# Physical path of a directory, empty when it does not exist yet.
physical() {
	(cd "$1" 2>/dev/null && pwd -P) || true
}

LIVE_P="$(physical "$LIVE")"
DEST_P="$(physical "$DEST")"

# ── Guard: pinned versions are never written ────────────────────────────────
if [ -n "$LIVE_P" ]; then
	case "$DEST_P" in
	"$LIVE_P"/v[0-9]*) die "refusing to write into $DEST: src/static/v<version>/ holds a pinned version, and pinned versions are immutable. Choose another DEST" ;;
	esac
fi

# ── Guard: the live sheet needs a snapshot of the release it holds ──────────
# This runs first, and needs nothing but git, so the refusal shows even when the
# core is not ready yet.
if [ -n "$LIVE_P" ] && [ "$DEST_P" = "$LIVE_P" ] && { [ -e "$DEST/style.css" ] || [ -e "$DEST/style.min.css" ]; }; then
	VERSION="${1:-$(git describe --tags --abbrev=0 2>/dev/null || true)}"
	VERSION="${VERSION#v}"
	[ -n "$VERSION" ] || die "no version given and no git tag found. Pass V=x.y.z"
	SNAP="$LIVE/v$VERSION"

	if [ ! -f "$SNAP/style.css" ] || [ ! -f "$SNAP/style.min.css" ]; then
		{
			echo "error: refusing to overwrite $LIVE/style.css."
			echo "       v$VERSION has no complete snapshot in $SNAP/ (it needs style.css and style.min.css)."
			echo "       $LIVE/style.css still holds the bytes v$VERSION shipped. Overwrite it now and"
			echo "       the pinned URL /v$VERSION/style.css can never serve them again. A pinned URL"
			echo "       must serve the same bytes forever, so the snapshot comes first."
			echo "       Freeze the current sheet, commit the snapshot, then run this again:"
			echo "           make version_snapshot          (V=$VERSION to name the version)"
		} >&2
		exit 1
	fi

	# The snapshot must be the release, not a copy of some later build.
	if git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null 2>&1; then
		for f in style.css style.min.css; do
			if git cat-file -e "v$VERSION:$LIVE/$f" 2>/dev/null && ! git show "v$VERSION:$LIVE/$f" | cmp -s - "$SNAP/$f"; then
				{
					echo "error: refusing to overwrite $LIVE/style.css."
					echo "       $SNAP/$f is not what tag v$VERSION shipped, so /v$VERSION/$f would lie."
					echo "       Compare: git show v$VERSION:$LIVE/$f | diff - $SNAP/$f"
				} >&2
				exit 1
			fi
		done
	fi
	echo "guard: $SNAP/ holds v$VERSION; $LIVE/style.css may be replaced"
fi

# ── The core must be ready to build ──────────────────────────────────────────
command -v bun >/dev/null || die "bun is not on PATH (the core builds with bun)"
[ -f "$CORE/build.ts" ] || die "no build.ts in CORE=$CORE. Point CORE at the core repo, e.g. CORE=../WEB-startr.style.core"
[ -f "$CORE/scripts/parity.ts" ] || die "no scripts/parity.ts in CORE=$CORE. Pull a newer core first (make style_core_update)"
[ -d "$CORE/node_modules" ] || die "CORE=$CORE has no node_modules. Run: (cd $CORE && bun install)"
# An older build.ts ignores STARTR_DIST and writes into CORE/dist, inside this repo.
grep -q STARTR_DIST "$CORE/build.ts" || die "CORE=$CORE/build.ts predates STARTR_DIST and would write into its own dist/. Pull a newer core first (make style_core_update)"

# ── Build the core into a temp dir ───────────────────────────────────────────
TMP="$(mktemp -d "${TMPDIR:-/tmp}/startr-core-publish.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

echo "building $CORE"
if ! BUILD_LOG="$(cd "$CORE" && STARTR_DIST="$TMP" bun run build 2>&1)"; then
	echo "$BUILD_LOG" >&2
	die "the core failed to build, so nothing was published"
fi
echo "$BUILD_LOG" | grep -E '^(startr\.css|props\.json)' | sed 's/^/  /' || true

for f in startr.css startr.min.css props.json; do
	[ -s "$TMP/$f" ] || die "the build wrote no $f (build.ts reports a missing props.json as a warning). Nothing was published"
done

# props.json must describe exactly the sheet that is about to ship.
SUM="$(shasum -a 256 "$TMP/startr.css" | awk '{print $1}')"
grep -q "\"sha256\":\"$SUM\"" "$TMP/props.json" || die "props.json does not describe the startr.css just built (sha256 mismatch). Nothing was published"

# ── Parity: does the build still generate the published sheet? ──────────────
echo "parity check"
if ! PARITY_LOG="$(cd "$CORE" && bun run parity --c "$TMP/startr.css" 2>&1)"; then
	echo "$PARITY_LOG" >&2
	die "parity failed: the build drifted from the published sheet. Fix the core, or allow the difference in its parity-allow.d/ with a reason. Nothing was published"
fi
echo "$PARITY_LOG" | tail -n 1 | sed 's/^/  /'

# ── Publish ──────────────────────────────────────────────────────────────────
# cat > writes into the existing file, so a hardlinked style.css keeps its inode.
mkdir -p "$DEST" "$DATA"
cat "$TMP/startr.css" >"$DEST/style.css"
cat "$TMP/startr.min.css" >"$DEST/style.min.css"
cat "$TMP/startr.min.css" >"$DEST/startr.css"
cat "$TMP/props.json" >"$DEST/props.json"
cat "$TMP/props.json" >"$DATA/props.json"

echo "published (startr.css sha256 ${SUM:0:12}...)"
for f in "$DEST/style.css" "$DEST/style.min.css" "$DEST/startr.css" "$DEST/props.json" "$DATA/props.json"; do
	printf '  %-30s %8s B\n' "$f" "$(wc -c <"$f" | tr -d ' ')"
done

# A snapshot only protects the pin once it is in the repo with the new sheet.
if [ -n "${SNAP:-}" ] && [ -z "$(git ls-files "$SNAP" 2>/dev/null)" ]; then
	echo "note: $SNAP/ is not committed. Commit it together with the new $LIVE/style.css, or v$VERSION loses its bytes from the repo."
fi
