// Ingest: how does a design example map onto startr.style?
//
//   bun run ingest <file.html|file.css>                    build C into a temp dir, read its props.json
//   bun run ingest <file> --manifest <props.json>          use this manifest, skip the build
//   bun run ingest <file> --json                           the same report as JSON on stdout
//
// A design example holds CSS the kit cannot take as it stands: hover rules,
// keyframes, one stylesheet per component. This command reads one example and
// says, rule by rule, which kit feature replaces it, so ingesting the next
// design is a repeatable pass and not a judgment call.
//
// What it reads
//   .css            the whole file is one stylesheet.
//   anything else   is read as HTML. CSS comes from <style> blocks and from
//                   <script type="text/plain"> code blocks whose data-path (or
//                   data-name) ends in .css, with a trailing note such as
//                   "(new)" ignored. A code block without a name is CSS when it
//                   parses as CSS and every declaration has a plausible name.
//                   Nested rules are unwrapped first (postcss-nested).
//   inline props    every style="..." in the page, in code blocks and in demo
//                   scripts, and every --name: used in the template text of a
//                   code block. {{ }}, {% %}, {# #} and ${ } are skipped over,
//                   and HTML and template comments are not read.
//
// Buckets. Each rule goes in one bucket. When a rule has several needs the
// hardest wins, in this order: G > B > C > D > F > E > A-var > A' > A.
//   A      every declaration has a kit prop (--radius is preferred to --br,
//          which also sets border-right). A selector that only descends
//          (".card h2") is still A: the props go on that element.
//   A-var  the subject carries a server-rendered variant: a data or ARIA
//          attribute with a value ([data-st="done"], [data-st^="done"]), a
//          second data attribute in the compound ([data-card][data-alert]) or
//          a second class (.chip.done). A template macro emits the props.
//   A'     plain properties with no prop that belong in markup: SVG fill,
//          stroke and friends as attributes, clip.
//   B      the element's own state: :hover, :focus-visible, :focus, :active,
//          [aria-current], [aria-selected], [aria-pressed], [aria-expanded],
//          [open], :checked, [data-on]. The suffix prop is named when
//          props.json lists that state for the property. Script-toggled
//          data-open, data-show, data-swapping, data-enter (and a class such
//          as .on or .active) count too: toggle data-on instead.
//   C      relational. A state on the direct parent suggests --x-in-on or
//          --x-in-hover. Deeper descendants, :has(), sibling combinators,
//          :nth-child and friends, :focus-within, ::before and ::after, and an
//          ancestor that carries an attribute value or :not() need markup or a
//          restructure.
//   D      transition, animation or @keyframes: --tn with the --ease-* and
//          --dur-* tokens, --anim with st-fade, st-rise, st-slide-in or st-pop.
//   F      env(), dynamic viewport units, position: sticky, text-overflow,
//          scroll-snap, scrollbar-width and the scroll-margin family: a value
//          the prop already takes, or --line-clamp:1 for an ellipsis.
//   E      gradients, background-clip: text, coloured shadows, backdrop-filter,
//          color-mix: --text-grad, --glow, --bdf, --tone, --mix. A var() that
//          points at a token defined in the same file is followed, and a
//          private token named *grad* counts as a gradient. A shadow is
//          coloured when its colour has some chroma; ink is not.
//   G      anything with no kit answer: a property with no prop, a state the
//          kit lacks (:disabled), a media feature with no tier, a transition
//          on left, width, top and the like (a script sets that geometry), an
//          @font-face. A behaviour script sets attributes and inline geometry.
// A rule whose declarations are all custom properties (a :root token block)
// styles nothing, so it is listed under tokens and left out of the counts.
// @keyframes counts as one D rule; its steps do not.
//
// Flags (each carries file:line and a fix)
//   max-width-media    rewrite mobile-first: phone values at the base, wide ones in -md
//   off-origin         @import, url() or <link> that leaves the origin (zero egress)
//   color-literal      colour literal in a declaration: use a token, --mix or --tone
//   font-literal       font-family literal: use --font-sans or --font-mono
//   class-selector     consumer markup uses no classes: hook on data-* or aria-*
//   important          !important in a declaration
//
// Lint of inline props, against props.json (error: unknown; warn: the next
// three; note: plain)
//   unknown     a name the kit lacks is a silent no-op. A custom property that
//               a var() reads, that the CSS defines, or that a script sets is
//               a page variable and passes. Names with a space before the
//               colon never match the kit's [style*="--x:"] selectors.
//   deprecated  the old name, with its replacement
//   collision   one name feeds two properties; the safer prop is named. A
//               length in --fs is reported: neither of its properties takes one.
//   tier-state  --bg-hover-md and its mirror; the kit has one suffix per name
//   plain       a plain property in a style attribute that has a kit prop
//
// Output. A summary (bucket counts with an all column and one per source, flag
// counts, lint counts), then one line per rule: bucket, selector, file:line,
// suggestion. Then the flags and the lint findings, one line each.
// --json emits the same data as one object: version, input, kit, summary,
// rules, tokens, flags, lint, warnings. Each rule also lists its needs, so the
// bucket can be checked. The sources are code (a text/plain code block, the
// CSS a dev team would ship), style (a <style> block, the demo) and css.
//
// Exit 0: the report was produced. Exit 2: setup error (bad arguments,
// unreadable file or manifest, CSS that does not parse, the build failed).

import postcss from "postcss";
import postcssNested from "postcss-nested";
import { parseArgs } from "node:util";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveName, STATES, TIERS, type Manifest, type PropEntry, type State, type Tier } from "./manifest.ts";

// ---------------------------------------------------------------- types ---

/** Display order. The counts print in this order. */
export const BUCKETS = ["A", "A-var", "A′", "B", "C", "D", "E", "F", "G"] as const;
export type Bucket = (typeof BUCKETS)[number];
/** Hardest need first. A rule takes the first bucket here that any of its needs names. */
export const PRECEDENCE: readonly Bucket[] = ["G", "B", "C", "D", "F", "E", "A-var", "A′", "A"];

export const FLAG_KINDS = ["max-width-media", "off-origin", "color-literal", "font-literal", "class-selector", "important"] as const;
export type FlagKind = (typeof FLAG_KINDS)[number];
export const LINT_KINDS = ["unknown", "deprecated", "collision", "tier-state", "plain"] as const;
export type LintKind = (typeof LINT_KINDS)[number];

/** Where a rule lives. style: a <style> block (the demo). code: a text/plain code block (what the dev team ships). css: a .css file. */
export type RuleSource = "style" | "code" | "css";
/** Where a flag was found: a rule's source, or the page markup itself (a <link> in the head). */
export type SourceKind = RuleSource | "page";

export interface RuleReport {
  bucket: Bucket;
  selector: string;
  file: string;
  line: number;
  source: RuleSource;
  block: string;
  /** The at-rules around it, outermost first. */
  media: string[];
  /** Every need found, as "BUCKET: reason". The bucket is the hardest of them. */
  needs: string[];
  suggestion: string;
}

export interface TokenBlock {
  selector: string;
  file: string;
  line: number;
  source: RuleSource;
  block: string;
  names: string[];
}

export interface Flag {
  kind: FlagKind;
  file: string;
  line: number;
  source: SourceKind;
  block: string;
  selector?: string;
  detail: string;
  suggestion: string;
}

export interface LintFinding {
  kind: LintKind;
  severity: "error" | "warn" | "note";
  /** code: inside a text/plain code block. page: the demo markup and its scripts. */
  origin: "code" | "page";
  name: string;
  value?: string;
  file: string;
  line: number;
  message: string;
  suggestion?: string;
}

export interface Report {
  version: 1;
  input: string;
  kit: { props: number; tokens: number; source: string };
  summary: {
    rules: number;
    buckets: Record<Bucket, number>;
    /** The same counts split by where the rule lives. */
    bySource: Record<RuleSource, Record<Bucket, number>>;
    tokenBlocks: number;
    /** Custom-property declarations found in style attributes and template text, and checked against the kit. */
    inlineProps: number;
    flags: Record<FlagKind, number>;
    lint: Record<LintKind, number>;
    blocks: { style: number; css: number; template: number; script: number };
  };
  rules: RuleReport[];
  tokens: TokenBlock[];
  flags: Flag[];
  lint: LintFinding[];
  warnings: string[];
}

// ------------------------------------------------------------------- kit ---

export interface Kit {
  manifest: Manifest;
  /** CSS property to the props that set it and nothing else (collision props last), best first. */
  byProperty: Map<string, string[]>;
  /** Sorted property set to the pass-through props that set exactly that set (--px, --inset). */
  bySet: Map<string, string[]>;
  /** Every spelling an author can write, for "did you mean". */
  names: string[];
  /** Names kit rules read besides props and tokens (--glow-c, --tone-of). */
  reads: Set<string>;
  source: string;
}

const standardOnly = (properties: string[]) => properties.filter((p) => !p.startsWith("-"));

export function loadKit(manifest: Manifest, source = "manifest"): Kit {
  const byProperty = new Map<string, string[]>();
  const bySet = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, key: string, name: string) => {
    const list = map.get(key) ?? [];
    list.push(name);
    map.set(key, list);
  };
  const reads = new Set<string>();
  for (const [name, entry] of Object.entries(manifest.props)) {
    for (const read of entry.reads ?? []) reads.add(read);
    const std = standardOnly(entry.properties).filter((p) => !p.startsWith("page-break-"));
    if (std.length === 1) add(byProperty, std[0], name);
    else if (std.length > 1) {
      // A collision prop is the only way to write its second property, so it stays a candidate. A multi-property
      // prop with no collision (--px) answers shorthands only, never a lone longhand.
      for (const p of entry.collision ?? []) add(byProperty, p, name);
      if (entry.kind === "prop" && !entry.collision) add(bySet, [...std].sort().join(","), name);
    }
  }
  const rank = (name: string) => {
    const e = manifest.props[name];
    return [e.deprecated ? 1 : 0, e.collision ? 1 : 0, e.kind === "prop" ? 0 : 1, name.length];
  };
  for (const list of byProperty.values()) {
    list.sort((a, b) => {
      const [ra, rb] = [rank(a), rank(b)];
      for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }
  const names: string[] = [];
  for (const [name, entry] of Object.entries(manifest.props)) {
    if (!entry.requires_suffix) names.push(name);
    for (const tier of entry.tiers) names.push(`${name}-${tier}`);
    for (const state of entry.states) names.push(`${name}-${state}`);
  }
  return { manifest, byProperty, bySet, names, reads, source };
}

const hasToken = (kit: Kit, name: string) => Object.hasOwn(kit.manifest.tokens, name);

// ------------------------------------------------------------- constants ---

/** Values of --dur-1..3 and --ease-* in src/variables.css. The manifest lists the names, not the values. */
const DURATIONS: [string, number][] = [["--dur-1", 150], ["--dur-2", 300], ["--dur-3", 500]];
const EASES: [string, string][] = [["--ease-out", "cubic-bezier(.2,.8,.2,1)"], ["--ease-spring", "cubic-bezier(.3,1.35,.5,1)"]];
const DURATION_REACH_MS = 75;

/** SVG presentation properties, and clip: written in markup, not as props. */
const SVG_PROPS = new Set(
  ("fill fill-opacity fill-rule stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset stroke-miterlimit stroke-opacity " +
    "clip clip-rule stop-color stop-opacity flood-color flood-opacity lighting-color vector-effect shape-rendering paint-order marker marker-start marker-mid marker-end " +
    "dominant-baseline alignment-baseline text-anchor").split(" "),
);

const GEOMETRY_PROPS = new Set(["left", "right", "top", "bottom", "inset", "width", "height", "min-width", "min-height", "max-width", "max-height"]);
const SCROLL_PROP = /^(?:scroll-snap-[\w-]+|scrollbar-[\w-]+|scroll-margin(?:-[\w-]+)?|scroll-padding(?:-[\w-]+)?|overscroll-behavior(?:-[\w-]+)?)$/;
const DYNAMIC_UNIT = /(?<![\w.-])[+-]?(?:\d+\.?\d*|\.\d+)(?:dv|sv|lv)(?:h|w|i|b|min|max)\b/i;
const GRADIENT = /\b(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(/i;
const SHADOW_PROPS = new Set(["box-shadow", "text-shadow", "filter"]);
/** Properties that hold a colour; a bare colour word is only read as one there. */
const COLOR_PROP =
  /^(?:color|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-color)?|outline(?:-color)?|fill|stroke|box-shadow|text-shadow|caret-color|accent-color|text-decoration(?:-color)?|column-rule(?:-color)?|filter|scrollbar-color|stop-color|flood-color|lighting-color|text-fill-color|text-stroke(?:-color)?|text-emphasis-color)$/;

const NAMED_COLORS = new Set(
  ("aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen").split(" "),
);
const NEUTRAL_COLORS = new Set("black white gray grey darkgray darkgrey dimgray dimgrey lightgray lightgrey silver gainsboro whitesmoke snow ghostwhite".split(" "));
/** A shadow colour with less chroma than this (0-255) is ink, not a glow. */
const GLOW_CHROMA = 40;
/** A var() token in a shadow that names one of these is taken as coloured when nothing defines it. */
const CHROMATIC_NAME = /(?:primary|accent|brand|red|green|blue|yellow|orange|pink|purple|cyan|magenta|good|bad|warn|danger|success|error|info)/i;

const ON_ATTRS = new Set(["aria-current", "aria-selected", "aria-pressed", "aria-expanded", "open", "data-on"]);
/** Attributes a script toggles to say "this is the one". The kit has one name for it: data-on. */
const TOGGLED_DATA = new Set(
  "data-open data-show data-shown data-swapping data-enter data-active data-selected data-current data-expanded data-pressed data-checked data-loading data-busy data-visible data-hover data-focus data-collapsed".split(" "),
);
const STATE_CLASS = /^(?:is-|has-)?(?:on|active|open|opened|selected|current|show|shown|expanded|collapsed|pressed|checked|loading|busy|visible|hover|focus|enter|swapping)$/;
const STRUCTURAL = new Set(
  "first-child last-child only-child first-of-type last-of-type only-of-type nth-child nth-last-child nth-of-type nth-last-of-type empty".split(" "),
);
const LEGACY_ELEMENTS = new Set(["before", "after", "first-line", "first-letter"]);
/** Pseudo-elements with no element to carry props: markup cannot replace them. */
const UNREACHABLE_ELEMENTS = /^(?:placeholder|selection|marker|backdrop|file-selector-button|first-line|first-letter|-webkit-|-moz-|-ms-)/;

/** Box-shorthand sets that a kit prop may cover whole. */
const SHORTHAND_SETS: Record<string, string[]> = {
  inset: ["top", "right", "bottom", "left"],
  "margin-inline": ["margin-inline-start", "margin-inline-end"],
  "margin-block": ["margin-block-start", "margin-block-end"],
  "padding-inline": ["padding-inline-start", "padding-inline-end"],
  "padding-block": ["padding-block-start", "padding-block-end"],
};

const CSS_WIDE = /^(?:inherit|initial|unset|revert|revert-layer)$/i;

// --------------------------------------------------------------- lexing ---

const isSpace = (ch: string) => ch === " " || ch === "\n" || ch === "\t" || ch === "\r" || ch === "\f";

/** Index of the quote that closes the string opened at start, or text.length. */
function endOfString(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === text[start]) return i;
  }
  return text.length;
}

/** Index just past a template expression opening at i ({{ }}, {% %}, {# #}, ${ }), or -1 when none opens there. */
function templateEnd(text: string, i: number): number {
  const two = text.slice(i, i + 2);
  const close = two === "{{" ? "}}" : two === "{%" ? "%}" : two === "{#" ? "#}" : "";
  if (close) {
    const end = text.indexOf(close, i + 2);
    return end < 0 ? text.length : end + 2;
  }
  if (two === "${") {
    let depth = 0;
    for (let j = i + 1; j < text.length; j++) {
      const ch = text[j];
      if (ch === '"' || ch === "'" || ch === "`") j = endOfString(text, j);
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) return j + 1;
    }
    return text.length;
  }
  return -1;
}

/** Index of the ")" that closes the "(" at open. */
function matchParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") i++;
    else if (ch === '"' || ch === "'") i = endOfString(text, i);
    else if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return i;
  }
  return text.length;
}

function endOfBracket(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === '"' || text[i] === "'") i = endOfString(text, i);
    else if (text[i] === "]") return i;
  }
  return text.length;
}

/** Split at a separator that sits outside quotes, parentheses, brackets and template expressions. */
function splitTop(text: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const t = templateEnd(text, i);
    if (t >= 0) {
      i = t - 1;
      continue;
    }
    const ch = text[i];
    if (ch === "\\") i++;
    else if (ch === '"' || ch === "'") i = endOfString(text, i);
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (depth === 0 && (sep === " " ? isSpace(ch) : ch === sep)) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return sep === " " ? parts.filter((p) => p !== "") : parts;
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim();
const unquote = (text: string) => (/^(["']).*\1$/s.test(text) ? text.slice(1, -1) : text);

/** The text with quoted strings and url() bodies blanked, so a scan cannot read a colour word out of a font name. */
function scrub(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '"' || ch === "'") {
      const end = endOfString(value, i);
      out += `${ch}${" ".repeat(Math.max(0, end - i - 1))}${ch}`;
      i = end;
    } else if (/^url\(/i.test(value.slice(i, i + 4))) {
      const end = matchParen(value, i + 3);
      out += `url(${" ".repeat(Math.max(0, end - i - 4))})`;
      i = end;
    } else out += ch;
  }
  return out;
}

function lineIndex(text: string): (offset: number) => number {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

// ------------------------------------------------------------ selectors ---

interface Attr {
  name: string;
  op: string | null;
  value: string | null;
  /** Written inside :not(). */
  negated?: boolean;
}
interface Pseudo {
  name: string;
  args: string | null;
}
interface Compound {
  raw: string;
  tag: string | null;
  ids: string[];
  classes: string[];
  attrs: Attr[];
  pseudos: Pseudo[];
  elements: string[];
}
interface Complex {
  compounds: Compound[];
  /** combinators[i] sits between compounds[i] and compounds[i + 1]: " ", ">", "+" or "~". */
  combinators: string[];
}

const newCompound = (): Compound => ({ raw: "", tag: null, ids: [], classes: [], attrs: [], pseudos: [], elements: [] });
const emptyCompound = (c: Compound) => !c.tag && !c.ids.length && !c.classes.length && !c.attrs.length && !c.pseudos.length && !c.elements.length;

function readIdent(s: string, i: number): { text: string; next: number } {
  let j = i;
  while (j < s.length) {
    if (s[j] === "\\") j += 2;
    else if (/[\w-]/.test(s[j]) || s.charCodeAt(j) > 127) j++;
    else break;
  }
  return { text: s.slice(i, j), next: j };
}

function parseAttr(inner: string): Attr {
  const m = /^\s*([^\s~|^$*=]+)\s*(?:([~|^$*]?=)\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s]*)\s*[isIS]?)?\s*$/.exec(inner);
  if (!m) return { name: inner.trim().toLowerCase(), op: null, value: null };
  return { name: m[1].toLowerCase(), op: m[2] ?? null, value: m[3] === undefined ? null : unquote(m[3]) };
}

export function parseComplex(selector: string): Complex {
  const s = selector.trim();
  const compounds: Compound[] = [];
  const combinators: string[] = [];
  let cur = newCompound();
  let curStart = 0;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (isSpace(ch) || ch === ">" || ch === "+" || ch === "~") {
      let j = i;
      let explicit = "";
      while (j < s.length && (isSpace(s[j]) || s[j] === ">" || s[j] === "+" || s[j] === "~")) {
        if (!isSpace(s[j])) explicit = s[j];
        j++;
      }
      if (!emptyCompound(cur)) {
        cur.raw = s.slice(curStart, i);
        compounds.push(cur);
        combinators.push(explicit || " ");
        cur = newCompound();
      }
      i = j;
      curStart = j;
    } else if (ch === "[") {
      const end = endOfBracket(s, i);
      cur.attrs.push(parseAttr(s.slice(i + 1, end)));
      i = end + 1;
    } else if (ch === ".") {
      const id = readIdent(s, i + 1);
      cur.classes.push(id.text);
      i = id.next;
    } else if (ch === "#") {
      const id = readIdent(s, i + 1);
      cur.ids.push(id.text);
      i = id.next;
    } else if (ch === ":") {
      const double = s[i + 1] === ":";
      const id = readIdent(s, i + (double ? 2 : 1));
      i = id.next;
      let args: string | null = null;
      if (s[i] === "(") {
        const end = matchParen(s, i);
        args = s.slice(i + 1, end);
        i = end + 1;
      }
      const name = id.text.toLowerCase();
      if (double || LEGACY_ELEMENTS.has(name)) cur.elements.push(name);
      else cur.pseudos.push({ name, args });
    } else if (ch === "*" || ch === "&") {
      cur.tag = ch;
      i++;
    } else if (/[\w-\\]/.test(ch) || s.charCodeAt(i) > 127) {
      const id = readIdent(s, i);
      cur.tag = id.text.toLowerCase();
      i = id.next;
    } else i++;
  }
  if (!emptyCompound(cur)) {
    cur.raw = s.slice(curStart);
    compounds.push(cur);
  }
  return { compounds, combinators };
}

type StateName = "hover" | "focus" | "active" | "on";
interface StateHit {
  state: StateName;
  why: string;
  note?: string;
}
interface Facts {
  states: StateHit[];
  relational: string[];
  unknown: string[];
  /** Data or ARIA attributes that pick a variant. */
  variants: Attr[];
}

const attrText = (a: Attr) => `${a.negated ? "not " : ""}${a.name}${a.op ? `${a.op}"${a.value ?? ""}"` : ""}`;

function factsOf(c: Compound): Facts {
  const f: Facts = { states: [], relational: [], unknown: [], variants: [] };
  let hooks = 0;
  for (const a of c.attrs) {
    const n = a.name;
    if (ON_ATTRS.has(n)) {
      const off = a.op === "=" && (a.value === "false" || a.value === "");
      f.states.push({
        state: "on",
        why: `[${n}]`,
        note: off ? `[${attrText(a)}] is the off look: put it at the base and the on look in -on` : undefined,
      });
    } else if (TOGGLED_DATA.has(n)) {
      f.states.push({ state: "on", why: `[${n}]`, note: `${n} is toggled by a script: toggle data-on instead` });
    } else if (n.startsWith("data-")) {
      if (a.op) f.variants.push(a);
      else if (++hooks > 1) f.variants.push(a);
    } else if (n.startsWith("aria-") && a.op) {
      f.variants.push(a);
    }
  }
  // Classes read like data attributes: the first is the component's hook, a state word is a state, any other is a variant.
  let classHooks = 0;
  for (const cls of c.classes) {
    if (STATE_CLASS.test(cls)) f.states.push({ state: "on", why: `.${cls}`, note: `.${cls} is a state class: toggle data-on or an aria-* attribute instead` });
    else if (++classHooks > 1) f.variants.push({ name: "class", op: "~=", value: cls });
  }
  for (const p of c.pseudos) {
    switch (p.name) {
      case "hover":
        f.states.push({ state: "hover", why: ":hover" });
        break;
      case "focus-visible":
        f.states.push({ state: "focus", why: ":focus-visible" });
        break;
      case "focus":
        f.states.push({ state: "focus", why: ":focus", note: ":focus also fires on a mouse click; the kit's focus is :focus-visible" });
        break;
      case "active":
        f.states.push({ state: "active", why: ":active" });
        break;
      case "checked":
        f.states.push({ state: "on", why: ":checked" });
        break;
      case "has":
        f.relational.push(":has()");
        break;
      case "focus-within":
        f.relational.push(":focus-within");
        break;
      case "not":
        for (const inner of splitTop(p.args ?? "", ",")) {
          const last = parseComplex(inner).compounds.at(-1);
          if (!last) continue;
          const g = factsOf(last);
          if (g.states.length) f.unknown.push(`:not(${g.states[0].why})`);
          f.relational.push(...g.relational);
          f.unknown.push(...g.unknown);
          // :not([data-x]) picks a variant as much as [data-x] does
          for (const a of last.attrs) {
            if (a.name.startsWith("data-") && !ON_ATTRS.has(a.name) && !TOGGLED_DATA.has(a.name)) f.variants.push({ ...a, negated: true });
          }
        }
        break;
      case "is":
      case "where":
      case "matches":
      case "-webkit-any":
      case "-moz-any":
        for (const inner of splitTop(p.args ?? "", ",")) {
          const last = parseComplex(inner).compounds.at(-1);
          if (!last) continue;
          const g = factsOf(last);
          f.states.push(...g.states);
          f.relational.push(...g.relational);
          f.unknown.push(...g.unknown);
          f.variants.push(...g.variants);
        }
        break;
      case "root":
      case "host":
      case "scope":
        break;
      default:
        if (STRUCTURAL.has(p.name)) f.relational.push(`:${p.name}${p.args ? `(${p.args})` : ""}`);
        else f.unknown.push(`:${p.name}`);
    }
  }
  return f;
}

interface ParentState {
  state: "in-hover" | "in-on" | null;
  why: string;
  /** The state sits on the direct parent, joined by ">" . */
  direct: boolean;
  /** The state sits on the compound just before the subject, joined by " " or ">". */
  adjacent: boolean;
  note?: string;
}

interface SelInfo {
  selector: string;
  states: StateHit[];
  parents: ParentState[];
  relational: string[];
  unknown: string[];
  variants: Attr[];
  pseudoElement: string | null;
  classes: string[];
}

const GLOBAL_SCOPE = /^(?::root|html|body|\*)$/i;

export function analyzeSelector(selector: string): SelInfo {
  const cx = parseComplex(selector);
  const last = cx.compounds.length - 1;
  const info: SelInfo = {
    selector,
    states: [],
    parents: [],
    relational: [],
    unknown: [],
    variants: [],
    pseudoElement: null,
    classes: [],
  };
  if (last < 0) return info;
  const facts = cx.compounds.map(factsOf);
  const subject = cx.compounds[last];
  info.states = facts[last].states;
  info.relational.push(...facts[last].relational);
  info.unknown.push(...facts[last].unknown);
  info.variants = facts[last].variants;
  for (const el of subject.elements) {
    info.pseudoElement = `::${el}`;
    if (UNREACHABLE_ELEMENTS.test(el)) info.unknown.push(`::${el} (no element to carry props)`);
    else info.relational.push(`pseudo-element ::${el}`);
  }
  for (const comb of cx.combinators) if (comb === "+" || comb === "~") info.relational.push(`sibling combinator ${comb}`);
  for (let i = 0; i < last; i++) {
    const fact = facts[i];
    info.classes.push(...cx.compounds[i].classes);
    info.relational.push(...fact.relational);
    info.unknown.push(...fact.unknown);
    // an ancestor whose attribute has a value ([data-theme="dark"]) is a condition on the subject; a bare hook ([data-card]) is not
    for (const v of fact.variants) if (v.op) info.relational.push(`ancestor [${attrText(v)}]`);
    if (cx.compounds[i].pseudos.some((p) => p.name === "not")) info.relational.push("ancestor condition :not()");
    // A state on a compound that only descendant links join to the subject is a parent state; a sibling link makes it relational.
    const chain = cx.combinators.slice(i);
    const viaSibling = chain.some((c) => c === "+" || c === "~");
    for (const hit of fact.states) {
      if (viaSibling) {
        info.relational.push(`state ${hit.why} on a sibling`);
        continue;
      }
      const adjacent = i === last - 1;
      info.parents.push({
        state: hit.state === "hover" || hit.state === "focus" ? "in-hover" : hit.state === "on" ? "in-on" : null,
        why: hit.why,
        direct: adjacent && cx.combinators[i] === ">",
        adjacent,
        note: hit.note,
      });
    }
  }
  info.classes.push(...subject.classes);
  for (const c of cx.compounds) for (const p of c.pseudos) if (p.args && /\./.test(p.args)) info.classes.push(...classesIn(p.args));
  return info;
}

/** Class names written in a selector, ignoring attribute values and strings. */
function classesIn(selector: string): string[] {
  const bare = selector.replace(/\[(?:[^\]"']|"[^"]*"|'[^']*')*\]/g, "").replace(/"[^"]*"|'[^']*'/g, "");
  return [...bare.matchAll(/(?<![\w-])\.(-?[A-Za-z_][\w-]*)/g)].map((m) => m[1]);
}

// -------------------------------------------------------------- colours ---

function hexToRgb(hex: string): [number, number, number] | null {
  const h = hex.slice(1);
  if (h.length === 3 || h.length === 4) return [0, 1, 2].map((i) => parseInt(h[i] + h[i], 16)) as [number, number, number];
  if (h.length === 6 || h.length === 8) return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  return null;
}

/** Chroma on a 0-255 scale, or null when the literal cannot be read. */
function chromaOf(literal: string): number | null {
  const lit = literal.trim().toLowerCase();
  if (lit.startsWith("#")) {
    const rgb = hexToRgb(lit);
    return rgb ? Math.max(...rgb) - Math.min(...rgb) : null;
  }
  if (NAMED_COLORS.has(lit)) return NEUTRAL_COLORS.has(lit) ? 0 : 255;
  const fn = /^([a-z]+)\((.*)\)$/s.exec(lit);
  if (!fn) return null;
  const nums = (fn[2].match(/[+-]?(?:\d+\.?\d*|\.\d+)%?/g) ?? []).map((n) => (n.endsWith("%") ? [parseFloat(n), true] : [parseFloat(n), false])) as [number, boolean][];
  if (fn[1] === "rgb" || fn[1] === "rgba") {
    const [r, g, b] = nums.slice(0, 3).map(([n, pct]) => (pct ? (n / 100) * 255 : n));
    return [r, g, b].some((n) => n === undefined) ? null : Math.max(r, g, b) - Math.min(r, g, b);
  }
  if (fn[1] === "hsl" || fn[1] === "hsla") {
    if (nums.length < 3) return null;
    const s = nums[1][0] / 100;
    const l = nums[2][0] / 100;
    return (1 - Math.abs(2 * l - 1)) * s * 255;
  }
  if (fn[1] === "oklch" || fn[1] === "oklab" || fn[1] === "lch" || fn[1] === "lab") {
    if (nums.length < 3) return null;
    const c = fn[1].endsWith("ch") ? nums[1][0] : Math.hypot(nums[1][0], nums[2][0]);
    return fn[1].startsWith("ok") ? c * 690 : c * 1.7;
  }
  return null;
}

/** Colour literals in a value: hex, rgb()/hsl()/oklch() and friends with no var() inside, and bare colour words where the property holds a colour. */
export function colorLiterals(prop: string, value: string): string[] {
  const text = scrub(value);
  const found: string[] = [];
  for (const m of text.matchAll(/#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})\b/gi)) found.push(m[0]);
  for (const m of text.matchAll(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi)) {
    const open = m.index! + m[0].length - 1;
    const call = text.slice(m.index!, matchParen(text, open) + 1);
    if (!/var\(/i.test(call)) found.push(call);
  }
  const base = prop.replace(/^-(?:webkit|moz|ms|o)-/, "").toLowerCase();
  if (COLOR_PROP.test(base)) {
    // Words inside a function (a gradient direction, a color-mix space) are not colours; only top-level and gradient-stop words count.
    for (const m of text.matchAll(/(?<![\w-])([a-z]+)(?![\w(-])/gi)) {
      if (NAMED_COLORS.has(m[1].toLowerCase())) found.push(m[1]);
    }
  }
  return found;
}

function isColoured(value: string, defs: Map<string, string>): boolean {
  const resolved = resolveVars(value, defs);
  const text = scrub(resolved);
  for (const lit of colorLiterals("box-shadow", text)) {
    const c = chromaOf(lit);
    if (c !== null && c >= GLOW_CHROMA) return true;
  }
  for (const m of text.matchAll(/var\(\s*(--[\w-]+)/g)) if (CHROMATIC_NAME.test(m[1])) return true;
  return false;
}

/** Follow var(--x) to the token the file itself defines. Unknown tokens stay as they are; a fallback is used when the token is missing. */
export function resolveVars(value: string, defs: Map<string, string>, depth = 0): string {
  if (depth > 6 || !value.includes("var(")) return value;
  let out = "";
  for (let i = 0; i < value.length; i++) {
    if (value.startsWith("var(", i) && (i === 0 || !/[\w-]/.test(value[i - 1]))) {
      const end = matchParen(value, i + 3);
      const inner = value.slice(i + 4, end);
      const [name, ...rest] = splitTop(inner, ",");
      const def = defs.get(name.trim());
      if (def !== undefined) out += resolveVars(def, defs, depth + 1);
      else if (rest.length) out += resolveVars(rest.join(",").trim(), defs, depth + 1);
      else out += value.slice(i, end + 1);
      i = end;
    } else out += value[i];
  }
  return out;
}

function isFontStack(value: string): boolean {
  const v = value.trim();
  if (!v || CSS_WIDE.test(v) || /^var\([^)]*\)$/.test(v)) return false;
  return /["']/.test(v) || /(?:^|,)\s*(?:serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+|-apple-system)\s*(?:,|$)/i.test(v);
}

// ---------------------------------------------------------------- media ---

interface MediaCtx {
  tier: Tier | null;
  /** The kit breakpoint is not the query's width. */
  tierNote: string | null;
  maxWidth: number | null;
  print: boolean;
  reducedMotion: boolean;
  /** Features with no kit tier. */
  unmapped: string[];
}

const toPx = (n: number, unit: string) => (unit === "px" ? n : n * 16);

function nearestTier(px: number, breakpoints: Manifest["breakpoints"]): { tier: Tier; width: number } | null {
  let best: { tier: Tier; width: number } | null = null;
  for (const tier of TIERS) {
    const width = breakpoints[tier];
    if (width === undefined || tier === "pt" || tier === "xs") continue;
    if (!best || Math.abs(width - px) < Math.abs(best.width - px) || (Math.abs(width - px) === Math.abs(best.width - px) && width > best.width)) best = { tier, width };
  }
  return best;
}

function mediaContext(chain: postcss.AtRule[], kit: Kit): MediaCtx {
  const ctx: MediaCtx = { tier: null, tierNote: null, maxWidth: null, print: false, reducedMotion: false, unmapped: [] };
  let minWidth: number | null = null;
  for (const at of [...chain].reverse()) {
    const name = at.name.toLowerCase();
    if (name === "container" || name === "scope" || name === "starting-style") {
      ctx.unmapped.push(`@${name} ${at.params}`.trim());
      continue;
    }
    if (name !== "media") continue;
    const queries = splitTop(at.params.toLowerCase(), ",").map(squash);
    if (queries.length > 1) {
      ctx.unmapped.push(`@media ${at.params}`);
      continue;
    }
    const q = queries[0];
    if (/(?:^|\s)not\s/.test(q)) {
      ctx.unmapped.push(`@media ${at.params}`);
      continue;
    }
    if (/(?:^|[\s(])print(?![\w-])/.test(q)) ctx.print = true;
    for (const m of q.matchAll(/\(([^()]*)\)/g)) {
      const feature = squash(m[1]);
      let g: RegExpExecArray | null;
      if ((g = /^min-width\s*:\s*([\d.]+)(px|em|rem)$/.exec(feature))) minWidth = Math.max(minWidth ?? 0, toPx(parseFloat(g[1]), g[2]));
      else if ((g = /^max-width\s*:\s*([\d.]+)(px|em|rem)$/.exec(feature))) ctx.maxWidth = Math.min(ctx.maxWidth ?? Infinity, toPx(parseFloat(g[1]), g[2]));
      else if ((g = /^width\s*(>=|>)\s*([\d.]+)(px|em|rem)$/.exec(feature))) minWidth = Math.max(minWidth ?? 0, toPx(parseFloat(g[2]), g[3]));
      else if ((g = /^width\s*(<=|<)\s*([\d.]+)(px|em|rem)$/.exec(feature))) ctx.maxWidth = Math.min(ctx.maxWidth ?? Infinity, toPx(parseFloat(g[2]), g[3]));
      else if (/^hover\s*:\s*hover$/.test(feature)) continue;
      else if (/^prefers-reduced-motion\s*:\s*reduce$/.test(feature)) ctx.reducedMotion = true;
      else ctx.unmapped.push(`(${feature})`);
    }
  }
  if (minWidth !== null && minWidth > 1) {
    const near = nearestTier(minWidth, kit.manifest.breakpoints);
    if (near) {
      ctx.tier = near.tier;
      if (near.width !== minWidth) ctx.tierNote = `min-width:${minWidth}px is not a kit breakpoint; ${near.tier} is ${near.width}px`;
    } else ctx.unmapped.push(`(min-width: ${minWidth}px)`);
  }
  if (ctx.print && !ctx.tier) ctx.tier = "pt";
  return ctx;
}

// ----------------------------------------------------------- html blocks ---

interface Block {
  kind: "style" | "code" | "script" | "data";
  id: string;
  name: string;
  path: string;
  start: number;
  end: number;
  text: string;
}

const decodeEntities = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");

/** The text with HTML comments and template comments blanked, same length, so offsets and lines still hold. */
function maskComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->|\{#[\s\S]*?#\}/g, (c) => c.replace(/[^\n]/g, " "));
}

function parseTagAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of source.matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

function scanBlocks(html: string): Block[] {
  const masked = html.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, " "));
  const lower = masked.toLowerCase();
  const blocks: Block[] = [];
  const open = /<(script|style)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = open.exec(masked))) {
    if (m[2].trimEnd().endsWith("/")) continue;
    const tag = m[1].toLowerCase();
    const start = m.index + m[0].length;
    const close = lower.indexOf(`</${tag}`, start);
    const end = close < 0 ? html.length : close;
    const attrs = parseTagAttrs(m[2]);
    const type = (attrs.type ?? "").toLowerCase().trim();
    const kind: Block["kind"] =
      tag === "style"
        ? "style"
        : type === "" || /(?:java|ecma)script|module|jsx|tsx|babel/.test(type)
          ? "script"
          : /json|importmap|speculationrules/.test(type)
            ? "data"
            : "code";
    blocks.push({ kind, id: attrs.id ?? "", name: attrs["data-name"] ?? "", path: attrs["data-path"] ?? "", start, end, text: html.slice(start, end) });
    open.lastIndex = close < 0 ? html.length : Math.max(open.lastIndex, (lower.indexOf(">", close) + 1) || html.length);
  }
  return blocks;
}

type CodeKind = "css" | "template" | "script" | "data" | "unknown";

function codeKind(block: Block): CodeKind {
  const file = (block.path || block.name).replace(/\s*\(.*$/s, "").trim().toLowerCase();
  const ext = /\.([a-z0-9]+)$/.exec(file)?.[1] ?? "";
  if (ext === "css") return "css";
  if (/^(?:html?|njk|jinja2?|j2|django|twig|liquid|hbs|mustache|ejs|erb|vue|svelte|txt|md|jsx|tsx)$/.test(ext)) return "template";
  if (/^(?:js|mjs|cjs|ts)$/.test(ext)) return "script";
  if (/^(?:json|ya?ml|toml|py|sh|bash|sql|csv|xml|ini|env)$/.test(ext)) return "data";
  const name = block.name.trim().toLowerCase();
  if (name === "css") return "css";
  if (name === "js" || name === "javascript") return "script";
  if (name === "html" || name === "template" || name === "jinja" || name === "njk") return "template";
  return "unknown";
}

/** Parses as CSS, holds a rule, and every declaration name looks like a CSS property. */
function looksLikeCss(text: string): boolean {
  let root: postcss.Root;
  try {
    root = postcss.parse(text);
  } catch {
    return false;
  }
  let decls = 0;
  let rules = 0;
  let bad = false;
  root.walk((node) => {
    if (node.type === "rule") {
      rules++;
      if (/[{}%=]|=>|\bfunction\b/.test(node.selector)) bad = true;
    } else if (node.type === "decl") {
      decls++;
      if (!/^(?:--[\w-]+|-?[a-z][a-z0-9-]*)$/i.test(node.prop)) bad = true;
    }
  });
  return !bad && rules > 0 && decls > 0;
}

// -------------------------------------------------- inline declarations ---

interface InlineDecl {
  name: string;
  rawName: string;
  value: string;
  /** Offset of the name in the file. */
  start: number;
}

/** Declarations of one style attribute value, template expressions kept whole. */
function parseInlineDecls(value: string, base: number): InlineDecl[] {
  const out: InlineDecl[] = [];
  let segStart = 0;
  let depth = 0;
  const flush = (end: number) => {
    const seg = value.slice(segStart, end);
    let colon = -1;
    let d = 0;
    for (let j = 0; j < seg.length; j++) {
      const t = templateEnd(seg, j);
      if (t >= 0) {
        j = t - 1;
        continue;
      }
      const c = seg[j];
      if (c === '"' || c === "'") j = endOfString(seg, j);
      else if (c === "(") d++;
      else if (c === ")") d--;
      else if (c === ":" && d === 0) {
        colon = j;
        break;
      }
    }
    if (colon < 0) return;
    // {% if %} and {# #} around a declaration print nothing of their own
    const bare = (text: string) => text.replace(/\{%[\s\S]*?%\}|\{#[\s\S]*?#\}/g, "");
    const rawName = bare(seg.slice(0, colon));
    const name = rawName.trim();
    if (!/^-{0,2}[A-Za-z_][\w-]*$/.test(name)) return;
    const pos = seg.indexOf(name);
    out.push({ name, rawName, value: bare(seg.slice(colon + 1)).trim(), start: base + segStart + Math.max(0, pos) });
  };
  for (let i = 0; i < value.length; i++) {
    const t = templateEnd(value, i);
    if (t >= 0) {
      i = t - 1;
      continue;
    }
    const c = value[i];
    if (c === '"' || c === "'") i = endOfString(value, i);
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === ";" && depth === 0) {
      flush(i);
      segStart = i + 1;
    }
  }
  flush(value.length);
  return out;
}

/** Every style="..." in a stretch of text. A value that reads like string concatenation in a script is skipped. */
function findStyleAttrs(text: string, base: number): { start: number; value: string }[] {
  const found: { start: number; value: string }[] = [];
  const re = /(?<![\w:-])style\s*=\s*(["'])/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const quote = m[1];
    const from = m.index + m[0].length;
    let i = from;
    let closed = false;
    while (i < text.length && i - from < 4000) {
      const t = templateEnd(text, i);
      if (t >= 0) {
        i = t;
        continue;
      }
      if (text[i] === quote) {
        closed = true;
        break;
      }
      i++;
    }
    if (!closed) continue;
    const value = text.slice(from, i);
    re.lastIndex = i + 1;
    if (/['"`]\s*\+|\+\s*['"`]/.test(value.replace(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|\$\{[\s\S]*?\}/g, ""))) continue;
    found.push({ start: base + from, value });
  }
  return found;
}

/** Every --name: in template text, wherever it sits. */
function findPropUses(text: string, base: number): InlineDecl[] {
  const out: InlineDecl[] = [];
  const re = /(?<![\w-])(--[A-Za-z_][\w-]*)(\s*):(?!:)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const rest = text.slice(m.index + m[0].length);
    const end = rest.search(/[;"'\n]/);
    out.push({ name: m[1], rawName: m[1] + m[2], value: (end < 0 ? rest : rest.slice(0, end)).trim(), start: base + m.index });
  }
  return out;
}

function findLinks(text: string, base: number): { start: number; rel: string; href: string; as: string }[] {
  const out: { start: number; rel: string; href: string; as: string }[] = [];
  for (const m of text.matchAll(/<link\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
    const attrs = parseTagAttrs(m[1]);
    if (attrs.href) out.push({ start: base + m.index!, rel: (attrs.rel ?? "").toLowerCase(), href: attrs.href, as: (attrs.as ?? "").toLowerCase() });
  }
  return out;
}

const offOrigin = (url: string) => /^\s*(?:https?:)?\/\//i.test(url);
const FETCHING_REL = /(?:stylesheet|preload|preconnect|dns-prefetch|prefetch|modulepreload|prerender|icon|manifest)/;

function urlsIn(value: string): string[] {
  const urls: string[] = [];
  for (const m of value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi)) urls.push(m[1] ?? m[2] ?? m[3] ?? "");
  return urls;
}

// -------------------------------------------------------------- analysis ---

interface Need {
  bucket: Bucket;
  why: string;
}

interface FileCtx {
  file: string;
  kit: Kit;
  defs: Map<string, string>;
  keyframes: Map<string, string>;
  report: Report;
}

interface BlockCtx {
  source: RuleSource;
  label: string;
  /** Line of the block's first character. */
  line0: number;
}

const lineIn = (b: BlockCtx, node: postcss.Node) => b.line0 + ((node.source?.start?.line ?? 1) - 1);

/** The at-rules around a node, innermost first. */
function atRulesAround(node: postcss.Node): postcss.AtRule[] {
  const found: postcss.AtRule[] = [];
  for (let n = node.parent; n && n.type !== "root"; n = n.parent as postcss.Container | undefined) {
    if (n.type === "atrule") found.push(n as postcss.AtRule);
  }
  return found;
}

const baseProp = (prop: string) => prop.toLowerCase().replace(/^-(?:webkit|moz|ms|o)-/, "");
const cleanValue = (v: string) => squash(v.replace(/\s*!important\s*$/i, ""));
const hasProp = (kit: Kit, name: string) => Object.hasOwn(kit.manifest.props, name);

interface Ctx {
  suffix: "" | State;
  pseudo: string | null;
  notes: string[];
}

const STATE_RANK: Record<string, number> = { "in-hover": 1, hover: 2, "in-on": 3, on: 4, focus: 5, active: 6 };
const strongest = <T extends string>(states: T[]): T => states.reduce((a, b) => (STATE_RANK[a] >= STATE_RANK[b] ? a : b));

/** The state a rule's props need, from its selector. Strongest wins: the kit's ladder is in-hover < hover < in-on < on < focus < active. */
function contextOf(info: SelInfo): Ctx {
  const notes: string[] = [];
  const note = (text?: string) => {
    if (text && !notes.includes(text)) notes.push(text);
  };
  let suffix = "" as Ctx["suffix"];
  if (info.states.length) {
    suffix = strongest(info.states.map((s) => s.state));
    const whys = [...new Set(info.states.map((s) => s.why))];
    if (new Set(info.states.map((s) => s.state)).size > 1) note(`${whys.join(" with ")} combine; the kit has no AND, so only -${suffix} is written`);
    for (const s of info.states) note(s.note);
  } else if (info.parents.length) {
    const withState = info.parents.filter((p) => p.state);
    if (withState.length) {
      suffix = strongest(withState.map((p) => p.state!));
      const near = withState.find((p) => p.state === suffix)!;
      if (!near.direct) {
        note(`-${suffix} reaches direct children only; ${near.adjacent ? "a deeper descendant needs markup" : "the state sits more than one level up, so this needs markup"}`);
      }
      for (const p of withState) note(p.note);
    } else note(`${info.parents[0].why} on a parent has no -in- state`);
  }
  if (info.pseudoElement && suffix && !suffix.startsWith("in-")) {
    // The pseudo-element becomes a child element, so the element's own state turns into a parent state.
    if (suffix === "hover") suffix = "in-hover";
    else if (suffix === "on") suffix = "in-on";
    else note(`${suffix} on the parent has no -in- state`);
  }
  return { suffix, pseudo: info.pseudoElement, notes };
}

interface Picked {
  /** The name to write, with its suffix when the prop has one. */
  name: string;
  /** The prop without a suffix. */
  base: string;
  notes: string[];
  /** The suffix the prop lacks, such as "-hover" or "-md tier". */
  missing: string | null;
}

function pickProp(kit: Kit, prop: string, suffix: "" | State, tier: Tier | null): Picked | null {
  const candidates = kit.byProperty.get(prop);
  if (!candidates?.length) return null;
  const supports = (name: string) => {
    const e = kit.manifest.props[name];
    if (suffix) return e.states.includes(suffix);
    if (tier) return e.tiers.includes(tier);
    return true;
  };
  const base = candidates.find(supports) ?? candidates[0];
  const entry = kit.manifest.props[base];
  const notes: string[] = [];
  let name = base;
  let missing: string | null = null;
  if (suffix || tier) {
    if (supports(base)) name = `${base}-${suffix || tier}`;
    else missing = suffix ? `-${suffix}` : `-${tier} tier`;
  }
  if (entry.collision) notes.push(`${base} also sets ${entry.collision.filter((p) => p !== prop).join(" and ")}`);
  return { name, base, notes, missing };
}

/** Needs that do not depend on the selector: what the declarations ask for. */
function declNeeds(decl: postcss.Declaration, fc: FileCtx): Need[] {
  const needs: Need[] = [];
  const prop = baseProp(decl.prop);
  if (prop.startsWith("--")) return needs;
  const value = cleanValue(decl.value);
  const resolved = resolveVars(value, fc.defs);
  if (/^(?:transition|animation)(?:-|$)/.test(prop)) needs.push({ bucket: "D", why: prop });
  if (prop === "transition" || prop === "transition-property") {
    // A transition on left, width and the like animates geometry that changes at run time: a script sets it.
    const moved = splitTop(resolved, ",").map((item) => splitTop(item.trim(), " ")[0]?.toLowerCase() ?? "").filter((p) => GEOMETRY_PROPS.has(p));
    if (moved.length) needs.push({ bucket: "G", why: `transition on ${[...new Set(moved)].join(", ")}: a script sets this geometry` });
  }
  if (prop === "backdrop-filter") needs.push({ bucket: "E", why: "backdrop-filter" });
  if (prop === "background-clip" && /\btext\b/i.test(value)) needs.push({ bucket: "E", why: "background-clip: text" });
  if (prop === "text-fill-color") needs.push({ bucket: "E", why: "text-fill-color" });
  if (GRADIENT.test(resolved) || (/^var\(\s*--[\w-]*grad[\w-]*\s*\)$/i.test(value) && !fc.defs.has(value.slice(4, -1).trim()))) {
    needs.push({ bucket: "E", why: "gradient" });
  }
  if (/color-mix\(/i.test(resolved)) needs.push({ bucket: "E", why: "color-mix" });
  if (SHADOW_PROPS.has(prop) && isColoured(value, fc.defs)) needs.push({ bucket: "E", why: "coloured shadow" });
  if (/\benv\s*\(/i.test(resolved)) needs.push({ bucket: "F", why: "env()" });
  if (DYNAMIC_UNIT.test(resolved)) needs.push({ bucket: "F", why: "dynamic viewport unit" });
  if (prop === "position" && /^sticky$/i.test(value)) needs.push({ bucket: "F", why: "position: sticky" });
  if (prop === "text-overflow") needs.push({ bucket: "F", why: "text-overflow" });
  if (SCROLL_PROP.test(prop)) needs.push({ bucket: "F", why: prop });
  if (SVG_PROPS.has(prop)) needs.push({ bucket: "A′", why: prop });
  return needs;
}

/** Break a space-separated list of 1 to 4 box values into [top, right, bottom, left]. */
function boxValues(parts: string[]): string[] | null {
  if (parts.length === 1) return [parts[0], parts[0], parts[0], parts[0]];
  if (parts.length === 2) return [parts[0], parts[1], parts[0], parts[1]];
  if (parts.length === 3) return [parts[0], parts[1], parts[2], parts[1]];
  if (parts.length === 4) return parts;
  return null;
}

function mapTime(token: string): number | null {
  const m = /^(\d*\.?\d+)(ms|s)$/i.exec(token);
  return m ? Math.round(parseFloat(m[1]) * (m[2].toLowerCase() === "s" ? 1000 : 1)) : null;
}

const normEase = (s: string) => s.replace(/\s+/g, "").replace(/(?<![\d])0\./g, ".").toLowerCase();

function easeToken(token: string, kit: Kit): string | null {
  const n = normEase(token);
  for (const [name, value] of EASES) if (n === value && hasToken(kit, name)) return `var(${name})`;
  return null;
}

function durToken(ms: number, kit: Kit): string | null {
  let best: [string, number] | null = null;
  for (const [name, at] of DURATIONS) {
    const d = Math.abs(at - ms);
    if (hasToken(kit, name) && d <= DURATION_REACH_MS && (!best || d < best[1])) best = [name, d];
  }
  return best ? `var(${best[0]})` : null;
}

function suggestTransition(value: string, kit: Kit): string {
  return splitTop(value, ",")
    .map((item) => {
      let times = 0;
      return splitTop(item.trim(), " ")
        .map((token) => {
          const ms = mapTime(token);
          if (ms !== null) return times++ === 0 ? (durToken(ms, kit) ?? token) : token;
          return easeToken(token, kit) ?? token;
        })
        .join(" ");
    })
    .join(", ");
}

const ANIM_TIMING = /^(?:linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end)$/i;
const ANIM_WORDS = new Set("none infinite alternate alternate-reverse reverse normal forwards backwards both running paused".split(" "));

/** animation: name time ease [delay] fill, with the kit's tokens and keyframes. A separate animation-delay joins the shorthand. */
function suggestAnimation(value: string, delay: string | null, fc: FileCtx): string {
  const tokens = splitTop(value, " ");
  let times = 0;
  let lastTiming = -1;
  const out = tokens.map((token, i) => {
    const ms = mapTime(token);
    if (ms !== null) {
      lastTiming = i;
      return times++ === 0 ? (durToken(ms, fc.kit) ?? token) : token;
    }
    if (ANIM_TIMING.test(token) || /^(?:cubic-bezier|steps)\(/i.test(token)) {
      lastTiming = i;
      return easeToken(token, fc.kit) ?? token;
    }
    if (ANIM_WORDS.has(token.toLowerCase()) || /^[+-]?[\d.]/.test(token) || /^calc\(/.test(token)) return token;
    return fc.keyframes.get(token) ?? token;
  });
  if (delay && times < 2) {
    // an unset --i would void the whole shorthand, so the kit's notes ask for a fallback
    out.splice(lastTiming + 1, 0, delay.replace(/var\(\s*(--[\w-]+)\s*\)/g, "var($1, 0)"));
  }
  return out.join(" ");
}

/** The arguments of every fn(...) call in a value. */
function callArgs(value: string, fn: string): string[][] {
  const found: string[][] = [];
  const re = new RegExp(`(?<![\\w-])${fn}\\(`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) {
    const open = m.index + m[0].length - 1;
    const end = matchParen(value, open);
    found.push(splitTop(value.slice(open + 1, end), ",").map((a) => a.trim()));
    re.lastIndex = end;
  }
  return found;
}

const isZero = (a: string) => /^[+-]?0*\.?0+[a-z%]*$/.test(a) || a === "none";

/** Which kit keyframes a @keyframes block most resembles. */
function keyframeShape(at: postcss.AtRule): string | null {
  let opacity = false;
  let moveY = false;
  let moveX = false;
  let scale = false;
  let rotate = false;
  at.walkDecls((d) => {
    const p = d.prop.toLowerCase();
    const v = d.value.toLowerCase();
    if (p === "opacity") opacity = true;
    if (p === "transform" || p === "translate") {
      for (const args of callArgs(v, "translate")) {
        if (args[1] && !isZero(args[1])) moveY = true;
        if (args[0] && !isZero(args[0])) moveX = true;
      }
      for (const args of callArgs(v, "translatey")) if (args[0] && !isZero(args[0])) moveY = true;
      for (const args of callArgs(v, "translatex")) if (args[0] && !isZero(args[0])) moveX = true;
      if (p === "translate" && !v.includes("(")) {
        const [x, y] = splitTop(v, " ");
        if (y && !isZero(y)) moveY = true;
        if (x && !isZero(x)) moveX = true;
      }
    }
    if (p === "scale" || (p === "transform" && /scale/.test(v))) scale = true;
    if (p === "rotate" || (p === "transform" && /rotate/.test(v))) rotate = true;
  });
  if (rotate && !opacity) return "spin";
  if (opacity && scale) return "st-pop";
  if (opacity && moveY) return "st-rise";
  if (opacity && moveX) return "st-slide-in";
  if (opacity && !moveX && !moveY && !scale && !rotate) return "st-fade";
  return null;
}

interface Translation {
  props: Map<string, string>;
  attrs: string[];
  hints: string[];
  unmapped: string[];
  /** Missing suffix to the props that lack it. */
  missing: Map<string, Set<string>>;
}

const newTranslation = (): Translation => ({ props: new Map(), attrs: [], hints: [], unmapped: [], missing: new Map() });

/** Folds: several declarations that one kit prop replaces. */
interface Folds {
  skip: Set<postcss.Declaration>;
  textGrad: { gradient: string; transparent: boolean } | null;
  clamp: string | null;
}

function foldsOf(decls: postcss.Declaration[], fc: FileCtx): Folds {
  const skip = new Set<postcss.Declaration>();
  const by = (p: string) => decls.filter((d) => baseProp(d.prop) === p);
  const last = (p: string) => by(p).at(-1);
  const folds: Folds = { skip, textGrad: null, clamp: null };
  const clip = by("background-clip").find((d) => /\btext\b/i.test(d.value));
  if (clip && hasProp(fc.kit, "--text-grad")) {
    const bg = [...decls].reverse().find((d) => ["background", "background-image"].includes(baseProp(d.prop)) && GRADIENT.test(resolveVars(d.value, fc.defs)));
    if (bg) {
      for (const d of by("background-clip")) skip.add(d);
      skip.add(bg);
      let transparent = false;
      for (const d of decls) {
        const p = baseProp(d.prop);
        if ((p === "color" || p === "text-fill-color") && /^transparent$/i.test(cleanValue(d.value))) {
          transparent = true;
          skip.add(d);
        }
      }
      folds.textGrad = { gradient: cleanValue(bg.value), transparent };
    }
  }
  const clamp = last("line-clamp");
  const [te, ws, ov] = [last("text-overflow"), last("white-space"), last("overflow")];
  if (hasProp(fc.kit, "--line-clamp")) {
    if (clamp) {
      skip.add(clamp);
      for (const d of by("box-orient")) skip.add(d);
      for (const d of by("display")) if (/^(?:-webkit-)?box$/i.test(cleanValue(d.value))) skip.add(d);
      for (const d of by("overflow")) if (/^hidden$/i.test(cleanValue(d.value))) skip.add(d);
      folds.clamp = cleanValue(clamp.value);
    } else if (te && ws && ov && /^ellipsis$/i.test(cleanValue(te.value)) && /^nowrap$/i.test(cleanValue(ws.value)) && /^hidden$/i.test(cleanValue(ov.value))) {
      for (const d of [te, ws, ov]) skip.add(d);
      folds.clamp = "1";
    }
  }
  return folds;
}

/** font: [style] [weight] size[/line-height] family, or null when it does not read that way. */
function parseFont(value: string): { style?: string; weight?: string; size: string; lineHeight?: string; family: string } | null {
  const tokens = splitTop(value.replace(/\s*\/\s*/g, "/"), " ");
  let i = 0;
  let style: string | undefined;
  let weight: string | undefined;
  for (; i < tokens.length; i++) {
    const t = tokens[i];
    if (/^(?:italic|oblique)$/i.test(t)) style = t;
    else if (/^(?:normal|small-caps)$/i.test(t)) continue;
    else if (/^(?:bold|bolder|lighter|[1-9]00)$/i.test(t)) weight = t;
    else break;
  }
  const [size, lineHeight] = (tokens[i] ?? "").split("/");
  const sized = /^(?:[+-]?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|%|pt|vw|vh|ch|ex)|xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger|(?:calc|var|clamp|min|max)\(.*)$/i;
  if (!size || !sized.test(size)) return null;
  const family = tokens.slice(i + 1).join(" ");
  return family ? { style, weight, size, lineHeight, family } : null;
}

const LOGICAL_PAIR: Record<string, [string, string]> = {
  "padding-block": ["padding-top", "padding-bottom"],
  "padding-inline": ["padding-left", "padding-right"],
  "margin-block": ["margin-top", "margin-bottom"],
  "margin-inline": ["margin-left", "margin-right"],
};
const LOGICAL_LONGHAND: Record<string, string> = {
  "padding-block-start": "padding-top",
  "padding-block-end": "padding-bottom",
  "padding-inline-start": "padding-left",
  "padding-inline-end": "padding-right",
  "margin-block-start": "margin-top",
  "margin-block-end": "margin-bottom",
  "margin-inline-start": "margin-left",
  "margin-inline-end": "margin-right",
};

/** One declaration as kit props or markup attributes, or as a note that nothing fits. */
function translateDecl(decl: postcss.Declaration, sibling: Map<string, postcss.Declaration>, ctx: Ctx, m: MediaCtx, fc: FileCtx, out: Translation) {
  const kit = fc.kit;
  const raw = decl.prop.toLowerCase();
  const prop = baseProp(raw);
  if (prop.startsWith("--")) return;
  // autoprefixer writes the prefixed twin; the standard declaration speaks for both
  if (raw !== prop && sibling.has(prop)) return;
  const value = cleanValue(decl.value);
  const suffix = ctx.suffix;
  const tier = suffix ? null : m.tier;
  const hint = (text: string) => {
    if (!out.hints.includes(text)) out.hints.push(text);
  };
  const put = (name: string, v: string) => {
    out.props.set(name, `${name}:${v}`);
  };
  const via = (cssProp: string, v: string) => {
    const p = pickProp(kit, cssProp, suffix, tier);
    if (!p) return false;
    if (new RegExp(`^var\\(\\s*${p.base}\\s*[,)]`).test(v)) {
      hint(`${decl.prop}: ${v} is what the kit's ${p.base} already does; the inline ${p.base}:N is enough`);
      return true;
    }
    put(p.name, v);
    for (const n of p.notes) hint(n);
    if (p.missing) {
      const set = out.missing.get(p.missing) ?? new Set<string>();
      set.add(p.base);
      out.missing.set(p.missing, set);
    }
    return true;
  };
  if (prop === "content" && ctx.pseudo) {
    if (!/^(?:""|''|none|normal)$/.test(value)) hint(`content ${value} becomes text or an element in the markup`);
    return;
  }
  if (SVG_PROPS.has(prop)) {
    out.attrs.push(`${prop}="${value}"`);
    return;
  }
  if (/^transition(?:-|$)/.test(prop)) {
    const v = prop === "transition" ? suggestTransition(resolveVars(value, fc.defs), kit) : value;
    if (!via(prop, v)) out.unmapped.push(prop);
    return;
  }
  if (/^animation(?:-|$)/.test(prop)) {
    if (prop === "animation") {
      const delay = sibling.get("animation-delay");
      if (!via("animation", suggestAnimation(resolveVars(value, fc.defs), delay ? cleanValue(delay.value) : null, fc))) out.unmapped.push(prop);
    } else if (!sibling.has("animation")) hint(`${prop} goes inside --anim`);
    return;
  }
  if (prop === "text-overflow") {
    hint(`text-overflow has no prop; ${hasProp(kit, "--line-clamp") ? "--line-clamp:1 gives a one-line ellipsis" : "the kit has no --line-clamp"}`);
    return;
  }
  if (SCROLL_PROP.test(prop)) {
    hint(`no kit prop for ${prop}`);
    return;
  }
  if (prop === "place-items" || prop === "place-content") {
    const [a, b] = splitTop(value, " ");
    const [pa, pb] = prop === "place-items" ? ["align-items", "justify-items"] : ["align-content", "justify-content"];
    const okA = via(pa, a);
    const okB = via(pb, b ?? a);
    if (!okA || !okB) out.unmapped.push(prop);
    else hint(`${prop} is written as two props`);
    return;
  }
  if (prop === "font") {
    if (CSS_WIDE.test(value)) {
      let ok = false;
      for (const p of ["font-family", "font-size", "font-weight", "line-height"]) ok = via(p, value) || ok;
      if (ok) hint("font:inherit is written as --ff, --size, --weight and --lh");
      else out.unmapped.push(prop);
      return;
    }
    const f = parseFont(value);
    if (f && kit.byProperty.has("font-family") && kit.byProperty.has("font-size")) {
      if (f.style) via("font-style", f.style);
      if (f.weight) via("font-weight", f.weight);
      via("font-size", f.size);
      if (f.lineHeight) via("line-height", f.lineHeight);
      via("font-family", f.family);
      hint("the font shorthand is written as --weight, --size, --lh and --ff");
      return;
    }
    out.unmapped.push(prop);
    return;
  }
  if (prop in SHORTHAND_SETS) {
    const parts = splitTop(value, " ");
    const whole = kit.bySet.get([...SHORTHAND_SETS[prop]].sort().join(","))?.[0];
    if (parts.length === 1 && whole) {
      put(whole, value);
      return;
    }
    if (prop === "inset") {
      const box = boxValues(parts);
      const sides = ["top", "right", "bottom", "left"];
      if (box && sides.every((s) => kit.byProperty.has(s))) {
        sides.forEach((s, i) => via(s, box[i]));
        return;
      }
    }
    const pair = LOGICAL_PAIR[prop];
    if (pair && parts.length <= 2 && via(pair[0], parts[0]) && via(pair[1], parts[1] ?? parts[0])) {
      hint(`${prop} is written with physical sides (horizontal text)`);
      return;
    }
    out.unmapped.push(prop);
    return;
  }
  if (prop in LOGICAL_LONGHAND) {
    if (via(LOGICAL_LONGHAND[prop], value)) hint(`${prop} is written with a physical side (horizontal text)`);
    else out.unmapped.push(prop);
    return;
  }
  if (/^border-(?:top|right|bottom|left)-color$/.test(prop)) {
    const p = pickProp(kit, "border-color", suffix, tier);
    if (p) {
      via("border-color", value);
      hint(`${prop} is written with ${p.base}, which colours all four sides; only a side with a border shows it`);
      return;
    }
  }
  if (!via(prop, value)) out.unmapped.push(prop);
}

function bucketOf(needs: Need[]): Bucket {
  for (const bucket of PRECEDENCE) if (needs.some((n) => n.bucket === bucket)) return bucket;
  return "A";
}

function emptyCounts(): Record<Bucket, number> {
  return Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<Bucket, number>;
}

const at = (file: string, line: number) => `${file}:${line}`;

function addFlag(fc: FileCtx, b: BlockCtx, flag: Omit<Flag, "file" | "source" | "block">) {
  fc.report.flags.push({ ...flag, file: fc.file, source: b.source, block: b.label });
}

/** The tier a max-width query points at: the kit breakpoint nearest the width just above it. */
function wideSide(maxWidth: number, kit: Kit): string {
  const near = nearestTier(maxWidth + 1, kit.manifest.breakpoints);
  return near ? `the -${near.tier} tier (${near.width}px), as --x-${near.tier}` : "the -md tier, as --x-md";
}

function declFlags(decl: postcss.Declaration, b: BlockCtx, fc: FileCtx, selector: string) {
  const line = lineIn(b, decl);
  const prop = decl.prop.toLowerCase();
  const value = cleanValue(decl.value);
  if (decl.important) {
    addFlag(fc, b, {
      kind: "important",
      line,
      selector,
      detail: `${prop}: ${value} !important`,
      suggestion: "drop it: set the value as a kit prop on the element, which is !important already",
    });
  }
  const isCustom = prop.startsWith("--");
  if (isCustom ? /(?:font|mono|sans|serif|display|face|type)/i.test(prop) && isFontStack(value) : (prop === "font-family" || prop === "font") && isFontStack(value)) {
    const token = /mono|courier|consolas/i.test(value) ? "--font-mono" : "--font-sans";
    const serif = /(?:^|[\s,])(?:serif|cursive|fantasy)\s*(?:,|$)/i.test(value) && !/sans-serif/i.test(value);
    addFlag(fc, b, {
      kind: "font-literal",
      line,
      selector,
      detail: `${prop}: ${value}`,
      suggestion: `use var(${token}), written --ff:var(${token})${serif ? " (the kit has a sans and a mono token, no serif)" : ""}`,
    });
  }
  const colours = colorLiterals(prop, value);
  if (colours.length) {
    addFlag(fc, b, {
      kind: "color-literal",
      line,
      selector,
      detail: `${prop}: ${colours.join(", ")}`,
      suggestion: "use a colour token (--primary, --good-bg, --text-muted ...), --mix:RGB for a cube cell or --tone:N for a grey or tint",
    });
  }
  for (const url of urlsIn(value)) {
    if (offOrigin(url)) addFlag(fc, b, { kind: "off-origin", line, selector, detail: `${prop}: url(${url})`, suggestion: "self-host the file or drop it; the kit makes no request off its own origin" });
  }
}

function analyzeRule(rule: postcss.Rule, b: BlockCtx, fc: FileCtx): void {
  const chain = atRulesAround(rule);
  if (chain.some((a) => /keyframes$/i.test(a.name))) return;
  const selectors = rule.selectors.map(squash);
  const selectorText = selectors.join(", ");
  const line = lineIn(b, rule);
  const decls: postcss.Declaration[] = [];
  rule.each((n) => {
    if (n.type === "decl") decls.push(n);
  });
  for (const d of decls) declFlags(d, b, fc, selectorText);

  const custom = decls.filter((d) => d.prop.startsWith("--"));
  if (decls.length > 0 && custom.length === decls.length) {
    fc.report.tokens.push({ selector: selectorText, file: fc.file, line, source: b.source, block: b.label, names: custom.map((d) => d.prop) });
    return;
  }

  const infos = selectors.map(analyzeSelector);
  for (const info of infos) {
    const classes = [...new Set(info.classes)];
    if (classes.length) {
      addFlag(fc, b, {
        kind: "class-selector",
        line,
        selector: info.selector,
        detail: classes.map((c) => `.${c}`).join(", "),
        suggestion: "consumer markup uses no classes: hook on a data-* or aria-* attribute, or put the props on the element",
      });
    }
  }
  const m = mediaContext(chain, fc.kit);
  const needs: Need[] = [];
  const add = (bucket: Bucket, why: string) => {
    if (!needs.some((n) => n.bucket === bucket && n.why === why)) needs.push({ bucket, why });
  };

  // What the declarations ask for.
  for (const d of decls) for (const n of declNeeds(d, fc)) add(n.bucket, n.why);

  // What the selectors ask for.
  for (const info of infos) {
    for (const s of info.states) add("B", s.why);
    for (const p of info.parents) add("C", `state ${p.why} on a parent`);
    for (const r of info.relational) add("C", r);
    for (const u of info.unknown) add("G", `no kit state for ${u}`);
    if (info.variants.length) add("A-var", info.variants.map(attrText).join(", "));
  }
  for (const u of m.unmapped) add("G", `no kit tier for ${u}`);

  // Translate once per distinct context.
  const contexts = new Map<string, Ctx>();
  for (const info of infos) {
    const c = contextOf(info);
    contexts.set(`${c.suffix}|${c.pseudo ?? ""}`, c);
  }
  const bySibling = new Map<string, postcss.Declaration>();
  for (const d of decls) bySibling.set(baseProp(d.prop), d);
  const folds = foldsOf(decls, fc);
  const parts: string[] = [];
  const hints: string[] = [];
  const attrs: string[] = [];
  const unmapped = new Set<string>();
  const missing = new Map<string, Set<string>>();
  const hint = (text: string) => {
    if (!hints.includes(text)) hints.push(text);
  };
  for (const ctx of contexts.values()) {
    const out = newTranslation();
    for (const d of decls) if (!folds.skip.has(d)) translateDecl(d, bySibling, ctx, m, fc, out);
    const tier = ctx.suffix ? null : m.tier;
    if (folds.textGrad) {
      // --text-grad has no state of its own: it sits at the base, and the colour decides when the fill shows.
      out.props.set("--text-grad", `--text-grad:${folds.textGrad.gradient}`);
      if (folds.textGrad.transparent) {
        const c = pickProp(fc.kit, "color", ctx.suffix, tier);
        if (c) out.props.set(c.name, `${c.name}:transparent`);
      }
      out.hints.push(ctx.suffix ? "--text-grad sits at the base; the colour state shows or hides it" : "--text-grad leaves the colour alone; --c:transparent shows the fill");
    }
    if (folds.clamp) {
      out.props.set("--line-clamp", `--line-clamp:${folds.clamp}`);
      out.hints.push("--line-clamp replaces the overflow and ellipsis declarations and sets display itself");
    }
    if (ctx.suffix && m.tier) out.hints.push(`inside min-width:${fc.kit.manifest.breakpoints[m.tier]}px too: the kit has no tier-and-state names, so the tier is dropped`);
    for (const u of out.unmapped) unmapped.add(u);
    for (const h of [...out.hints, ...ctx.notes]) hint(h);
    for (const a of out.attrs) if (!attrs.includes(a)) attrs.push(a);
    for (const [label, names] of out.missing) {
      const set = missing.get(label) ?? new Set<string>();
      for (const n of names) set.add(n);
      missing.set(label, set);
    }
    const list = [...out.props.values()];
    if (list.length) parts.push(ctx.pseudo ? `markup for ${ctx.pseudo}: <i style="${list.join("; ")}">` : list.join("; "));
  }
  for (const [label, names] of missing) hint(`no ${label} for ${[...names].join(", ")}; set ${names.size === 1 ? "it" : "them"} at the base`);
  for (const u of unmapped) add("G", `no kit prop for ${u}`);

  // Hints that name the kit feature.
  const has = (bucket: Bucket, why: RegExp) => needs.some((n) => n.bucket === bucket && why.test(n.why));
  if (has("E", /^coloured shadow/)) hint(`coloured shadow: ${hasProp(fc.kit, "--glow") ? "--glow:N with --glow-c:<colour>, or " : ""}--boxs with a token colour`);
  if (has("E", /^backdrop-filter/) && !hasProp(fc.kit, "--bdf")) hint("the kit has no --bdf");
  if (has("E", /^gradient/) && !folds.textGrad) hint("gradient: --bg or --bgi take it as a value; give the stops tokens");
  if (has("E", /^color-mix/)) hint("color-mix: --tone:N (a tint of --tone-of into --background) or --mix:RGB");
  if (has("F", /^(?:env\(\)|dynamic viewport unit)/)) hint("env() and dvh work as values in the prop");
  const relational = [...new Set(infos.flatMap((i) => i.relational))].filter((r) => !r.startsWith("pseudo-element"));
  if (relational.length) hint(`needs markup or a restructure: ${relational.join(", ")}`);
  const keys = [...new Set(infos.flatMap((i) => i.variants.map(attrText)))];

  if (m.reducedMotion && decls.length && decls.every((d) => /^(?:transition|animation)(?:-|$)/.test(baseProp(d.prop)))) {
    const slows = decls.some((d) => !/^none$/i.test(cleanValue(d.value)));
    parts.length = 0;
    hints.length = 0;
    hint(`redundant: the kit zeroes --anim, --tn, --tdn and --tp under prefers-reduced-motion${slows ? ", where this rule only slows them" : ""}; delete this rule`);
  }
  if (m.tierNote) hint(m.tierNote);

  const bucket = bucketOf(needs);
  if (keys.length && bucket !== "A-var" && PRECEDENCE.indexOf(bucket) < PRECEDENCE.indexOf("A-var")) hint(`only where ${keys.join(" | ")}: a template macro emits it`);
  fc.report.rules.push({
    bucket,
    selector: selectorText,
    file: fc.file,
    line,
    source: b.source,
    block: b.label,
    media: [...chain].reverse().map((a) => `@${a.name} ${a.params}`.trim()),
    needs: needs.map((n) => `${n.bucket}: ${n.why}`),
    suggestion: compose(bucket, needs, parts, attrs, hints, keys),
  });
}

function compose(bucket: Bucket, needs: Need[], parts: string[], attrs: string[], hints: string[], keys: string[]): string {
  const segments: string[] = [];
  const props = parts.join("; ");
  if (bucket === "A-var") segments.push(`macro on ${keys.join(" | ")} emits ${props || "(nothing mapped)"}`);
  else if (bucket === "G") {
    segments.push("behaviour script: set attributes and inline geometry");
    const why = needs.filter((n) => n.bucket === "G").map((n) => n.why);
    if (why.length) segments.push(why.join(", "));
    if (props) segments.push(`mappable part: ${props}`);
  } else if (props) segments.push(props);
  if (attrs.length) segments.push(`attrs: ${attrs.join(" ")}`);
  let text = segments.join("; ");
  if (bucket === "C" && !props && !hints.length) text = "needs markup or a restructure";
  if (hints.length) text += `${text ? "  " : ""}(${hints.join("; ")})`;
  return text || "(empty rule)";
}

// ------------------------------------------------------------ at-rules ---

function analyzeAtRule(at: postcss.AtRule, b: BlockCtx, fc: FileCtx) {
  const name = at.name.toLowerCase();
  const line = lineIn(b, at);
  if (name === "import") {
    for (const url of [...urlsIn(at.params), ...[...at.params.matchAll(/^\s*(["'])(.*?)\1/g)].map((m) => m[2])]) {
      if (offOrigin(url)) addFlag(fc, b, { kind: "off-origin", line, detail: `@import ${url}`, suggestion: "self-host the stylesheet or drop it; the kit makes no request off its own origin" });
    }
    return;
  }
  if (name === "media") {
    const ctx = mediaContext([at], fc.kit);
    if (ctx.maxWidth !== null) {
      const wide = wideSide(ctx.maxWidth, fc.kit);
      addFlag(fc, b, {
        kind: "max-width-media",
        line,
        detail: `@media ${at.params}`,
        suggestion: ctx.tier
          ? `a range: write the values with the -${ctx.tier} tier for where it starts, and reset them with ${wide} where it ends`
          : `rewrite mobile-first: write the values inside this block at the base (they are the phone values), and move the other rule's values to ${wide}`,
      });
    }
    return;
  }
  if (name === "keyframes" || name === "-webkit-keyframes") {
    if (name.startsWith("-")) return;
    const shape = keyframeShape(at);
    const hint = shape ? `${at.params} reads as ${shape}: --anim:${shape} var(--dur-3) var(--ease-out) both` : `${at.params}: no kit keyframes match; keep it in a stylesheet, or pick the closest of st-fade, st-rise, st-slide-in, st-pop`;
    fc.report.rules.push({
      bucket: "D",
      selector: `@keyframes ${at.params}`,
      file: fc.file,
      line,
      source: b.source,
      block: b.label,
      media: [],
      needs: ["D: @keyframes"],
      suggestion: hint,
    });
    return;
  }
  if (name === "font-face" || name === "property" || name === "page" || name === "counter-style" || name === "font-feature-values") {
    let hasDecl = false;
    at.walkDecls((d) => {
      hasDecl = true;
      for (const url of urlsIn(d.value)) {
        if (offOrigin(url)) addFlag(fc, b, { kind: "off-origin", line: lineIn(b, d), detail: `@${name} ${d.prop}: url(${url})`, suggestion: "self-host the font or use --font-sans and --font-mono" });
      }
    });
    if (hasDecl) {
      fc.report.rules.push({
        bucket: "G",
        selector: `@${name} ${at.params}`.trim(),
        file: fc.file,
        line,
        source: b.source,
        block: b.label,
        media: [],
        needs: [`G: @${name}`],
        suggestion: name === "font-face" ? "behaviour script: not a prop; self-host the face, or use --font-sans and --font-mono" : `behaviour script: set attributes and inline geometry; @${name} has no kit answer`,
      });
    }
  }
}

function harvestDefs(root: postcss.Root, defs: Map<string, string>) {
  root.walkRules((rule) => {
    if (!rule.selectors.every((s) => GLOBAL_SCOPE.test(s.trim()))) return;
    rule.each((n) => {
      if (n.type === "decl" && n.prop.startsWith("--")) defs.set(n.prop, squash(n.value));
    });
  });
}

function needsUnwrapping(root: postcss.Root): boolean {
  let nested = false;
  root.walkRules((rule) => {
    rule.each((n) => {
      if (n.type === "rule" || (n.type === "atrule" && n.nodes && n.nodes.length && !/^(?:font-face|page)$/i.test(n.name))) nested = true;
    });
  });
  return nested;
}

// ----------------------------------------------------------------- lint ---

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

function didYouMean(kit: Kit, name: string): string[] {
  const stem = name.replace(/^--/, "").toLowerCase();
  // names are case-sensitive: --BG is not --bg, but --bg is what was meant
  if (stem !== name.replace(/^--/, "") && resolveName(kit.manifest, `--${stem}`)) return [`--${stem}`];
  const guesses = new Set<string>();
  const longForms = [stem, stem.replace(/-w$/, "-width").replace(/-h$/, "-height"), stem.replace(/^bg-?/, "background-"), stem.replace(/^bg-?/, "background-").replace(/-?color$/, "-color")];
  for (const g of longForms) for (const n of kit.byProperty.get(g) ?? []) if (!kit.manifest.props[n].deprecated) guesses.add(n);
  if (guesses.size) return [...guesses].slice(0, 2);
  const limit = Math.min(2, Math.max(1, Math.floor(stem.length / 3)));
  const scored = kit.names
    .map((n) => [n, levenshtein(stem, n.replace(/^--/, ""))] as const)
    .filter(([, d]) => d <= limit)
    .sort((a, b) => a[1] - b[1] || a[0].length - b[0].length);
  return scored.slice(0, 2).map(([n]) => n);
}

function tierStateOf(kit: Kit, name: string): { state: string; tier: string; base: string } | null {
  for (const tier of TIERS) {
    if (!name.endsWith(`-${tier}`)) continue;
    const r = resolveName(kit.manifest, name.slice(0, -(tier.length + 1)));
    if (r?.state) return { state: r.state, tier, base: r.base };
  }
  for (const state of [...STATES].sort((a, b) => b.length - a.length)) {
    if (!name.endsWith(`-${state}`)) continue;
    const r = resolveName(kit.manifest, name.slice(0, -(state.length + 1)));
    if (r?.tier) return { state, tier: r.tier, base: r.base };
  }
  return null;
}

interface LintCtx {
  kit: Kit;
  /** Names a var(), a CSS definition, a script or the kit's own tokens give meaning to. */
  pageVars: Set<string>;
  file: string;
  lineOf: (offset: number) => number;
}

function lintDecl(d: InlineDecl, origin: "code" | "page", lc: LintCtx): LintFinding[] {
  const line = lc.lineOf(d.start);
  const base = { origin, name: d.name, value: d.value, file: lc.file, line };
  const kit = lc.kit;
  if (!d.name.startsWith("--")) {
    if (d.name.startsWith("-")) return [];
    const p = pickProp(kit, d.name.toLowerCase(), "", null);
    if (!p) return [];
    return [{ ...base, kind: "plain", severity: "note", message: "plain property in a style attribute; the kit has a prop for it", suggestion: p.notes.length ? `${p.base} (${p.notes[0]})` : p.base }];
  }
  if (d.rawName !== d.name && /\s$/.test(d.rawName)) {
    return [{ ...base, kind: "unknown", severity: "error", message: `a space before the colon: the kit selects on "${d.name}:" exactly, so "${d.rawName.trimStart()}:" matches nothing`, suggestion: `${d.name}:` }];
  }
  const found = resolveName(kit.manifest, d.name);
  if (found) {
    const entry: PropEntry = kit.manifest.props[found.base];
    const out: LintFinding[] = [];
    if (entry.deprecated) out.push({ ...base, kind: "deprecated", severity: "warn", message: "deprecated", suggestion: entry.deprecated });
    if (entry.collision) {
      // A safer prop sets one of the properties and nothing else.
      const saferFor = (prop: string) => (kit.byProperty.get(prop) ?? []).filter((n) => !kit.manifest.props[n].collision && !kit.manifest.props[n].deprecated);
      const named = entry.collision.filter((prop) => saferFor(prop).length).map((prop) => `${prop}: ${saferFor(prop).join(" or ")}`);
      out.push({
        ...base,
        kind: "collision",
        severity: "warn",
        message: `sets ${entry.collision.join(" and ")}`,
        suggestion: named.length ? `${named.join("; ")}${named.length < entry.collision.length ? "; the rest wait for 2.0" : ""}` : "no safer prop yet; the renames wait for 2.0",
      });
      // The Sage.is case: --fs:0.875rem. Neither flex-shrink nor font-style takes a length, so nothing happens.
      if (found.base === "--fs" && /^[+-]?(?:\d+\.?\d*|\.\d+)[a-z%]+$/i.test(d.value)) {
        out.push({ ...base, kind: "collision", severity: "error", message: "a length: flex-shrink takes a number and font-style a keyword, so nothing happens", suggestion: kit.byProperty.get("font-size")?.[0] });
      }
    }
    return out;
  }
  const combo = tierStateOf(kit, d.name);
  if (combo) {
    return [
      {
        ...base,
        kind: "tier-state",
        severity: "warn",
        message: `combines the ${combo.state} state with the ${combo.tier} tier; the kit has one suffix per name`,
        suggestion: `${combo.base}-${combo.state} (all widths) or ${combo.base}-${combo.tier} (${combo.tier} and up)`,
      },
    ];
  }
  if (lc.pageVars.has(d.name) || hasToken(kit, d.name) || kit.reads.has(d.name)) return [];
  // A real prop with a suffix it does not offer.
  for (const suffix of [...TIERS, ...STATES]) {
    if (!d.name.endsWith(`-${suffix}`)) continue;
    const stem = d.name.slice(0, -(suffix.length + 1));
    if (Object.hasOwn(kit.manifest.props, stem)) {
      const e = kit.manifest.props[stem];
      const offered = [...e.tiers, ...e.states];
      return [{ ...base, kind: "unknown", severity: "error", message: `${stem} has no -${suffix}, so this is a silent no-op${offered.length ? ` (it has: ${offered.join(", ")})` : " (it has no suffixes)"}`, suggestion: stem }];
    }
  }
  const guesses = didYouMean(kit, d.name);
  return [{ ...base, kind: "unknown", severity: "error", message: "not in the kit, so a silent no-op", suggestion: guesses.length ? guesses.join(" or ") : undefined }];
}

// ---------------------------------------------------------------- ingest ---

export function ingest(file: string, text: string, kit: Kit): Report {
  const report: Report = {
    version: 1,
    input: file,
    kit: { props: Object.keys(kit.manifest.props).length, tokens: Object.keys(kit.manifest.tokens).length, source: kit.source },
    summary: {
      rules: 0,
      buckets: emptyCounts(),
      bySource: { style: emptyCounts(), code: emptyCounts(), css: emptyCounts() },
      tokenBlocks: 0,
      inlineProps: 0,
      flags: Object.fromEntries(FLAG_KINDS.map((k) => [k, 0])) as Record<FlagKind, number>,
      lint: Object.fromEntries(LINT_KINDS.map((k) => [k, 0])) as Record<LintKind, number>,
      blocks: { style: 0, css: 0, template: 0, script: 0 },
    },
    rules: [],
    tokens: [],
    flags: [],
    lint: [],
    warnings: [],
  };
  const lineOf = lineIndex(text);
  const isCssFile = /\.css$/i.test(file);
  const fc: FileCtx = { file, kit, defs: new Map(), keyframes: new Map(), report };

  interface CssBlock {
    ctx: BlockCtx;
    root: postcss.Root;
  }
  const cssBlocks: CssBlock[] = [];
  const segments: { start: number; end: number; origin: "page" | "code" | "script" }[] = [];
  const parse = (css: string, ctx: BlockCtx, strict: boolean) => {
    try {
      let root = postcss.parse(css, { from: ctx.label });
      if (needsUnwrapping(root)) {
        try {
          root = postcss([postcssNested()]).process(root, { from: ctx.label }).root;
        } catch (e) {
          report.warnings.push(`${ctx.label}: could not unwrap nested rules (${(e as Error).message}); nested rules are read as written`);
        }
      }
      cssBlocks.push({ ctx, root });
      return true;
    } catch (e) {
      const err = e as postcss.CssSyntaxError;
      const where = at(file, ctx.line0 + ((err.line ?? 1) - 1));
      if (strict) throw new Error(`${where}: ${err.reason ?? err.message}`);
      report.warnings.push(`${where}: this ${ctx.source === "style" ? "<style>" : "CSS"} block does not parse (${err.reason ?? err.message}) and was skipped`);
      return false;
    }
  };

  if (isCssFile) {
    report.summary.blocks.css = 1;
    parse(text, { source: "css", label: file, line0: 1 }, true);
  } else {
    const blocks = scanBlocks(text);
    let styleN = 0;
    let pos = 0;
    for (const block of blocks) {
      segments.push({ start: pos, end: block.start, origin: "page" });
      pos = block.end;
      const line0 = lineOf(block.start);
      if (block.kind === "style") {
        report.summary.blocks.style++;
        parse(block.text, { source: "style", label: `style#${++styleN}`, line0 }, false);
        continue;
      }
      if (block.kind === "script") {
        report.summary.blocks.script++;
        segments.push({ start: block.start, end: block.end, origin: "script" });
        continue;
      }
      if (block.kind === "data") continue;
      const label = block.id ? `${block.id}${block.name ? ` (${block.name})` : ""}` : block.name || block.path || `code@${line0}`;
      let kind = codeKind(block);
      if (kind === "unknown") kind = looksLikeCss(block.text) ? "css" : "template";
      if (kind === "css") {
        report.summary.blocks.css++;
        parse(block.text, { source: "code", label, line0 }, false);
      } else if (kind === "template" || kind === "script") {
        report.summary.blocks.template++;
        segments.push({ start: block.start, end: block.end, origin: "code" });
      }
    }
    segments.push({ start: pos, end: text.length, origin: "page" });
  }

  // Pass 1: tokens, keyframes and every name a var() reads.
  const varRefs = new Set<string>();
  for (const { root } of cssBlocks) {
    harvestDefs(root, fc.defs);
    root.walkAtRules(/keyframes$/i, (kf) => {
      if (kf.name.startsWith("-")) return;
      const shape = keyframeShape(kf);
      if (shape) fc.keyframes.set(kf.params, shape);
    });
    root.walkDecls((d) => {
      for (const m of d.value.matchAll(/var\(\s*(--[\w-]+)/g)) varRefs.add(m[1]);
      if (d.prop.startsWith("--")) varRefs.add(d.prop);
    });
  }

  // Pass 2: rules, at-rules and flags, in the order the file holds them.
  for (const { ctx, root } of cssBlocks) {
    root.walk((node) => {
      if (node.type === "rule") analyzeRule(node, ctx, fc);
      else if (node.type === "atrule") analyzeAtRule(node, ctx, fc);
    });
  }

  // Inline props: style attributes everywhere, and --name: in the template text of code blocks.
  if (!isCssFile) {
    const seen = new Map<number, { decl: InlineDecl; origin: "code" | "page" }>();
    const quiet = maskComments(text);
    for (const seg of segments) {
      if (seg.end <= seg.start) continue;
      const slice = (seg.origin === "script" ? text : quiet).slice(seg.start, seg.end);
      const origin = seg.origin === "code" ? "code" : "page";
      for (const attr of findStyleAttrs(slice, seg.start)) {
        for (const decl of parseInlineDecls(attr.value, attr.start)) {
          seen.set(decl.start, { decl, origin });
          for (const m of decl.value.matchAll(/var\(\s*(--[\w-]+)/g)) varRefs.add(m[1]);
        }
      }
      if (seg.origin === "code") for (const decl of findPropUses(slice, seg.start)) if (!seen.has(decl.start)) seen.set(decl.start, { decl, origin: "code" });
      if (seg.origin !== "script") {
        for (const link of findLinks(slice, seg.start)) {
          if (!offOrigin(link.href) || !(FETCHING_REL.test(link.rel) || link.as === "font")) continue;
          report.flags.push({
            kind: "off-origin",
            file,
            line: lineOf(link.start),
            source: seg.origin === "code" ? "code" : "page",
            block: "<link>",
            detail: `<link rel="${link.rel}" href="${link.href}">`,
            suggestion: "self-host the stylesheet or font, or use the kit's font faces; the kit makes no request off its own origin",
          });
        }
      }
    }
    const jsVars = new Set<string>();
    for (const m of text.matchAll(/(?:setProperty|getPropertyValue|removeProperty)\(\s*["'](--[\w-]+)["']/g)) jsVars.add(m[1]);
    const pageVars = new Set<string>([...varRefs, ...jsVars]);
    const lc: LintCtx = { kit, pageVars, file, lineOf };
    for (const { decl, origin } of [...seen.values()].sort((a, b) => a.decl.start - b.decl.start)) {
      if (decl.name.startsWith("--")) report.summary.inlineProps++;
      for (const finding of lintDecl(decl, origin, lc)) report.lint.push(finding);
    }
  }

  // Order, then count.
  const byLine = <T extends { line: number }>(a: T, b: T) => a.line - b.line;
  report.rules.sort(byLine);
  report.flags.sort(byLine);
  report.tokens.sort(byLine);
  report.lint.sort(byLine);
  for (const rule of report.rules) {
    report.summary.rules++;
    report.summary.buckets[rule.bucket]++;
    report.summary.bySource[rule.source][rule.bucket]++;
  }
  report.summary.tokenBlocks = report.tokens.length;
  for (const f of report.flags) report.summary.flags[f.kind]++;
  for (const l of report.lint) report.summary.lint[l.kind]++;
  return report;
}

// --------------------------------------------------------------- output ---

const FLAG_LABEL: Record<FlagKind, string> = {
  "max-width-media": "max-width media",
  "off-origin": "off-origin",
  "color-literal": "colour literal",
  "font-literal": "font-family literal",
  "class-selector": "class selector",
  important: "!important",
};
const LINT_LABEL: Record<LintKind, string> = { unknown: "unknown", deprecated: "deprecated", collision: "collision", "tier-state": "tier+state", plain: "plain property" };

const short = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

export function formatText(r: Report): string {
  const out: string[] = [];
  const s = r.summary;
  const plural = (n: number, word: string) => `${n} ${n === 1 ? word : word.endsWith("y") ? `${word.slice(0, -1)}ies` : `${word}s`}`;
  const isFile = /\.css$/i.test(r.input);
  out.push(`ingest ${r.input}`);
  out.push(`kit    ${r.kit.props} props, ${r.kit.tokens} tokens (${r.kit.source})`);
  out.push(
    isFile
      ? "input  1 CSS file"
      : `input  ${plural(s.blocks.style, "<style> block")}, ${plural(s.blocks.css, "CSS code block")}, ${plural(s.blocks.template, "template block")}, ${plural(s.blocks.script, "script")}`,
  );
  for (const w of r.warnings) out.push(`warning ${w}`);
  out.push("");
  out.push(`RULES ${s.rules}${s.tokenBlocks ? `  (${plural(s.tokenBlocks, "token block")} not counted)` : ""}`);
  const sources = (["code", "style", "css"] as RuleSource[]).filter((k) => Object.values(s.bySource[k]).some((n) => n > 0));
  out.push(`  ${"bucket".padEnd(6)} ${"all".padStart(5)}${sources.map((k) => k.padStart(7)).join("")}`);
  for (const b of BUCKETS) {
    out.push(`  ${b.padEnd(6)} ${String(s.buckets[b]).padStart(5)}${sources.map((k) => String(s.bySource[k][b]).padStart(7)).join("")}`);
  }
  out.push("FLAGS");
  for (const k of FLAG_KINDS) out.push(`  ${FLAG_LABEL[k].padEnd(20)} ${String(s.flags[k]).padStart(4)}`);
  out.push("LINT (inline props)");
  for (const k of LINT_KINDS) out.push(`  ${LINT_LABEL[k].padEnd(20)} ${String(s.lint[k]).padStart(4)}`);
  out.push(`  ${"props checked".padEnd(20)} ${String(s.inlineProps).padStart(4)}`);

  out.push("");
  out.push("RULES (bucket, selector, file:line, suggestion)");
  for (const rule of r.rules) {
    const ctx = rule.media.length ? `${rule.media.join(" | ")}  ` : "";
    out.push(`${rule.bucket.padEnd(5)}  ${ctx}${short(rule.selector, 110)}  ${at(rule.file, rule.line)}  ${rule.suggestion}`);
  }
  if (r.tokens.length) {
    out.push("");
    out.push("TOKEN BLOCKS (not counted)");
    for (const t of r.tokens) out.push(`  ${short(t.selector, 60)}  ${at(t.file, t.line)}  ${plural(t.names.length, "custom property")}: ${short(t.names.join(" "), 100)}`);
  }
  if (r.flags.length) {
    out.push("");
    out.push("FLAGS (kind, file:line, detail; the fix prints when it changes)");
    const lastFix = new Map<FlagKind, string>();
    for (const f of r.flags) {
      const fix = lastFix.get(f.kind) === f.suggestion ? "" : `  -> ${f.suggestion}`;
      lastFix.set(f.kind, f.suggestion);
      out.push(`${f.kind.padEnd(15)}  ${at(f.file, f.line)}  ${short(f.detail, 120)}${fix}`);
    }
  }
  if (r.lint.length) {
    out.push("");
    out.push("LINT (kind, severity, file:line, origin, name, message)");
    for (const l of r.lint) {
      out.push(`${l.kind.padEnd(10)} ${l.severity.padEnd(5)}  ${at(l.file, l.line)}  ${l.origin}  ${l.name}  ${l.message}${l.suggestion ? `  -> ${l.suggestion}` : ""}`);
    }
  }
  return out.join("\n");
}

// ------------------------------------------------------------------ cli ---

function emit(text: string) {
  const buf = Buffer.from(text.endsWith("\n") ? text : `${text}\n`);
  let off = 0;
  while (off < buf.length) {
    try {
      off += writeSync(1, buf, off, buf.length - off);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "EPIPE") return; // the reader closed the pipe (| head)
      if (code !== "EAGAIN") throw e;
      Bun.sleepSync(2);
    }
  }
}

/** Build C into a temp dir of its own and read the props.json it writes. Never touches dist/. */
export function manifestFromBuild(root: string): { manifest: Manifest } | { error: string } {
  const dir = mkdtempSync(join(tmpdir(), "startr-ingest-"));
  try {
    const build = Bun.spawnSync([process.execPath, "run", "build"], { cwd: root, env: { ...process.env, STARTR_DIST: dir }, stdout: "pipe", stderr: "pipe" });
    if (build.exitCode !== 0) {
      return {
        error: [
          "C failed to build, so there is no props.json to read.",
          build.stderr.toString().trim().split("\n").slice(-12).join("\n"),
          "If the failing file is not yours, another stream may be mid-edit. Retry in a minute, or pass --manifest.",
        ].join("\n"),
      };
    }
    const file = join(dir, "props.json");
    if (!existsSync(file)) return { error: "The build wrote no props.json." };
    return { manifest: JSON.parse(readFileSync(file, "utf8")) as Manifest };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function main(argv: string[]): Promise<number> {
  const root = resolve(import.meta.dir, "..");
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { json: { type: "boolean", default: false }, manifest: { type: "string" }, help: { type: "boolean", short: "h", default: false } },
    });
  } catch (e) {
    console.error(`${(e as Error).message}\nusage: bun run ingest <file.html|file.css> [--json] [--manifest <props.json>]`);
    return 2;
  }
  if (parsed.values.help) {
    const lines = readFileSync(import.meta.path, "utf8").split("\n");
    emit(lines.slice(0, lines.findIndex((l) => l.startsWith("import "))).join("\n"));
    return 0;
  }
  if (parsed.positionals.length !== 1) {
    console.error("usage: bun run ingest <file.html|file.css> [--json] [--manifest <props.json>]");
    return 2;
  }
  const input = parsed.positionals[0];
  if (!existsSync(input)) {
    console.error(`not found: ${input}`);
    return 2;
  }
  let manifest: Manifest;
  let source: string;
  const manifestPath = parsed.values.manifest as string | undefined;
  if (manifestPath) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
    } catch (e) {
      console.error(`cannot read the manifest ${manifestPath}: ${(e as Error).message}`);
      return 2;
    }
    if (!manifest || typeof manifest.props !== "object" || typeof manifest.tokens !== "object") {
      console.error(`${manifestPath} is not a props.json (it needs "props" and "tokens")`);
      return 2;
    }
    source = manifestPath;
  } else {
    const built = manifestFromBuild(root);
    if ("error" in built) {
      console.error(built.error);
      return 2;
    }
    manifest = built.manifest;
    source = "built from this checkout";
  }
  let text: string;
  try {
    text = readFileSync(input, "utf8");
  } catch (e) {
    console.error(`cannot read ${input}: ${(e as Error).message}`);
    return 2;
  }
  let report: Report;
  try {
    report = ingest(input, text, loadKit(manifest, source));
  } catch (e) {
    console.error(`CSS parse error: ${(e as Error).message}`);
    return 2;
  }
  emit(parsed.values.json ? JSON.stringify(report, null, 2) : formatText(report));
  return 0;
}

if (import.meta.main) {
  // exitCode, not exit(): a large report written to a pipe must drain first
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(e instanceof Error ? e.stack : e);
      process.exitCode = 2;
    },
  );
}
