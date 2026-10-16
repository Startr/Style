/**
 * Guards for scripts/ingest.ts. Run with `bun test scripts`.
 *
 * Every case reads a design example with ingest-props.json, a frozen props.json, so the kit can grow without moving these tests.
 * Two suites touch the live kit: "the default manifest", which runs the CLI the way a user does (it builds C into a temp dir), and "the three Trellis drafts against the live kit".
 *
 * Fixtures (test/fixtures/ingest-*):
 *   ingest-buckets.css   one rule per bucket, each marked by a comment: "want: B". The test compares the marks to the tool's answer.
 *   ingest-flags.css     the flags: off-origin, literals, classes, !important, max-width queries
 *   ingest-nested.css    native CSS nesting
 *   ingest-page.html     an HTML page: <style>, CSS code blocks, template code blocks, inline props with every lint
 *   ingest-props.json    the kit's props.json, frozen
 *
 * The smoke suite reads the three Trellis design drafts if they sit next to this repo (../WEB-AI-Sage-Trellis/crm/docs/design-drafts) and skips itself if not.
 * Its totals are tied to the sha256 of each draft. If a draft changes, the exact-totals test says so and stands down; the invariants still run. Re-baseline from `bun run ingest <draft> --json`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postcss from "postcss";
import type { Manifest } from "./manifest.ts";
import { analyzeSelector, BUCKETS, colorLiterals, FLAG_KINDS, formatText, ingest, LINT_KINDS, loadKit, manifestFromBuild, parseComplex, PRECEDENCE, resolveVars, type Bucket, type Report } from "./ingest.ts";

const ROOT = join(import.meta.dir, "..");
const SCRIPT = join(ROOT, "scripts/ingest.ts");
const FIXTURES = join(ROOT, "test/fixtures");
const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");
const manifest = JSON.parse(fixture("ingest-props.json")) as Manifest;
const kit = loadKit(manifest, "ingest-props.json");

/** Ingest a fixture under the name the CLI would print. */
const run = (name: string, text = fixture(name)) => ingest(`test/fixtures/${name}`, text, kit);
/** Ingest a snippet as CSS. */
const css = (text: string) => ingest("snippet.css", text, kit);
/** The one rule a snippet holds. */
const only = (text: string) => {
  const report = css(text);
  expect(report.rules).toHaveLength(1);
  return report.rules[0];
};
const lineOf = (text: string, needle: string) => text.split("\n").findIndex((l) => l.includes(needle)) + 1;
const sum = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);

/** The "want: X" comments in a fixture, by the line of the node they mark. */
function wants(text: string): Map<number, string> {
  const found = new Map<number, string>();
  postcss.parse(text).walkComments((comment) => {
    const m = /^want:\s*(.+)$/.exec(comment.text.trim());
    const next = comment.next();
    if (m && next?.source?.start) found.set(next.source.start.line, m[1].trim());
  });
  return found;
}

describe("buckets (fixture)", () => {
  const text = fixture("ingest-buckets.css");
  const report = run("ingest-buckets.css");
  const marks = wants(text);

  test("every rule has the bucket its comment names, and every comment has a rule", () => {
    const wrong = report.rules.filter((r) => marks.get(r.line) !== r.bucket).map((r) => `${r.line} ${r.selector}: want ${marks.get(r.line)}, got ${r.bucket}`);
    expect(wrong).toEqual([]);
    const lines = new Set(report.rules.map((r) => r.line));
    expect([...marks.keys()].filter((line) => !lines.has(line))).toEqual([]);
  });

  test("the fixture covers every bucket", () => {
    expect(new Set(marks.values())).toEqual(new Set(BUCKETS));
    for (const bucket of BUCKETS) expect(report.summary.buckets[bucket]).toBeGreaterThan(0);
  });

  test("the buckets add up to the rules, and a rule names a need unless it is plain A", () => {
    expect(sum(report.summary.buckets)).toBe(report.summary.rules);
    expect(report.summary.rules).toBe(report.rules.length);
    for (const rule of report.rules) {
      if (rule.bucket === "A") expect(rule.needs).toEqual([]);
      else expect(rule.needs.some((n) => n.startsWith(`${rule.bucket}:`))).toBe(true);
    }
  });

  test("the display order and the precedence are the ones the contract states", () => {
    expect([...BUCKETS]).toEqual(["A", "A-var", "A′", "B", "C", "D", "E", "F", "G"]);
    expect([...PRECEDENCE]).toEqual(["G", "B", "C", "D", "F", "E", "A-var", "A′", "A"]);
    expect(Object.keys(report.summary.buckets)).toEqual([...BUCKETS]);
  });

  test("rules come out in source order, each with a file and a line", () => {
    const lines = report.rules.map((r) => r.line);
    expect(lines).toEqual([...lines].sort((a, b) => a - b));
    expect(report.rules.every((r) => r.file === "test/fixtures/ingest-buckets.css" && r.source === "css")).toBe(true);
  });
});

describe("A: the prop from props.json", () => {
  test("--radius beats --br, which also sets border-right", () => {
    const rule = only("[data-a] { border-radius: 14px; }");
    expect(rule.suggestion).toBe("--radius:14px");
  });

  test("border-right has only --br, and the collision is named", () => {
    const rule = only("[data-a] { border-right: 1px solid red; }");
    expect(rule.suggestion).toContain("--br:1px solid red");
    expect(rule.suggestion).toContain("--br also sets border-radius");
  });

  test("a state or tier the safer prop lacks does not push the rule onto the collision prop", () => {
    expect(only("a:hover { border-radius: 4px; }").suggestion).toContain("--radius:4px");
    expect(only("a:hover { box-shadow: 0 1px red; }").suggestion).toContain("--boxs-hover:0 1px red");
  });

  test("a rule becomes a style attribute: the declarations in order, !important dropped", () => {
    const rule = only("[data-a] { display: flex; gap: 8px; padding: 12px 16px !important; }");
    expect(rule.suggestion).toBe("--d:flex; --g:8px; --p:12px 16px");
  });

  test("a min-width query becomes a tier, to the nearest breakpoint when it is no breakpoint", () => {
    expect(css("@media (min-width: 768px) { [data-a] { padding: 24px; } }").rules[0].suggestion).toBe("--p-md:24px");
    const near = css("@media (min-width: 720px) { [data-a] { padding: 24px; } }").rules[0];
    expect(near.suggestion).toContain("--p-md:24px");
    expect(near.suggestion).toContain("min-width:720px is not a kit breakpoint; md is 768px");
    expect(css("@media (width >= 1024px) { [data-a] { padding: 24px; } }").rules[0].suggestion).toBe("--p-lg:24px");
    expect(css("@media (min-width: 40em) { [data-a] { padding: 24px; } }").rules[0].suggestion).toContain("--p-sm:24px");
    expect(css("@media print { [data-a] { padding: 0; } }").rules[0].suggestion).toBe("--p-pt:0");
  });

  test("a prop that lacks the tier is named and set at the base", () => {
    const rule = only("@media (min-width: 768px) { [data-a] { font-family: serif; } }");
    expect(rule.suggestion).toContain("--ff:serif");
    expect(rule.suggestion).toContain("no -md tier for --ff");
  });

  test("shorthands the kit writes as several props", () => {
    expect(only("[data-a] { place-items: center; }").suggestion).toContain("--ai:center; --ji:center");
    expect(only("[data-a] { font: inherit; }").suggestion).toContain("--ff:inherit; --size:inherit; --weight:inherit; --lh:inherit");
    expect(only("[data-a] { inset: 0; }").suggestion).toBe("--inset:0");
    expect(only("[data-a] { inset: 0 auto auto 0; }").suggestion).toBe("--top:0; --right:auto; --bottom:auto; --left:0");
    expect(only("[data-a] { padding-block: 8px 12px; }").suggestion).toContain("--pt:8px; --pb:12px");
    expect(only("[data-a] { margin-inline: auto; }").suggestion).toBe("--mx:auto");
    expect(only('[data-a] { font: italic 600 .8rem/1.4 "Sora", sans-serif; }').suggestion).toContain('--fs:italic; --weight:600; --size:.8rem; --lh:1.4; --ff:"Sora", sans-serif');
  });

  test("the kit's own width prop already does what width: var(--w) asks", () => {
    const rule = only("[data-bar] i { width: var(--w); height: 100%; }");
    expect(rule.suggestion).toContain("--h:100%");
    expect(rule.suggestion).not.toContain("--w:var(--w)");
    expect(rule.suggestion).toContain("the inline --w:N is enough");
  });

  test("a vendor-prefixed twin is left to autoprefixer", () => {
    expect(only("[data-a] { -webkit-user-select: none; user-select: none; }").suggestion).toBe("--us:none");
  });

  test("a descendant selector with no state is still A: the props go on that element", () => {
    expect(only("[data-card] > div h2 { margin: 0; }").bucket).toBe("A");
  });
});

describe("A-var and A′", () => {
  test("a data attribute's value keys the rule; a macro emits the props", () => {
    const rule = only('[data-st^="done"], [data-st="executed"] { color: var(--green); border-color: var(--green); }');
    expect(rule.bucket).toBe("A-var");
    expect(rule.suggestion).toBe('macro on data-st^="done" | data-st="executed" emits --c:var(--green); --bc:var(--green)');
  });

  test("a second data attribute in the compound is a variant; the first is the hook", () => {
    expect(only("[data-card] { color: red; }").bucket).toBe("A");
    expect(only("[data-card][data-alert] { color: red; }").bucket).toBe("A-var");
    expect(only("td[data-main] { color: red; }").bucket).toBe("A");
    expect(only('[data-card] td[data-meta="x"] { color: red; }').bucket).toBe("A-var");
  });

  test("a class modifier is a variant, a state word is a state", () => {
    expect(only(".chip.done { color: red; }").bucket).toBe("A-var");
    expect(only(".chip.on { color: red; }").bucket).toBe("B");
    expect(only(".chip.on { color: red; }").suggestion).toContain("--c-on:red");
  });

  test("SVG presentation properties go to markup attributes", () => {
    const rule = only("svg { width: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; }");
    expect(rule.bucket).toBe("A′");
    expect(rule.suggestion).toBe('--w:16px; attrs: fill="none" stroke="currentColor" stroke-width="1.8"');
  });
});

describe("B: the element's own state, with the suffix props.json lists", () => {
  const cases: [string, string][] = [
    ["a:hover", "hover"],
    ["a:focus-visible", "focus"],
    ["a:focus", "focus"],
    ["a:active", "active"],
    ["a[aria-current]", "on"],
    ['a[aria-current="page"]', "on"],
    ["a[aria-selected]", "on"],
    ['a[aria-selected="true"]', "on"],
    ['a[aria-pressed="true"]', "on"],
    ['a[aria-expanded="true"]', "on"],
    ["details[open]", "on"],
    ["input:checked", "on"],
    ["a[data-on]", "on"],
    ["a[data-open]", "on"],
    ["a[data-show]", "on"],
  ];
  for (const [selector, state] of cases) {
    test(`${selector} is ${state}`, () => {
      const rule = only(`${selector} { color: red; }`);
      expect(rule.bucket).toBe("B");
      expect(rule.suggestion).toContain(`--c-${state}:red`);
    });
  }

  test(":focus warns that the kit's focus is :focus-visible", () => {
    expect(only("a:focus { color: red; }").suggestion).toContain("the kit's focus is :focus-visible");
  });

  test("script-toggled attributes say to rename them to data-on", () => {
    expect(only("a[data-swapping] { color: red; }").suggestion).toContain("toggle data-on instead");
  });

  test("a property the state does not offer stays at the base, and the missing suffix is named once", () => {
    const rule = only("a:hover { color: red; font-weight: 600; letter-spacing: 1px; }");
    expect(rule.suggestion).toContain("--c-hover:red");
    expect(rule.suggestion).toContain("--weight:600");
    expect(rule.suggestion).toContain("no -hover for --weight, --ls; set them at the base");
  });

  test("two states on one element: the stronger one is written, and the missing AND is said", () => {
    const rule = only("a[aria-current]:hover { color: red; }");
    expect(rule.bucket).toBe("B");
    expect(rule.suggestion).toContain("--c-on:red");
    expect(rule.suggestion).toContain("the kit has no AND");
  });

  test("a state beside a tier cannot be both: the tier is dropped and the loss is said", () => {
    const rule = only("@media (min-width: 768px) { a:hover { color: red; } }");
    expect(rule.suggestion).toContain("--c-hover:red");
    expect(rule.suggestion).toContain("no tier-and-state names");
  });

  test("a state the kit lacks is G, not B", () => {
    for (const sel of ["a:disabled", "a:invalid", "a:visited", "a:not(:hover)", "a:target"]) expect(only(`${sel} { color: red; }`).bucket).toBe("G");
  });
});

describe("C: relational", () => {
  test("a state on the direct parent is --x-in-on or --x-in-hover", () => {
    expect(only("[aria-current] > svg { opacity: .5; }").suggestion).toBe("--op-in-on:.5");
    expect(only("a:hover > i { color: red; }").suggestion).toBe("--c-in-hover:red");
    expect(only("a:focus-visible > i { color: red; }").suggestion).toBe("--c-in-hover:red");
  });

  test("a space combinator may mean a deeper descendant, and the note says so", () => {
    const rule = only("[aria-current] svg { opacity: .5; }");
    expect(rule.bucket).toBe("C");
    expect(rule.suggestion).toContain("--op-in-on:.5");
    expect(rule.suggestion).toContain("reaches direct children only");
  });

  test("a state more than one level up needs markup", () => {
    const rule = only("[aria-current] .a b { opacity: .5; }");
    expect(rule.suggestion).toContain("more than one level up");
  });

  test("a parent :active has no -in- state", () => {
    expect(only("a:active > i { color: red; }").suggestion).toContain("has no -in- state");
  });

  const relational = [
    "li:last-child",
    "li:first-child",
    "li:only-child",
    "li:nth-child(2n)",
    "li:nth-of-type(2)",
    "h2 + p",
    "h2 ~ p",
    "div:has(> img)",
    "div:focus-within",
    "p::before",
    "p::after",
    "p:before",
  ];
  for (const selector of relational) {
    test(`${selector} needs markup or a restructure`, () => {
      expect(only(`${selector} { color: red; }`).bucket).toBe("C");
    });
  }

  test("::before becomes an element, and the parent's state becomes -in-", () => {
    const rule = only('[data-pill]::before { content: ""; width: 6px; height: 6px; background: var(--primary); }');
    expect(rule.suggestion).toBe('markup for ::before: <i style="--w:6px; --h:6px; --bg:var(--primary)">');
    const on = only('[data-track] li[data-on]::before { content: ""; background: var(--primary); }');
    expect(on.bucket).toBe("B");
    expect(on.suggestion).toBe('markup for ::before: <i style="--bg-in-on:var(--primary)">');
  });

  test("a separator's text moves into the markup", () => {
    expect(only('td ~ td::before { content: "\\00a0·\\00a0"; }').suggestion).toContain('becomes text or an element in the markup');
  });

  test("an ancestor with an attribute value is a condition; a bare hook is not", () => {
    const rule = only(':root[data-theme="dark"] [data-a] { color: red; }');
    expect(rule.bucket).toBe("C");
    expect(rule.needs).toContain('C: ancestor [data-theme="dark"]');
    expect(only("[data-card] [data-a] { color: red; }").bucket).toBe("A");
  });

  test("::placeholder and ::selection have no element to carry props", () => {
    expect(only("input::placeholder { color: red; }").bucket).toBe("G");
    expect(only("p::selection { color: red; }").bucket).toBe("G");
  });
});

describe("D: motion", () => {
  test("a transition takes the --dur and --ease tokens", () => {
    const rule = only("[data-a] { transition: background .15s, color .3s cubic-bezier(.2, .8, .2, 1), opacity .45s; }");
    expect(rule.bucket).toBe("D");
    expect(rule.suggestion).toBe("--tn:background var(--dur-1), color var(--dur-2) var(--ease-out), opacity var(--dur-3)");
  });

  test("a duration far from a token stays as written", () => {
    expect(only("[data-a] { transition: color 1.2s; }").suggestion).toBe("--tn:color 1.2s");
    expect(only("[data-a] { transition: color .4s; }").suggestion).toBe("--tn:color .4s");
  });

  test("an animation becomes --anim with the stagger inside and a fallback on --i", () => {
    const text = `
      @keyframes lift { from { opacity: 0; transform: translate(var(--dx, 0), 6px); } to { opacity: 1; transform: none; } }
      [data-a] { animation: lift .5s cubic-bezier(.2, .8, .2, 1) both; animation-delay: calc(var(--i) * 45ms); }`;
    const report = css(text);
    const rule = report.rules.find((r) => r.selector === "[data-a]")!;
    expect(rule.suggestion).toBe("--anim:st-rise var(--dur-3) var(--ease-out) calc(var(--i, 0) * 45ms) both");
    expect(report.rules.find((r) => r.selector === "@keyframes lift")!.suggestion).toContain("reads as st-rise");
  });

  const shapes: [string, string][] = [
    ["from { opacity: 0 }", "st-fade"],
    ["from { opacity: 0; transform: translateY(8px) }", "st-rise"],
    ["from { opacity: 0; transform: translate(var(--dx, 0), 6px) }", "st-rise"],
    ["from { opacity: 0; transform: translateX(24px) }", "st-slide-in"],
    ["from { opacity: 0; transform: scale(.9) }", "st-pop"],
    ["to { transform: rotate(360deg) }", "spin"],
  ];
  for (const [steps, name] of shapes) {
    test(`@keyframes { ${steps} } reads as ${name}`, () => {
      expect(css(`@keyframes k { ${steps} }`).rules[0].suggestion).toContain(`reads as ${name}`);
    });
  }

  test("keyframes that match nothing say so", () => {
    expect(css("@keyframes k { from { width: 0 } to { width: 100% } }").rules[0].suggestion).toContain("no kit keyframes match");
  });

  test("the reduced-motion reset is redundant: the kit zeroes motion for everyone", () => {
    const rule = css("@media (prefers-reduced-motion: reduce) { [data-a] * { transition: none !important; animation: none !important; } }").rules[0];
    expect(rule.bucket).toBe("D");
    expect(rule.suggestion).toContain("redundant");
    const slow = css("@media (prefers-reduced-motion: reduce) { [data-a] { animation-duration: 1.5s; } }").rules[0];
    expect(slow.suggestion).toContain("where this rule only slows them");
    expect(css("@media (prefers-reduced-motion: reduce) { [data-a] { color: red; transition: none; } }").rules[0].suggestion).not.toContain("redundant");
  });
});

describe("E: visual primitives", () => {
  test("a gradient on a background is a value for --bg", () => {
    const rule = only("[data-a] { background: linear-gradient(135deg, red, blue); }");
    expect(rule.bucket).toBe("E");
    expect(rule.suggestion).toContain("--bg:linear-gradient(135deg, red, blue)");
  });

  test("a gradient clipped to the text is --text-grad with a transparent colour", () => {
    const rule = only("[data-a] { background: linear-gradient(red, blue); -webkit-background-clip: text; background-clip: text; color: transparent; }");
    expect(rule.bucket).toBe("E");
    expect(rule.suggestion).toContain("--text-grad:linear-gradient(red, blue); --c:transparent");
  });

  test("a gradient text under a parent state keeps --text-grad at the base and moves only the colour", () => {
    const rule = only("[aria-current] > span { background: linear-gradient(red, blue); background-clip: text; color: transparent; }");
    expect(rule.suggestion).toContain("--text-grad:linear-gradient(red, blue); --c-in-on:transparent");
    expect(rule.suggestion).toContain("the colour state shows or hides it");
  });

  test("a shadow is E only when its colour is not ink", () => {
    expect(only("[data-a] { box-shadow: 0 8px 20px #5a22ff40; }").bucket).toBe("E");
    expect(only("[data-a] { box-shadow: 0 2px 4px #0003; }").bucket).toBe("A");
    expect(only("[data-a] { box-shadow: 0 2px 4px #1b1a2214, 0 6px 16px #5a22ff1f; }").bucket).toBe("E");
    expect(only("[data-a] { box-shadow: 0 0 8px var(--primary); }").bucket).toBe("E");
    expect(only("[data-a] { filter: drop-shadow(0 18px 22px #1b1a2224); }").bucket).toBe("A");
    expect(only("[data-a] { text-shadow: 0 0 6px hsl(280 90% 60%); }").bucket).toBe("E");
    expect(only("[data-a] { box-shadow: 0 2px 4px rgb(0 0 0 / 20%); }").bucket).toBe("A");
  });

  test("backdrop-filter is --bdf; color-mix points at --tone and --mix", () => {
    expect(only("[data-a] { backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }").suggestion).toBe("--bdf:blur(8px)");
    const mix = only("[data-a] { background: color-mix(in srgb, red 10%, white); }");
    expect(mix.bucket).toBe("E");
    expect(mix.suggestion).toContain("--tone:N");
  });

  test("a var() that points at a token the file defines is followed", () => {
    const report = css(":root { --lp-glow: linear-gradient(red, blue); --lp-ink: #1b1a22; } [data-a] { background: var(--lp-glow); } [data-b] { color: var(--lp-ink); }");
    expect(report.rules.map((r) => [r.selector, r.bucket])).toEqual([
      ["[data-a]", "E"],
      ["[data-b]", "A"],
    ]);
    expect(report.tokens).toHaveLength(1);
    expect(report.tokens[0].names).toEqual(["--lp-glow", "--lp-ink"]);
  });

  test("a private token named *grad* counts as a gradient when nothing defines it", () => {
    expect(only("[data-a] { background: var(--nav-grad); }").bucket).toBe("E");
    expect(only("[data-a] { background: var(--nav-surface); }").bucket).toBe("A");
  });

  test("resolveVars follows a chain, uses a fallback, and stops on a cycle", () => {
    const defs = new Map([
      ["--a", "var(--b)"],
      ["--b", "1px solid red"],
      ["--x", "var(--y)"],
      ["--y", "var(--x)"],
    ]);
    expect(resolveVars("var(--a)", defs)).toBe("1px solid red");
    expect(resolveVars("var(--missing, 3px)", defs)).toBe("3px");
    expect(resolveVars("var(--unknown)", defs)).toBe("var(--unknown)");
    expect(resolveVars("var(--x)", defs)).toContain("var(");
  });
});

describe("F: values the props take, and what they cannot", () => {
  test("env() and dvh work as values in the prop", () => {
    const rule = only("[data-a] { padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px)); }");
    expect(rule.bucket).toBe("F");
    expect(rule.suggestion).toContain("--pb:calc(10px + env(safe-area-inset-bottom, 0px))");
    expect(only("[data-a] { min-height: 100svh; }").bucket).toBe("F");
    expect(only("[data-a] { height: 100vh; }").bucket).toBe("A");
  });

  test("sticky is a value for --pos", () => {
    expect(only("[data-a] { position: sticky; top: 0; }").suggestion).toBe("--pos:sticky; --top:0");
  });

  test("a one-line ellipsis is --line-clamp:1", () => {
    const rule = only("[data-a] { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }");
    expect(rule.bucket).toBe("F");
    expect(rule.suggestion).toContain("--line-clamp:1");
    expect(rule.suggestion).not.toContain("--ws");
    expect(rule.suggestion).not.toContain("--of");
  });

  test("an ellipsis without the nowrap and hidden has only a hint", () => {
    const rule = only("[data-a] { text-overflow: ellipsis; }");
    expect(rule.suggestion).toContain("--line-clamp:1 gives a one-line ellipsis");
  });

  test("scroll-snap and scrollbar-width have no prop", () => {
    const rule = only("[data-a] { scrollbar-width: none; scroll-snap-type: x mandatory; scroll-margin-top: 4px; }");
    expect(rule.bucket).toBe("F");
    expect(rule.suggestion).toContain("no kit prop for scrollbar-width");
  });
});

describe("G: no kit answer", () => {
  test("a property with no prop is named", () => {
    const rule = only("table { width: 100%; border-collapse: collapse; }");
    expect(rule.bucket).toBe("G");
    expect(rule.suggestion).toBe("behaviour script: set attributes and inline geometry; no kit prop for border-collapse; mappable part: --w:100%");
  });

  test("a transition on geometry means a script sets that geometry", () => {
    const rule = only("[data-a] { left: 0; width: 0; transition: left .5s, width .5s; }");
    expect(rule.bucket).toBe("G");
    expect(rule.suggestion).toContain("transition on left, width");
    expect(only("[data-a] { transition: opacity .2s; }").bucket).toBe("D");
  });

  test("a media feature with no tier is G", () => {
    for (const q of ["(orientation: landscape)", "(prefers-color-scheme: dark)", "(min-resolution: 2dppx)", "(min-width: 600px), print"]) {
      expect(css(`@media ${q} { [data-a] { width: 50%; } }`).rules[0].bucket).toBe("G");
    }
    expect(css("@container (min-width: 400px) { [data-a] { width: 50% } }").rules[0].bucket).toBe("G");
  });

  test("an @font-face is a G rule, and its remote url is a flag", () => {
    const report = css('@font-face { font-family: X; src: url("https://cdn.example.com/x.woff2"); }');
    expect(report.rules.map((r) => [r.selector, r.bucket])).toEqual([["@font-face", "G"]]);
    expect(report.summary.flags["off-origin"]).toBe(1);
  });
});

describe("selectors", () => {
  test("a selector splits into compounds, combinators and parts", () => {
    const cx = parseComplex("a:not(.b, .c) > d ~ e[x='1'] #id.k::before");
    expect(cx.combinators).toEqual([">", "~", " "]);
    expect(cx.compounds.map((c) => c.tag)).toEqual(["a", "d", "e", null]);
    expect(cx.compounds[0].pseudos).toEqual([{ name: "not", args: ".b, .c" }]);
    expect(cx.compounds[2].attrs).toEqual([{ name: "x", op: "=", value: "1" }]);
    expect(cx.compounds[3]).toMatchObject({ ids: ["id"], classes: ["k"], elements: ["before"] });
  });

  test("a comma, a space or a > inside a string or parentheses does not split anything", () => {
    const cx = parseComplex('[data-x="a > b, c"] :is(h1, h2)');
    expect(cx.compounds).toHaveLength(2);
    expect(cx.compounds[0].attrs[0].value).toBe("a > b, c");
  });

  test("a legacy single-colon pseudo-element is a pseudo-element", () => {
    expect(analyzeSelector("p:before").pseudoElement).toBe("::before");
  });

  test("a sibling that carries the state is relational, not a parent state", () => {
    const info = analyzeSelector("input:checked + label");
    expect(info.parents).toEqual([]);
    expect(info.relational).toContain("sibling combinator +");
  });
});

describe("tokens", () => {
  test("a rule of custom properties only is a token block and is not counted", () => {
    const report = css(":root { --a: #fff; --b: 1px; } [data-x] { margin: 0; }");
    expect(report.summary.rules).toBe(1);
    expect(report.summary.tokenBlocks).toBe(1);
    expect(report.tokens[0]).toMatchObject({ selector: ":root", line: 1, names: ["--a", "--b"] });
  });

  test("a :root rule with a real declaration beside its tokens is a rule", () => {
    const report = css(":root { --a: 1; color-scheme: light; }");
    expect(report.summary.rules).toBe(1);
    expect(report.rules[0].bucket).toBe("G");
  });
});

describe("flags (fixture)", () => {
  const report = run("ingest-flags.css");
  const text = fixture("ingest-flags.css");
  const of = (kind: string) => report.flags.filter((f) => f.kind === kind);

  test("every kind has a count, in the order the summary prints", () => {
    expect(Object.keys(report.summary.flags)).toEqual([...FLAG_KINDS]);
    expect(report.summary.flags).toEqual({ "max-width-media": 3, "off-origin": 4, "color-literal": 6, "font-literal": 4, "class-selector": 3, important: 1 });
  });

  test("an @import, an @font-face src and a url() that leave the origin are flagged, with the line", () => {
    expect(of("off-origin").map((f) => f.line)).toEqual([
      lineOf(text, "fonts.googleapis.com"),
      lineOf(text, "//cdn.example.com/x.css"),
      lineOf(text, "https://cdn.example.com/remote.woff2"),
      lineOf(text, "https://example.com/bg.png"),
    ]);
  });

  test("a relative, root-relative, data: or fragment url is no request off the origin", () => {
    const details = of("off-origin").map((f) => f.detail).join("\n");
    for (const ok of ["local.css", "/fonts/local.woff2", "/local.png", "data:image", "#frag"]) expect(details).not.toContain(ok);
  });

  test("colour literals: hex, rgb(), hsl(), oklch() and a colour word; tokens and transparent are not", () => {
    expect(of("color-literal").map((f) => f.detail)).toEqual([
      "--lp-accent: #6022ff",
      "color: #fff",
      "border-color: rgb(0 0 0 / 50%)",
      "outline-color: hsl(210 50% 40%)",
      "box-shadow: oklch(60% 0.2 280)",
      "fill: red",
    ]);
  });

  test("font-family literals: a stack, the font shorthand and a token definition; var() and inherit are not", () => {
    expect(of("font-literal").map((f) => f.detail)).toEqual([
      '--lp-mono: "IBM Plex Mono", ui-monospace, monospace',
      'font-family: "IBM Plex Mono", monospace',
      'font: 600 0.8rem "Sora", sans-serif',
      "font-family: Georgia, serif",
    ]);
    expect(of("font-literal")[0].suggestion).toContain("--font-mono");
    expect(of("font-literal")[2].suggestion).toContain("--font-sans");
    expect(of("font-literal")[3].suggestion).toContain("no serif");
  });

  test("class selectors, including one inside :not(); a dot in an attribute value is none", () => {
    expect(of("class-selector").map((f) => f.detail)).toEqual([".card", ".child", ".hidden"]);
  });

  test("!important is flagged on the declaration", () => {
    expect(of("important")).toHaveLength(1);
    expect(of("important")[0]).toMatchObject({ line: lineOf(text, "padding: 8px !important"), detail: "padding: 8px !important" });
  });

  test("a max-width query says to rewrite mobile-first and names the tier; a range says to reset", () => {
    const flags = of("max-width-media");
    expect(flags.map((f) => f.detail)).toEqual(["@media (max-width: 719px)", "@media (min-width: 640px) and (max-width: 900px)", "@media (width <= 600px)"]);
    expect(flags[0].suggestion).toContain("mobile-first");
    expect(flags[0].suggestion).toContain("the -md tier (768px)");
    expect(flags[1].suggestion).toContain("a range");
    expect(flags[2].suggestion).toContain("the -sm tier (640px)");
  });

  test("a min-width query with no max-width is no flag", () => {
    expect(of("max-width-media").some((f) => f.detail.includes("min-width: 768px"))).toBe(false);
  });

  test("colour words are read only where a colour belongs", () => {
    expect(colorLiterals("font-family", '"Red Hat", sans-serif')).toEqual([]);
    expect(colorLiterals("content", '"red"')).toEqual([]);
    expect(colorLiterals("color", "red")).toEqual(["red"]);
    expect(colorLiterals("background", "url(red.png), linear-gradient(to right, red, #00f)")).toEqual(["#00f", "red"]);
    expect(colorLiterals("--x", "#abc")).toEqual(["#abc"]);
    expect(colorLiterals("color", "color-mix(in srgb, var(--a) 50%, white)")).toEqual(["white"]);
    expect(colorLiterals("color", "rgb(var(--rgb) / 50%)")).toEqual([]);
  });

  test("a flag carries its place: file, source and block", () => {
    for (const f of report.flags) {
      expect(f.file).toBe("test/fixtures/ingest-flags.css");
      expect(f.source).toBe("css");
      expect(f.line).toBeGreaterThan(0);
    }
  });
});

describe("nesting (fixture)", () => {
  const report = run("ingest-nested.css");

  test("nested rules come out as the flat selectors they mean, at the lines they were written", () => {
    expect(report.rules.map((r) => [r.bucket, r.media.join(""), r.selector, r.line])).toEqual([
      ["A", "", "[data-menu]", 3],
      ["A", "@media (min-width: 768px)", "[data-menu]", 3],
      ["A", "", "[data-menu] > a", 7],
      ["B", "", "[data-menu] > a:hover", 10],
    ]);
  });

  test("a nested media block becomes a tier", () => {
    expect(report.rules.find((r) => r.media.length)!.suggestion).toBe("--g-md:16px");
    expect(report.rules.find((r) => r.selector === "[data-menu] > a:hover")!.suggestion).toBe("--c-hover:var(--secondary)");
  });
});

describe("an HTML page (fixture)", () => {
  const text = fixture("ingest-page.html");
  const report = run("ingest-page.html");

  test("CSS comes from <style> and from code blocks named .css, with a trailing note ignored", () => {
    expect(report.summary.blocks).toEqual({ style: 1, css: 3, template: 2, script: 1 });
    expect(report.rules.map((r) => [r.source, r.selector, r.line])).toEqual([
      ["style", ".wrap", lineOf(text, ".wrap {")],
      ["style", "[data-demo]", lineOf(text, "[data-demo] {")],
      ["code", "[data-card]", lineOf(text, "[data-card] {")],
      ["code", "[data-card]:hover", lineOf(text, "[data-card]:hover")],
      ["code", "[data-nav] a[aria-current]", lineOf(text, "[data-nav] a[aria-current]")],
      ["code", "[data-mystery]", lineOf(text, "[data-mystery]")],
    ]);
  });

  test("a code block with no extension is CSS when it parses as CSS; a Jinja template is not", () => {
    expect(report.rules.some((r) => r.selector === "[data-mystery]")).toBe(true);
    expect(report.warnings).toEqual([]);
  });

  test("a <style> in a comment is not read", () => {
    expect(report.rules.some((r) => r.selector.includes("hidden-in-comment"))).toBe(false);
  });

  test("the bucket columns split by where the rule lives", () => {
    expect(report.summary.bySource.style.A).toBe(1);
    expect(report.summary.bySource.style.D).toBe(1);
    expect(report.summary.bySource.code.A).toBe(2);
    expect(report.summary.bySource.code.B).toBe(2);
  });

  test("a <link> that fetches off the origin is flagged; canonical and local ones are not", () => {
    const links = report.flags.filter((f) => f.block === "<link>");
    expect(links.map((f) => f.line)).toEqual([lineOf(text, "fonts.googleapis.com"), lineOf(text, "fonts.gstatic.com")]);
    expect(links.every((f) => f.kind === "off-origin" && f.source === "page")).toBe(true);
  });

  test("the lint finds every kind, with the line, the origin and a replacement", () => {
    const by = (name: string) => report.lint.filter((l) => l.name === name);
    expect(report.summary.lint).toEqual({ unknown: 8, deprecated: 1, collision: 3, "tier-state": 2, plain: 3 });
    expect(Object.keys(report.summary.lint)).toEqual([...LINT_KINDS]);
    expect(by("--opacity")[0]).toMatchObject({ kind: "unknown", origin: "page", line: lineOf(text, "--opacity"), suggestion: "--op" });
    expect(by("--list-style")[0].suggestion).toBe("--lis");
    expect(by("--max-w")[0].suggestion).toBe("--maxw");
    expect(by("--hvr-bg")[0]).toMatchObject({ kind: "deprecated", suggestion: "--bg-hover", origin: "code" });
    expect(by("--br")[0]).toMatchObject({ kind: "collision", suggestion: "border-radius: --radius; the rest wait for 2.0" });
    expect(by("--bg-hover-md")[0]).toMatchObject({ kind: "tier-state" });
    expect(by("--bg-md-hover")[0]).toMatchObject({ kind: "tier-state" });
    expect(by("--bg-hover-md")[0].suggestion).toBe("--bg-hover (all widths) or --bg-md (md and up)");
  });

  test("--fs is a collision, and a length in it does nothing at all", () => {
    const fs = report.lint.filter((l) => l.name === "--fs");
    expect(fs.map((l) => l.severity)).toEqual(["warn", "error"]);
    expect(fs[0].suggestion).toContain("no safer prop yet");
    expect(fs[1]).toMatchObject({ kind: "collision", suggestion: "--size" });
  });

  test("a suffix the prop does not offer, a wrong case and a space before the colon are silent no-ops", () => {
    expect(report.lint.find((l) => l.name === "--oe-md")!.message).toContain("--oe has no -md");
    expect(report.lint.find((l) => l.name === "--BG")).toMatchObject({ kind: "unknown", suggestion: "--bg" });
    const space = report.lint.find((l) => l.message.includes("space before the colon"))!;
    expect(space).toMatchObject({ kind: "unknown", name: "--bg", severity: "error" });
  });

  test("a plain property whose only prop is a collision says so", () => {
    const r = ingest("t.html", '<i style="text-decoration:none"></i>', kit);
    expect(r.lint[0]).toMatchObject({ kind: "plain", suggestion: "--td (--td also sets transition-delay)" });
  });

  test("a plain property in a style attribute names the prop, in markup and in a template", () => {
    const plain = report.lint.filter((l) => l.kind === "plain");
    expect(plain.map((l) => [l.name, l.suggestion, l.origin])).toEqual([
      ["padding", "--p", "page"],
      ["padding", "--p", "code"],
      ["margin", "--m", "code"],
    ]);
  });

  test("a page variable passes: a var() reads it, a script sets it, or the kit owns it", () => {
    const names = report.lint.map((l) => l.name);
    expect(names).not.toContain("--i");
    expect(names).not.toContain("--w");
    expect(names).not.toContain("--dx");
    expect(names).not.toContain("--c-hover");
    expect(names).toContain("--brand");
    expect(names).toContain("--not-a-prop");
  });

  test("a template expression is skipped over, not read as a declaration", () => {
    expect(report.lint.some((l) => l.name.includes("{{") || l.name.includes("%}"))).toBe(false);
    expect(report.lint.find((l) => l.name === "--brand")!.value).toBe('{{ "x" }}');
  });

  test("template control tags around a declaration print nothing, so the declaration is still read", () => {
    const html = '<i style="{% if x %}--opacity:.5{% endif %}; {# note #}--bg:red"></i>\n<b style="--w:{% if y %}1{% else %}2{% endif %}%"></b>';
    const r = ingest("t.html", html, kit);
    expect(r.lint.map((l) => [l.name, l.line, l.value])).toEqual([["--opacity", 1, ".5"]]);
    expect(r.summary.inlineProps).toBe(3);
  });

  test("a --name: in template text counts even outside a style attribute", () => {
    // {% set chip = "--bg:var(--good-bg); --c:var(--good); --tn:color .2s" %} holds three known props
    expect(report.summary.inlineProps).toBe(24);
  });

  test("comments hide what they hold: an HTML comment and a template comment", () => {
    const names = report.lint.map((l) => l.name);
    expect(names).not.toContain("--in-comment");
    expect(names).not.toContain("--in-note");
  });

  test("the executable demo script is read for style attributes, and its inline props pass", () => {
    expect(report.summary.blocks.script).toBe(1);
  });
});

describe("robustness", () => {
  test("an empty file gives an empty report", () => {
    for (const name of ["empty.html", "empty.css"]) {
      const report = ingest(name, "", kit);
      expect(report.summary.rules).toBe(0);
      expect(report.rules).toEqual([]);
      expect(formatText(report)).toContain("RULES 0");
    }
  });

  test("a <style> that does not parse is a warning, and the rest of the page is still read", () => {
    const report = ingest("p.html", '<style>[data-a { color: red }</style><i style="--opacity:1"></i>', kit);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toContain("p.html:1");
    expect(report.lint).toHaveLength(1);
  });

  test("a .css file that does not parse throws, so the CLI can exit 2", () => {
    expect(() => css("[data-a { color: red }")).toThrow(/snippet\.css:1/);
  });

  test("CRLF line endings keep the line numbers", () => {
    const report = ingest("c.html", "<style>\r\n[data-a]{color:var(--primary)}\r\n[data-b]:hover{color:var(--primary)}\r\n</style>", kit);
    expect(report.rules.map((r) => r.line)).toEqual([2, 3]);
  });

  test("a </ script> inside a code block does not end the block", () => {
    const html = `<script type="text/plain" data-path="a.css">[data-a]{margin:0}\n/* </ script> */</script><script type="text/plain" data-path="b.css">[data-b]{margin:0}</script>`;
    expect(ingest("s.html", html, kit).rules.map((r) => r.selector)).toEqual(["[data-a]", "[data-b]"]);
  });

  test("single-quoted style attributes and a value that reads like string concatenation", () => {
    const report = ingest("q.html", `<i style='--opacity:.4'></i><script>x = '<b style="top:' + y + 'px"></b>'</script>`, kit);
    expect(report.lint.map((l) => l.name)).toEqual(["--opacity"]);
  });

  test("@layer and @supports wrap rules without hiding them", () => {
    const report = css("@layer base { [data-a] { margin: 0 } } @supports (display:grid) { [data-b] { display: grid } }");
    expect(report.rules.map((r) => [r.selector, r.bucket, r.media])).toEqual([
      ["[data-a]", "A", ["@layer base"]],
      ["[data-b]", "A", ["@supports (display:grid)"]],
    ]);
  });

  test("no kit means no answer, not a crash: an empty manifest puts everything in G", () => {
    const empty = loadKit({ version: 1, generated_from: { file: "x", sha256: "" }, breakpoints: {}, props: {}, tokens: {}, warnings: [] }, "empty");
    const report = ingest("e.css", "[data-a] { margin: 0 }", empty);
    expect(report.rules[0].bucket).toBe("G");
  });
});

describe("output", () => {
  const report = run("ingest-nested.css");
  const text = formatText(report);

  test("the text report: input, kit, a RULES block by bucket, FLAGS, LINT, then one line per rule", () => {
    const lines = text.split("\n");
    expect(lines[0]).toBe("ingest test/fixtures/ingest-nested.css");
    expect(lines[1]).toBe("kit    168 props, 72 tokens (ingest-props.json)");
    expect(lines[2]).toBe("input  1 CSS file");
    expect(lines).toContain("RULES 4");
    expect(lines).toContain("  bucket   all    css");
    expect(lines).toContain("  A          3      3");
    expect(lines).toContain("  B          1      1");
    expect(lines).toContain("FLAGS");
    expect(lines).toContain("LINT (inline props)");
    expect(lines).toContain("RULES (bucket, selector, file:line, suggestion)");
    expect(lines).toContain("A      [data-menu]  test/fixtures/ingest-nested.css:3  --d:flex; --g:8px");
    expect(lines).toContain("B      [data-menu] > a:hover  test/fixtures/ingest-nested.css:10  --c-hover:var(--secondary)");
  });

  test("an HTML report has the all, code and style columns", () => {
    const html = formatText(run("ingest-page.html"));
    expect(html).toContain("  bucket   all   code  style");
    expect(html).toContain("input  1 <style> block, 3 CSS code blocks, 2 template blocks, 1 script");
    expect(html).toContain("FLAGS (kind, file:line, detail; the fix prints when it changes)");
    expect(html).toContain("LINT (kind, severity, file:line, origin, name, message)");
  });

  test("the fix prints once for a run of the same flag", () => {
    const flags = formatText(run("ingest-flags.css"))
      .split("\n")
      .filter((l) => l.startsWith("class-selector"));
    expect(flags).toHaveLength(3);
    expect(flags[0]).toContain("->");
    expect(flags[1]).not.toContain("->");
  });

  test("the JSON is the report: same data, plain objects, stable key order", () => {
    const json = JSON.parse(JSON.stringify(report)) as Report;
    expect(json.version).toBe(1);
    expect(Object.keys(json)).toEqual(["version", "input", "kit", "summary", "rules", "tokens", "flags", "lint", "warnings"]);
    expect(Object.keys(json.summary)).toEqual(["rules", "buckets", "bySource", "tokenBlocks", "inlineProps", "flags", "lint", "blocks"]);
    expect(Object.keys(json.rules[0])).toEqual(["bucket", "selector", "file", "line", "source", "block", "media", "needs", "suggestion"]);
    expect(json.rules).toEqual(report.rules);
  });

  test("the same input gives the same bytes", () => {
    expect(JSON.stringify(run("ingest-page.html"))).toBe(JSON.stringify(run("ingest-page.html")));
    expect(formatText(run("ingest-buckets.css"))).toBe(formatText(run("ingest-buckets.css")));
  });
});

describe("the CLI", () => {
  const cli = (...args: string[]) => {
    const r = Bun.spawnSync([process.execPath, "run", SCRIPT, ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
  };
  const props = join(FIXTURES, "ingest-props.json");
  const bucketsCss = join(FIXTURES, "ingest-buckets.css");

  test("a report exits 0, as text by default", () => {
    const r = cli(bucketsCss, "--manifest", props);
    expect(r.code).toBe(0);
    expect(r.out).toContain("RULES 55");
    expect(r.out).toContain(`(${props})`);
    expect(r.err).toBe("");
  });

  test("--json prints the report as one JSON object", () => {
    const r = cli(bucketsCss, "--json", "--manifest", props);
    expect(r.code).toBe(0);
    const json = JSON.parse(r.out) as Report;
    expect(json.summary.rules).toBe(55);
    expect(json.kit).toEqual({ props: 168, tokens: 72, source: props });
    expect(JSON.stringify(json.summary.buckets)).toBe(JSON.stringify(run("ingest-buckets.css").summary.buckets));
  });

  test("--help prints the header", () => {
    const r = cli("--help");
    expect(r.code).toBe(0);
    expect(r.out).toContain("bun run ingest <file.html|file.css>");
    expect(r.out).toContain("G > B > C > D > F > E > A-var > A' > A");
  });

  test("setup errors exit 2: no file, a missing file, a bad manifest, CSS that does not parse, an unknown option", () => {
    const tmp = mkdtempSync(join(tmpdir(), "startr-ingest-test-"));
    try {
      writeFileSync(join(tmp, "bad.css"), "[data-a { color: red }");
      writeFileSync(join(tmp, "bad.json"), "{ not json");
      writeFileSync(join(tmp, "empty.json"), "{}");
      expect(cli().code).toBe(2);
      expect(cli(join(tmp, "missing.css"), "--manifest", props).code).toBe(2);
      expect(cli(bucketsCss, "--manifest", join(tmp, "bad.json")).code).toBe(2);
      expect(cli(bucketsCss, "--manifest", join(tmp, "empty.json")).err).toContain("not a props.json");
      const bad = cli(join(tmp, "bad.css"), "--manifest", props);
      expect(bad.code).toBe(2);
      expect(bad.err).toContain("CSS parse error");
      expect(cli(bucketsCss, "--nope", "--manifest", props).code).toBe(2);
      expect(cli(bucketsCss, join(FIXTURES, "ingest-flags.css"), "--manifest", props).code).toBe(2);
      const dir = cli(tmp, "--manifest", props);
      expect(dir.code).toBe(2);
      expect(dir.err).toContain("cannot read");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("a closed pipe is no error", () => {
    const r = Bun.spawnSync(["sh", "-c", `${process.execPath} run ${SCRIPT} ${bucketsCss} --manifest ${props} | head -n 1`], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    expect(r.stdout.toString().trim()).toBe(`ingest ${bucketsCss}`);
    expect(r.stderr.toString()).toBe("");
  });
});

describe("the default manifest", () => {
  test("a build that fails is a message, not a crash, and it leaves no temp dir behind", () => {
    const root = mkdtempSync(join(tmpdir(), "startr-ingest-noroot-"));
    try {
      const before = readdirSync(tmpdir()).filter((n) => n.startsWith("startr-ingest-") && n !== root.split("/").pop());
      const built = manifestFromBuild(root);
      expect("error" in built && built.error).toContain("C failed to build");
      expect("error" in built && built.error).toContain("pass --manifest");
      const after = readdirSync(tmpdir()).filter((n) => n.startsWith("startr-ingest-") && n !== root.split("/").pop());
      expect(after.sort()).toEqual(before.sort());
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /** The names and mtimes in dist/, to see that a run leaves it alone. */
  const snapshot = (dir: string) => (existsSync(dir) ? JSON.stringify(readdirSync(dir).sort().map((name) => [name, statSync(join(dir, name)).mtimeMs])) : null);

  test("without --manifest the CLI builds C into a temp dir and reads its props.json, and dist/ stays as it was", () => {
    const dist = join(ROOT, "dist");
    const before = snapshot(dist);
    const r = Bun.spawnSync([process.execPath, "run", SCRIPT, join(FIXTURES, "ingest-nested.css"), "--json"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    if (r.exitCode !== 0) throw new Error(`the build failed, so there is no props.json to read (another stream may be mid-edit):\n${r.stderr.toString()}`);
    const json = JSON.parse(r.stdout.toString()) as Report;
    expect(json.kit.source).toBe("built from this checkout");
    expect(json.kit.props).toBeGreaterThan(100);
    expect(json.summary.rules).toBe(4);
    expect(snapshot(dist)).toBe(before);
  }, 120_000);
});

// ---------------------------------------------------------------- drafts ---

const DRAFTS = join(ROOT, "../WEB-AI-Sage-Trellis/crm/docs/design-drafts");

/**
 * Production CSS only (the text/plain code blocks: split.css, tasks.css and the two nav.css blocks), counted with ingest-props.json.
 * The sha256 ties each count to the draft it was taken from.
 */
const DRAFT_BASELINE: Record<string, { sha256: string; code: Record<Bucket, number>; tokenBlocks: number }> = {
  "leads/trellis-leads.html": {
    sha256: "8ab529727d6a838a337fee1ff0c2917877b6ce4e9607174ef80918aabc342e06",
    code: { A: 77, "A-var": 4, "A′": 4, B: 7, C: 7, D: 6, E: 2, F: 8, G: 1 },
    tokenBlocks: 1,
  },
  "navigation/trellis-nav.html": {
    sha256: "b7eeec4cc4d493bd9302d90728dc2c1b7a6360e8ef28f491841c3ba5831c0623",
    code: { A: 11, "A-var": 0, "A′": 2, B: 5, C: 6, D: 7, E: 3, F: 0, G: 2 },
    tokenBlocks: 1,
  },
  "tasks/trellis-tasks.html": {
    sha256: "73b2c188c46e0d0e3a87eece047c0c8ff30369c7a42ca252c0f100498218f47c",
    code: { A: 21, "A-var": 10, "A′": 0, B: 2, C: 6, D: 1, E: 2, F: 0, G: 0 },
    tokenBlocks: 0,
  },
};

/** The survey by hand, in the plan: 194 production rules. */
const HAND: Record<Bucket, number> = { A: 91, "A-var": 16, "A′": 7, B: 13, C: 24, D: 13, E: 23, F: 5, G: 2 };

const haveDrafts = Object.keys(DRAFT_BASELINE).every((f) => existsSync(join(DRAFTS, f)));
const draftSuite = haveDrafts ? describe : describe.skip;

draftSuite("the three Trellis drafts", () => {
  const files = Object.keys(DRAFT_BASELINE);
  const reports = new Map<string, Report>();
  const sha = new Map<string, string>();

  beforeAll(() => {
    for (const f of files) {
      const text = readFileSync(join(DRAFTS, f), "utf8");
      sha.set(f, createHash("sha256").update(text).digest("hex"));
      reports.set(f, ingest(f, text, kit));
    }
  });

  const code = (r: Report) => r.rules.filter((rule) => rule.source === "code");
  /** Content checks hold only while the drafts are the ones the baseline was taken from. */
  const baselined = () => files.every((f) => sha.get(f) === DRAFT_BASELINE[f].sha256);

  test("no rule is left unclassified, and every non-A rule says why", () => {
    for (const [f, r] of reports) {
      expect(r.warnings, f).toEqual([]);
      expect(sum(r.summary.buckets), f).toBe(r.rules.length);
      for (const rule of r.rules) {
        expect(BUCKETS.includes(rule.bucket), `${f}:${rule.line} ${rule.selector}`).toBe(true);
        expect(rule.suggestion.length, `${f}:${rule.line}`).toBeGreaterThan(0);
        if (rule.bucket !== "A") expect(rule.needs.some((n) => n.startsWith(`${rule.bucket}:`)), `${f}:${rule.line}`).toBe(true);
      }
    }
  });

  test("nothing is dropped: every rule in the production CSS shows up once, as a rule or as a token block", () => {
    // An oracle that shares no code with the tool: a regex over the code blocks, then PostCSS.
    for (const f of files) {
      const html = readFileSync(join(DRAFTS, f), "utf8");
      let expected = 0;
      for (const m of html.matchAll(/<script\s+type="text\/plain"([^>]*)>([\s\S]*?)<\/script>/g)) {
        if (!/data-path="[^"]*\.css\b/.test(m[1])) continue;
        postcss.parse(m[2]).walkRules((rule) => {
          if (rule.parent?.type === "atrule" && /keyframes$/i.test((rule.parent as postcss.AtRule).name)) return;
          expected++;
        });
      }
      const r = reports.get(f)!;
      const shown = code(r).filter((rule) => !rule.selector.startsWith("@")).length + r.tokens.filter((t) => t.source === "code").length;
      expect(shown, f).toBe(expected);
    }
  });

  test("the production CSS totals are stable (per draft, while the draft is the one baselined)", () => {
    const moved: string[] = [];
    for (const f of files) {
      if (sha.get(f) !== DRAFT_BASELINE[f].sha256) {
        moved.push(f);
        continue;
      }
      const r = reports.get(f)!;
      expect(r.summary.bySource.code, f).toEqual(DRAFT_BASELINE[f].code);
      expect(r.summary.tokenBlocks, f).toBe(DRAFT_BASELINE[f].tokenBlocks);
    }
    if (moved.length) console.warn(`ingest.test: ${moved.join(", ")} changed since the baseline; exact totals skipped for it. Re-baseline from bun run ingest <draft> --json.`);
  });

  test("194 production rules, as the hand survey counted: token blocks are not rules, @keyframes is one", () => {
    if (!baselined()) return;
    const total = files.reduce((n, f) => n + code(reports.get(f)!).length, 0);
    expect(total).toBe(194);
    expect(sum(HAND)).toBe(194);
    expect(files.reduce((n, f) => n + reports.get(f)!.summary.tokenBlocks, 0)).toBe(2);
  });

  test("why the split differs from the hand survey", () => {
    if (!baselined()) return;
    const rules = files.flatMap((f) => code(reports.get(f)!));
    const total = (bucket: Bucket) => rules.filter((r) => r.bucket === bucket).length;
    const touching = (bucket: Bucket) => rules.filter((r) => r.needs.some((n) => n.startsWith(`${bucket}:`)));
    const where = (list: typeof rules) => list.reduce<Record<string, number>>((m, r) => ({ ...m, [r.bucket]: (m[r.bucket] ?? 0) + 1 }), {});

    // E: 7 here, 23 by hand. Sixteen rules ask for a gradient, a coloured shadow, backdrop-filter or a text clip;
    // under G > B > C > D > F > E only seven stay E. The hand count tracks every rule that touches a gradient, a shadow, a filter or an alpha tint.
    expect(total("E")).toBe(7);
    expect(touching("E")).toHaveLength(16);
    expect(where(touching("E"))).toEqual({ E: 7, C: 4, B: 2, G: 2, F: 1 });

    // F: 8 here, 5 by hand. Four of the eight are F only for env(), dvh or scroll-margin, which the props take as values.
    expect(total("F")).toBe(8);
    const valueOnly = rules.filter((r) => r.bucket === "F" && r.needs.filter((n) => n.startsWith("F:")).every((n) => /env\(\)|dynamic viewport|scroll-margin/.test(n)));
    expect(valueOnly).toHaveLength(4);

    // G: 3 here, 2 by hand. Two are the nav pill and bar, whose left and width a script animates; the third is table border-collapse.
    expect(total("G")).toBe(3);
    expect(rules.filter((r) => r.bucket === "G" && r.needs.some((n) => n.includes("transition on left, width")))).toHaveLength(2);

    // D: 14 here, 13 by hand. Two reduced-motion resets count as D though the kit makes them redundant.
    expect(total("D")).toBe(14);
    expect(rules.filter((r) => r.bucket === "D" && r.suggestion.startsWith("(redundant"))).toHaveLength(2);

    // C: 19 here, 24 by hand. A selector that only descends, with no state, sibling, :has(), :nth-child or pseudo-element, is A here.
    expect(total("C")).toBe(19);
    expect(touching("C")).toHaveLength(20);
  });

  test("the production CSS uses no classes, the only off-origin request is the fonts <link>, and no inline prop is unknown", () => {
    if (!baselined()) return;
    for (const [f, r] of reports) {
      expect(r.flags.filter((x) => x.source === "code" && x.kind === "class-selector"), f).toEqual([]);
      expect(r.flags.filter((x) => x.kind === "off-origin").map((x) => x.block), f).toEqual(["<link>"]);
      expect(r.summary.lint.unknown, f).toBe(0);
      expect(r.summary.lint.deprecated, f).toBe(0);
    }
  });

  test("the demo <style> uses classes, and says so", () => {
    if (!baselined()) return;
    for (const [f, r] of reports) expect(r.flags.filter((x) => x.source === "style" && x.kind === "class-selector").length, f).toBeGreaterThan(100);
  });
});

// The same drafts against the kit as it is now: the counts may move as the kit grows, the invariants may not.
const liveSuite = haveDrafts ? describe : describe.skip;

liveSuite("the three Trellis drafts against the live kit", () => {
  const temp: string[] = [];
  let live: ReturnType<typeof loadKit>;

  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), "startr-ingest-live-"));
    temp.push(dir);
    const build = Bun.spawnSync([process.execPath, "run", "build.ts"], { cwd: ROOT, env: { ...process.env, STARTR_DIST: dir }, stdout: "pipe", stderr: "pipe" });
    if (build.exitCode !== 0) {
      throw new Error(`the build failed, so there is no props.json to read (another stream may be mid-edit):\n${build.stderr.toString()}`);
    }
    live = loadKit(JSON.parse(readFileSync(join(dir, "props.json"), "utf8")) as Manifest, "live build");
  }, 120_000);

  afterAll(() => {
    for (const dir of temp) rmSync(dir, { recursive: true, force: true });
  });

  test("every rule is classified, and the rule count does not depend on the kit", () => {
    for (const f of Object.keys(DRAFT_BASELINE)) {
      const text = readFileSync(join(DRAFTS, f), "utf8");
      const r = ingest(f, text, live);
      expect(sum(r.summary.buckets), f).toBe(r.rules.length);
      expect(r.rules.every((rule) => BUCKETS.includes(rule.bucket)), f).toBe(true);
      expect(r.warnings, f).toEqual([]);
      // the same rules, whatever the kit says about them
      expect(r.rules.map((rule) => `${rule.line} ${rule.selector}`), f).toEqual(ingest(f, text, kit).rules.map((rule) => `${rule.line} ${rule.selector}`));
    }
  });
});
