// The precedence ladder, checked in the built CSS.
//
// Every state rule is !important, so specificity decides and source order breaks ties:
//
//   Band A (0,1,0)  base, then tiers
//   Band B (0,2,0)  in-hover, hover      (the old --hvr-* names ride with hover)
//   Band C (0,3,0)  in-on, on, focus, active
//
//   base < tier < in-hover < hover < in-on < on < focus < active
//
// This file builds the sheet into a temp dir, parses it with PostCSS, and checks that every state
// selector has its band's specificity, the shape and media context it is meant to have, and its
// place in the band's source order. It reads the unminified and the minified builds, because
// cssnano must not merge or reorder these rules.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postcss from "postcss";
import parser from "postcss-selector-parser";

// ---------------------------------------------------------------------------------------------
// Specificity

type Spec = [number, number, number];
const ZERO: Spec = [0, 0, 0];
const plus = (a: Spec, b: Spec): Spec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const compare = (a: Spec, b: Spec) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const fmt = (s: Spec) => `(${s.join(",")})`;
const maxOf = (list: Spec[]): Spec => list.reduce((m, s) => (compare(s, m) > 0 ? s : m), ZERO);

const PSEUDO_ELEMENTS = new Set([":before", ":after", ":first-line", ":first-letter"]);

/** Specificity of one complex selector (a Selector node), per Selectors 4. */
function specificityOf(selector: parser.Selector): Spec {
  let total = ZERO;
  for (const node of selector.nodes) {
    if (node.type === "id") total = plus(total, [1, 0, 0]);
    else if (node.type === "class" || node.type === "attribute") total = plus(total, [0, 1, 0]);
    else if (node.type === "tag") total = plus(total, [0, 0, 1]);
    else if (node.type === "pseudo") {
      const name = node.value.toLowerCase();
      if (name.startsWith("::") || PSEUDO_ELEMENTS.has(name)) total = plus(total, [0, 0, 1]);
      else if (name === ":where") continue;
      else if (name === ":is" || name === ":not" || name === ":has") {
        total = plus(total, maxOf(node.nodes.map(specificityOf)));
      } else total = plus(total, [0, 1, 0]);
    }
  }
  return total;
}

function specificity(selector: string): Spec {
  const list = parser().astSync(selector).nodes;
  if (list.length !== 1) throw new Error(`expected one selector, got a list: ${selector}`);
  return specificityOf(list[0]);
}

// ---------------------------------------------------------------------------------------------
// What a state rule looks like

const PAINT: Record<string, string> = {
  bg: "background",
  bgc: "background-color",
  c: "color",
  b: "border",
  bc: "border-color",
  boxs: "box-shadow",
  op: "opacity",
  t: "transform",
  oe: "outline",
};
const LEGACY: Record<string, string> = {
  "hvr-bg": "background",
  "hvr-bgc": "background-color",
  "hvr-c": "color",
  "hvr-b": "border",
  "hvr-bc": "border-color",
  cur: "cursor",
};
const STATES = ["in-hover", "hover", "in-on", "on", "focus", "active"] as const;
type State = (typeof STATES)[number] | "legacy";

type Copy = { shape: string; media: string; band: "B" | "C" };
// Every shape a state may take. "[v]" is the [style*="--x:"] attribute, "[s]" a bare [style].
// The hover copies: :hover only where a pointer can hover; :focus-visible as separate rules, in-hover's
// outside any query, hover's in an always-true query so it lands after in-hover once the sheet's
// @media blocks are hoisted to the end (see mixins.css).
const SHAPES: Record<State, Copy[]> = {
  "in-hover": [
    { shape: ":hover>[v]", media: "@media(hover:hover)", band: "B" },
    { shape: ":focus-visible>[v]", media: "", band: "B" },
  ],
  hover: [
    { shape: "[v]:hover", media: "@media(hover:hover)", band: "B" },
    { shape: "[v]:focus-visible", media: "@media(min-width:0)", band: "B" },
  ],
  legacy: [{ shape: "[v]:hover", media: "@media(hover:hover)", band: "B" }],
  "in-on": [{ shape: ":is()>[v]", media: "", band: "C" }],
  on: [{ shape: "[v]:is()", media: "", band: "C" }],
  focus: [{ shape: "[s][v]:focus-visible", media: "", band: "C" }],
  active: [{ shape: "[s][v]:active", media: "", band: "C" }],
};
const BAND: Record<"B" | "C", Spec> = { B: [0, 2, 0], C: [0, 3, 0] };
const bandOf = (state: State): "B" | "C" => (state === "in-hover" || state === "hover" || state === "legacy" ? "B" : "C");
// Source order inside a band: a lower rank must not come after a higher one.
const RANK: Record<State, number> = { "in-hover": 0, legacy: 1, hover: 1, "in-on": 0, on: 1, focus: 2, active: 3 };

/** The members of :is() that make an element "on". Quotes dropped, :not() arguments sorted. */
const ON_LIST = [
  ":checked",
  "[aria-current]:not([aria-current=],[aria-current=false])",
  "[aria-expanded=true]",
  "[aria-pressed=true]",
  "[aria-selected=true]",
  "[data-on]:not([data-on=false])",
  "[open]",
];

// ---------------------------------------------------------------------------------------------
// Reading the sheet

type Rule = {
  index: number;
  selector: string;
  selectors: parser.Selector[];
  media: string;
  decls: Array<[string, string, boolean]>;
};

function readRules(css: string): Rule[] {
  const rules: Rule[] = [];
  postcss.parse(css).walkRules((rule) => {
    const chain: string[] = [];
    for (let node = rule.parent; node && node.type !== "root"; node = node.parent) {
      if (node.type === "atrule") chain.unshift(`@${(node as postcss.AtRule).name}${(node as postcss.AtRule).params.replace(/\s+/g, "")}`);
    }
    const decls: Rule["decls"] = [];
    rule.each((child) => {
      if (child.type === "decl") decls.push([child.prop, child.value, child.important === true]);
    });
    rules.push({
      index: rules.length,
      selector: rule.selector,
      selectors: parser().astSync(rule.selector).nodes,
      media: chain.join(""),
      decls,
    });
  });
  return rules;
}

/** "[v]" / "[s]" / ":hover" ... for one selector. The var name is returned apart. */
function describeSelector(selector: parser.Selector): { shape: string; name: string | null; on: string[] | null } {
  let shape = "";
  let name: string | null = null;
  let on: string[] | null = null;
  for (const node of selector.nodes) {
    if (node.type === "attribute" && node.attribute === "style" && node.operator === "*=") {
      const match = /^--([a-z0-9-]+):$/.exec(node.value ?? "");
      if (!match) return { shape: "?", name: null, on: null };
      name = match[1];
      shape += "[v]";
    } else if (node.type === "attribute" && node.attribute === "style" && !node.operator) shape += "[s]";
    else if (node.type === "combinator") shape += node.value.trim();
    else if (node.type === "pseudo" && (node.value === ":is" || node.value === ":not")) {
      shape += ":is()";
      on = node.nodes.map(canon).sort();
    } else if (node.type === "pseudo") shape += node.value;
    else shape += `<${node.type}>`;
  }
  return { shape, name, on };
}

/** A selector as text with quotes dropped and :not()/:is() arguments sorted, so the minifier's spelling does not matter. */
function canon(node: parser.Node): string {
  if (node.type === "selector") return node.nodes.map(canon).join("");
  if (node.type === "pseudo" && node.nodes.length) return `${node.value}(${node.nodes.map(canon).sort().join(",")})`;
  return node.toString().replace(/["']/g, "").trim();
}

type Found = { rule: Rule; state: State; stem: string; name: string; shape: string; copy: Copy | undefined; on: string[] | null };

/** Every rule that carries a state prop (the nine paint props with a state suffix, or a legacy --hvr-* name). */
function findStateRules(rules: Rule[]): Found[] {
  const found: Found[] = [];
  for (const rule of rules) {
    if (rule.selectors.length !== 1) continue;
    const { shape, name, on } = describeSelector(rule.selectors[0]);
    if (!name) continue;
    let state: State | null = null;
    let stem = "";
    if (name in LEGACY && shape === "[v]:hover") {
      state = "legacy";
      stem = name;
    } else {
      const match = new RegExp(`^(${Object.keys(PAINT).join("|")})-(${STATES.join("|")})$`).exec(name);
      if (match) {
        stem = match[1];
        state = match[2] as State;
      }
    }
    if (!state) continue;
    const copy = SHAPES[state].find((c) => c.shape === shape);
    found.push({ rule, state, stem, name, shape, copy, on });
  }
  return found;
}

/** Throw when ranks go down inside a band, in document order. Used by the test and proven against a bad list. */
function checkOrder(items: Array<{ band: string; state: State; label: string }>) {
  for (const band of ["B", "C"]) {
    let last: { rank: number; label: string } | null = null;
    for (const item of items.filter((i) => i.band === band)) {
      const rank = RANK[item.state];
      if (last && rank < last.rank) {
        throw new Error(`band ${band}: ${item.label} (${item.state}) comes after ${last.label}, which ranks higher`);
      }
      if (!last || rank >= last.rank) last = { rank, label: item.label };
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The checks

const root = join(import.meta.dir, "..");
let dist = "";

beforeAll(async () => {
  dist = mkdtempSync(join(tmpdir(), "startr-bands-"));
  const build = Bun.spawn([process.execPath, "run", "build.ts"], {
    cwd: root,
    env: { ...process.env, STARTR_DIST: dist },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, out, err] = await Promise.all([build.exited, new Response(build.stdout).text(), new Response(build.stderr).text()]);
  if (code !== 0) throw new Error(`The build failed (${code}). Another stream may be mid-edit.\n${out}\n${err}`);
}, 120_000);

afterAll(() => {
  if (dist) rmSync(dist, { recursive: true, force: true });
});

const read = (file: string) => readFileSync(join(dist, file), "utf8");

describe("the checker itself", () => {
  test("computes specificity per Selectors 4", () => {
    expect(specificity('[style*="--bg:"]')).toEqual([0, 1, 0]);
    expect(specificity('[style*="--bg-hover:"]:hover')).toEqual([0, 2, 0]);
    expect(specificity(':hover>[style*="--bg-in-hover:"]')).toEqual([0, 2, 0]);
    expect(specificity('[style][style*="--bg-focus:"]:focus-visible')).toEqual([0, 3, 0]);
    expect(specificity('[style*="--c-focus:"]:focus-visible')).toEqual([0, 2, 0]);
    expect(specificity('input:not([readonly]):hover')).toEqual([0, 2, 1]);
    expect(specificity(':where(.a, #b)>[x]')).toEqual([0, 1, 0]);
  });

  test("one :not(a,b) keeps :is() at (0,2,0); two :not() calls push it to (0,3,0)", () => {
    const one = '[x]:is([aria-current]:not([aria-current=false],[aria-current=""]),[open])';
    const two = '[x]:is([aria-current]:not([aria-current=false]):not([aria-current=""]),[open])';
    expect(specificity(one)).toEqual([0, 3, 0]);
    expect(specificity(two)).toEqual([0, 4, 0]);
  });

  test("checkOrder passes a ladder and throws on a swapped pair", () => {
    const ladder = (states: State[]) => states.map((state, i) => ({ band: "C", state, label: `rule ${i}` }));
    expect(() => checkOrder(ladder(["in-on", "on", "focus", "active"]))).not.toThrow();
    expect(() => checkOrder(ladder(["in-on", "focus", "on", "active"]))).toThrow(/rule 2 \(on\) comes after rule 1/);
    const hover = (states: State[]) => states.map((state, i) => ({ band: "B", state, label: `rule ${i}` }));
    expect(() => checkOrder(hover(["in-hover", "legacy", "hover"]))).not.toThrow();
    expect(() => checkOrder(hover(["hover", "in-hover"]))).toThrow();
  });
});

const STATE_BUILDS = ["startr.css", "startr.min.css", "startr-utilities.css", "startr-utilities.min.css"];
const HELPER_BUILDS = ["startr.css", "startr.min.css", "startr-helpers.css", "startr-helpers.min.css"];

describe.each(STATE_BUILDS)("state rules in %s", (file) => {
  let rules: Rule[] = [];
  let found: Found[] = [];
  beforeAll(() => {
    rules = readRules(read(file));
    found = findStateRules(rules);
  });

  test("all 54 paint-state rule sets and 6 legacy names are present", () => {
    const names = new Set(found.map((f) => f.name));
    const want: string[] = [];
    for (const stem of Object.keys(PAINT)) for (const state of STATES) want.push(`${stem}-${state}`);
    want.push(...Object.keys(LEGACY));
    expect(want.filter((name) => !names.has(name))).toEqual([]);
    // 9 props x (in-hover 2, hover 2, in-on 1, on 1, focus 1, active 1) + 6 legacy.
    expect(found.length).toBe(9 * 8 + 6);
  });

  test("every state rule has a known shape, its media context, its band's specificity and one !important declaration", () => {
    const problems: string[] = [];
    for (const f of found) {
      const label = `${f.rule.selector} ${f.rule.media || "(top level)"}`;
      if (!f.copy) {
        problems.push(`${label}: unknown shape ${f.shape}`);
        continue;
      }
      if (f.rule.media !== f.copy.media) problems.push(`${label}: wanted media ${f.copy.media || "none"}`);
      const spec = specificity(f.rule.selector);
      if (compare(spec, BAND[f.copy.band]) !== 0) problems.push(`${label}: specificity ${fmt(spec)}, wanted ${fmt(BAND[f.copy.band])}`);
      const css = f.state === "legacy" ? LEGACY[f.stem] : PAINT[f.stem];
      const want = JSON.stringify([[css, `var(--${f.name})`, true]]);
      if (JSON.stringify(f.rule.decls) !== want) problems.push(`${label}: declarations ${JSON.stringify(f.rule.decls)}, wanted ${want}`);
    }
    expect(problems).toEqual([]);
  });

  test("each state has exactly the copies it should: hover and in-hover two, the rest one", () => {
    const problems: string[] = [];
    for (const stem of Object.keys(PAINT)) {
      for (const state of STATES) {
        const mine = found.filter((f) => f.name === `${stem}-${state}`);
        const shapes = mine.map((f) => f.shape).sort();
        const want = SHAPES[state].map((c) => c.shape).sort();
        if (JSON.stringify(shapes) !== JSON.stringify(want)) problems.push(`--${stem}-${state}: ${shapes.join(" | ")}`);
      }
    }
    expect(problems).toEqual([]);
  });

  test("in-band source order: in-hover < hover (B), in-on < on < focus < active (C)", () => {
    // Rules with an unknown shape are reported by the test above; here they only need a band.
    const items = found.map((f) => ({ band: bandOf(f.state), state: f.state, label: `${f.rule.selector} @${f.rule.index}` }));
    expect(() => checkOrder(items)).not.toThrow();
  });

  test("hover and focus copies are separate rules: no list mixes :focus-visible with another selector", () => {
    const mixed = rules.filter(
      (rule) =>
        rule.selector.includes("[style") &&
        rule.selectors.length > 1 &&
        rule.selectors.some((s) => s.toString().includes(":focus-visible")) &&
        rule.selectors.some((s) => !s.toString().includes(":focus-visible")),
    );
    expect(mixed.map((rule) => rule.selector)).toEqual([]);
  });

  test("the on list is identical in every on and in-on rule, and matches the decided set", () => {
    const lists = found.filter((f) => f.state === "on" || f.state === "in-on");
    expect(lists.length).toBe(18);
    const wrong = lists.filter((f) => JSON.stringify(f.on) !== JSON.stringify(ON_LIST));
    expect(wrong.map((f) => f.rule.selector)).toEqual([]);
  });

  test("legacy --hvr-* and --cur are hover aliases: all inside (hover:hover), before the first --x-hover rule", () => {
    const legacy = found.filter((f) => f.state === "legacy");
    const firstHover = found.find((f) => f.state === "hover" && f.shape === "[v]:hover")!;
    for (const f of legacy) expect(f.rule.index).toBeLessThan(firstHover.rule.index);
  });

  test("no dead fallbacks, no leftover mixin variables, no single-dash -ttf", () => {
    const css = read(file);
    expect(css).not.toContain("$(");
    expect(css).not.toMatch(/var\(--hvr-[a-z]+\s*,/);
    expect(css).not.toMatch(/var\(--cur\s*,/);
    expect(css).not.toMatch(/\[style\*="-ttf/);
  });

  test("--ttf and --oo exist with all five tiers; the five tiers sit in a media query at (0,1,0) after their base", () => {
    for (const stem of ["ttf", "oo"]) {
      const base = rules.find((r) => r.selector === `[style*="--${stem}:"]` && r.media === "");
      expect(base).toBeDefined();
      for (const tier of ["sm", "md", "lg", "xl", "pt"]) {
        const rule = rules.find((r) => r.selector === `[style*="--${stem}-${tier}:"]`);
        expect(rule).toBeDefined();
        expect(rule!.media).toMatch(/^@media/);
        expect(specificity(rule!.selector)).toEqual([0, 1, 0]);
        expect(rule!.index).toBeGreaterThan(base!.index);
      }
    }
  });

  test("band A: every tier rule is (0,1,0), inside a media query and after its base rule", () => {
    const bases = new Map<string, Rule>();
    for (const rule of rules) {
      const match = /^\[style\*="--([a-z0-9]+):"\]$/.exec(rule.selector);
      if (match && rule.media === "") bases.set(match[1], rule);
    }
    const problems: string[] = [];
    for (const rule of rules) {
      const match = /^\[style\*="--([a-z0-9]+)-(sm|md|lg|xl|pt):"\]$/.exec(rule.selector);
      if (!match || !bases.has(match[1])) continue;
      if (!rule.media.startsWith("@media")) problems.push(`${rule.selector} is not in a media query`);
      if (rule.index < bases.get(match[1])!.index) problems.push(`${rule.selector} comes before its base`);
      if (compare(specificity(rule.selector), [0, 1, 0]) !== 0) problems.push(`${rule.selector} is not (0,1,0)`);
    }
    expect(problems).toEqual([]);
  });
});

describe.each(HELPER_BUILDS)("hover helpers in %s", (file) => {
  const HELPERS = ["levitate", "shadow", "translate", "translatex", "translatey", "scale", "rotate", "skew"];
  let rules: Rule[] = [];
  beforeAll(() => {
    rules = readRules(read(file));
  });

  /** Rules whose selector list holds `[style*="--helper-suffix:"]shape`, in the given media context. */
  const holding = (helper: string, suffix: string, shape: string, media: string) =>
    rules.filter(
      (rule) =>
        rule.media === media &&
        rule.selectors.some((s) => s.toString().replace(/\s/g, "") === `[style*="--${helper}-${suffix}:"]${shape}`),
    );

  test.each(["hover", "hvr"])("every helper's -%s name is in one :hover rule inside (hover:hover) and one :focus-visible rule outside it", (suffix) => {
    const problems: string[] = [];
    for (const helper of HELPERS) {
      const hover = holding(helper, suffix, ":hover", "@media(hover:hover)");
      const focus = holding(helper, suffix, ":focus-visible", "");
      if (hover.length !== 1) problems.push(`--${helper}-${suffix}:hover is in ${hover.length} rules`);
      if (focus.length !== 1) problems.push(`--${helper}-${suffix}:focus-visible is in ${focus.length} rules`);
      if (hover.length === 1 && focus.length === 1) {
        // The hover rule never lists a focus selector, the focus rule never lists :hover, and both carry the same declarations.
        if (hover[0].selectors.some((s) => s.toString().includes(":focus"))) problems.push(`--${helper}-${suffix}: the hover rule lists a focus selector`);
        if (focus[0].selectors.some((s) => s.toString().includes(":hover"))) problems.push(`--${helper}-${suffix}: the focus rule lists :hover`);
        if (JSON.stringify(hover[0].decls) !== JSON.stringify(focus[0].decls)) problems.push(`--${helper}-${suffix}: hover and focus declarations differ`);
      }
    }
    expect(problems).toEqual([]);
  });

  test("the -hvr and -hover names share their rules, and those rules read only the -hover variables", () => {
    const problems: string[] = [];
    for (const helper of HELPERS) {
      for (const [shape, media] of [
        [":hover", "@media(hover:hover)"],
        [":focus-visible", ""],
      ]) {
        const old = holding(helper, "hvr", shape, media)[0];
        const twin = holding(helper, "hover", shape, media)[0];
        if (!old || !twin) continue;
        if (old !== twin) problems.push(`--${helper} ${shape}: the -hvr and -hover names are in different rules`);
        if (JSON.stringify(old.decls).includes("-hvr")) problems.push(`--${helper} ${shape}: a declaration still reads a -hvr variable`);
      }
    }
    expect(problems).toEqual([]);
  });

  test("each -hvr name copies its value into its -hover variable, in a rule that does nothing else", () => {
    const problems: string[] = [];
    for (const helper of HELPERS) {
      const alias = rules.filter((rule) => rule.media === "" && rule.selector.replace(/\s/g, "") === `[style*="--${helper}-hvr:"]`);
      const want = JSON.stringify([[`--${helper}-hover`, `var(--${helper}-hvr)`, false]]);
      if (alias.length !== 1) problems.push(`--${helper}-hvr: ${alias.length} alias rules`);
      else if (JSON.stringify(alias[0].decls) !== want) problems.push(`--${helper}-hvr: alias is ${JSON.stringify(alias[0].decls)}`);
    }
    expect(problems).toEqual([]);
  });

  test("no helper listens to plain :focus any more", () => {
    const plain = rules.filter((rule) => /\[style\*="--[a-z]+-(hvr|hover):"\]:focus(?!-)/.test(rule.selector));
    expect(plain.map((rule) => rule.selector)).toEqual([]);
  });
});
