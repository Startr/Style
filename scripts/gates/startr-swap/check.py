#!/usr/bin/env python3
"""Startr Swap stays publishable, and a pinned version stays pinned.

`src/static/swap.js` is written to be published for other projects,
including static sites. That claim decays quietly: the first time somebody
reaches for `/pages/` or a `data-cy` hook to fix a bug, the file still works
here and silently stops working anywhere else. Nothing would fail, and the
next person to copy it out would find out.

So this asserts the three properties that make it a library rather than a feature:

  1. IT NAMES NOTHING IN AN APPLICATION. Every host-specific concern has to
     leave through an attribute value or an event listener, which is the whole
     design. A token from an application appearing in the file means one did not.

  2. IT IS NOT GROWING INTO WHAT IT REPLACES. htmx is 16,367 bytes gzipped for
     the three attributes this covers. The ceiling is half of that: enough room
     to fix real bugs, not enough to drift into a framework.

  3. PINNED VERSIONS ARE IMMUTABLE. Every src/static/v*/swap.js matches the
     sha256 written beside it (swap.js.sha256) by scripts/snapshot-swap.sh.

The demo pages under /demo/swap/ prove the other half, that two bare documents
actually swap.

    scripts/gates/startr-swap/check.py             # report
    scripts/gates/startr-swap/check.py --check     # gate: non-zero on failure
    scripts/gates/startr-swap/check.py --self-test # prove the gate can fail
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
LIBRARY = ROOT / "src/static/swap.js"
STATIC = ROOT / "src/static"

# Half of htmx gzipped (16,367 bytes), which is the thing this replaces.
CEILING_GZIP = 8192

# Words that only mean something inside an application. `htmz` is deliberately
# absent: crediting the lineage is not a dependency on it.
FORBIDDEN = (
    "sage",
    "sprig",
    "svelte",
    "jinja",
    "fastapi",
    "htmx",
    "ai-ui",
    "data-cy",
    "/pages/",
)


def pinned() -> list[tuple[str, str, str]]:
    """(relative path, wanted digest, actual digest) for every pinned swap.js."""
    pins: list[tuple[str, str, str]] = []
    for path in sorted(STATIC.glob("v*/swap.js")):
        rel = str(path.relative_to(ROOT))
        sha = path.with_name("swap.js.sha256")
        want = sha.read_text().strip() if sha.exists() else "(no .sha256 beside it)"
        got = hashlib.sha256(path.read_bytes()).hexdigest()
        pins.append((rel, want, got))
    return pins


def findings(source: str, size_gzip: int, pins: list[tuple[str, str, str]]) -> list[str]:
    """Every way the file has stopped being publishable, named."""
    out: list[str] = []
    for word in FORBIDDEN:
        for n, line in enumerate(source.splitlines(), 1):
            if word in line.lower():
                out.append(f"line {n} names `{word}` — that is an application, not a library")
    for rel, want, got in pins:
        if want != got:
            out.append(f"{rel} no longer matches its pin — pinned versions are immutable")
    if size_gzip > CEILING_GZIP:
        out.append(
            f"{size_gzip} bytes gzipped is over the {CEILING_GZIP} ceiling "
            "— half of htmx, which is what this replaces"
        )
    # A published file has to say what it is and where it came from.
    if not re.search(r"htmz.*Lean Rada", source):
        out.append("the htmz attribution (MIT, (c) Lean Rada) is missing from the header")
    return out


def measure(path: Path) -> tuple[str, int]:
    raw = path.read_bytes()
    return raw.decode("utf-8"), len(gzip.compress(raw, 9))


def report(problems: list[str], size_gzip: int, pins: list[tuple[str, str, str]]) -> None:
    for p in problems:
        print(f"  ✗ {p}")
    if not problems:
        print(
            f"PASS — swap.js names no application "
            f"({size_gzip} bytes gzipped, ceiling {CEILING_GZIP}); "
            f"{len(pins)} pinned version(s) intact."
        )


def self_test() -> int:
    """Break it four ways on a copy and require the check to notice each one."""
    source, size = measure(LIBRARY)
    pins = pinned()
    if findings(source, size, pins):
        print("SELF-TEST INCONCLUSIVE — the real file is already failing.")
        return 1

    breaks = {
        "an application token": (source + "\n// fetch the sprig catalog\n", size),
        "a route prefix": (source.replace("data-swap", "/pages/data-swap", 1), size),
        "growth past the ceiling": (source, CEILING_GZIP + 1),
        "a pinned version that changed": (source, size),
    }
    missed = [
        name
        for name, (text, n) in breaks.items()
        if not findings(
            text,
            n,
            pins if name != "a pinned version that changed"
            else [("src/static/v0/swap.js", "a" * 64, "b" * 64)],
        )
    ]
    if missed:
        print(f"FAIL — the check did not detect: {', '.join(missed)}")
        return 1
    print(f"PASS — the check detected all {len(breaks)} perturbations.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="exit non-zero on any finding")
    ap.add_argument("--self-test", action="store_true", help="prove the check can fail")
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    if not LIBRARY.exists():
        print(f"FAIL — {LIBRARY.relative_to(ROOT)} is missing.")
        return 1

    source, size = measure(LIBRARY)
    pins = pinned()
    problems = findings(source, size, pins)
    report(problems, size, pins)
    return 1 if (problems and args.check) else 0


if __name__ == "__main__":
    sys.exit(main())
