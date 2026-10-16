/**
 * The startr.style prop manifest.
 *
 * buildManifest(css) takes the final, unminified startr.css and returns the dictionary of inline props that build.ts writes as props.json. Everything comes from the built sheet. Every [style*="--X:"] selector yields a name, and the rules around it say what the name does. No source file is read, so the manifest cannot drift from what ships.
 *
 * Schema (version 1). props and tokens are sorted by name. Entry keys keep the order shown. Arrays are sorted or in canonical order. The same sheet always gives the same bytes.
 *
 *   {
 *     "version": 1,                        schema version; bumps only on a breaking change, so readers ignore keys they do not know
 *     "generated_from": {
 *       "file": "startr.css",              the sheet this describes
 *       "sha256": "<hex>"                  hash of that sheet's exact text
 *     },
 *     "breakpoints": { "xs": 440, "sm": 640, "md": 768, "lg": 1024, "xl": 1280 },   min-width in px, read from the @media blocks; "pt" is @media print
 *     "props": {
 *       "--bg": {
 *         "properties": ["background"],    what the name sets, sorted; a name starting with -- is a custom-property output (--mix writes --mixed), and private --_ outputs are left out
 *         "kind": "prop",                  "prop": every declaration passes the value straight through as var(--X) or var(--X, fallback); "helper": anything else
 *         "tiers": ["sm", "md"],           suffix tiers with a rule, in the order xs sm md lg xl pt
 *         "states": ["hover", "focus"],    suffix states with a rule, in the order hover focus active on in-on in-hover
 *         "requires_suffix": true,         optional; the bare name has no rule, only its suffixed forms do (--col needs --col-sm and friends)
 *         "reads": ["--tone-of"],          optional; other custom properties its rules read that are neither props nor tokens (private --_ names are skipped): a helper's extra inputs
 *         "collision": ["border-radius", "border-right"],   optional; one name feeds different properties from separate rules
 *         "deprecated": "--bg-hover"       optional; set on the old name, it holds the replacement
 *       }
 *     },
 *     "tokens": { "--primary": { "type": "color" } },     custom properties declared on :root; type is color, length, number or other; names starting with --_ are private and left out
 *     "warnings": []                       things the generator saw in the sheet: invalid-name, breakpoint-conflict, empty-rule, combo-name
 *   }
 *
 * Subject. Only the element a rule styles counts: the last compound of the selector, outside any :is(), :not() or :has(). The reduced-motion rule lists every animated prop inside one :is(); those names are conditions there, not definitions.
 *
 * Names. A style attribute name is either a key of props or a key plus one suffix: "--p-md" is "--p" with tier md, "--c-in-on" is "--c" with state in-on. resolveName() does the lookup and allNames() lists every spelling. A tier comes from the @media block around the rule: a name ending in -sm counts as a tier only inside a min-width query, and -pt only inside @media print. A state comes from the suffix, and only when the name without it is itself a prop. So "--maxw-sm" at the top level is its own prop, and a "--button-hover" with no "--button" is its own prop too.
 *
 * kind. A name is a "helper" when any of its declarations is not a straight pass-through: calc() and gradients, a value built from another token (transition: var(--transition)), a literal, or a custom-property output. A name that feeds several properties from one rule (--px sets both inline paddings) is still a "prop" if every value is var(--X).
 *
 * collision. Take each rule where the name is the subject and collect the properties it passes straight through. Two rules whose sets are neither equal nor nested make a collision, and the field lists every property involved. One rule with many properties (--inset) is not a collision, and neither is the same property in two rules.
 *
 * deprecated. An explicit table (DEPRECATED below), applied to names that exist in the sheet. The replacement may not exist yet; check it with resolveName().
 *
 * tokens. A var() takes the type of the token it points at, a calc(), min(), max() or clamp() is a length if any part is a length, and a bare number is a number. Anything else, such as a shadow, a font stack, a time or a gradient, is "other".
 */
import postcss from "postcss";
import { createHash } from "node:crypto";

export const SCHEMA_VERSION = 1;

/** Width tiers come from min-width queries, pt from @media print. Canonical order. */
export const TIERS = ["xs", "sm", "md", "lg", "xl", "pt"] as const;
/** Suffix states, in canonical order. Adding a state to the kit means adding it here. */
export const STATES = ["hover", "focus", "active", "on", "in-on", "in-hover"] as const;

export type Tier = (typeof TIERS)[number];
export type State = (typeof STATES)[number];
export type Kind = "prop" | "helper";
export type TokenType = "color" | "length" | "number" | "other";

export interface PropEntry {
  properties: string[];
  kind: Kind;
  tiers: Tier[];
  states: State[];
  requires_suffix?: true;
  reads?: string[];
  collision?: string[];
  deprecated?: string;
}

export interface Manifest {
  version: typeof SCHEMA_VERSION;
  generated_from: { file: string; sha256: string };
  breakpoints: Partial<Record<Tier, number>>;
  props: Record<string, PropEntry>;
  tokens: Record<string, { type: TokenType }>;
  warnings: string[];
}

/** Old name to its replacement. The old grammar was --hvr-X and --X-hvr; the new one is the --X-hover suffix. */
export const DEPRECATED: Readonly<Record<string, string>> = {
  "--hvr-bg": "--bg-hover",
  "--hvr-bgc": "--bgc-hover",
  "--hvr-b": "--b-hover",
  "--hvr-bc": "--bc-hover",
  "--hvr-c": "--c-hover",
  "--shadow-hvr": "--shadow-hover",
  "--levitate-hvr": "--levitate-hover",
  "--translate-hvr": "--translate-hover",
  "--translatex-hvr": "--translatex-hover",
  "--translatey-hvr": "--translatey-hover",
  "--scale-hvr": "--scale-hover",
  "--rotate-hvr": "--rotate-hover",
  "--skew-hvr": "--skew-hover",
};

const VALID_NAME = /^--[\w-]+$/;
const WIDTH_SUFFIX = /-(xs|sm|md|lg|xl)$/;
const VENDOR_PREFIX = /^-(?:webkit|moz|o|ms)-(.+)$/;
const NAME_ATTR = /\[\s*style\s*\*=\s*(["'])(.*?)\1\s*\]/y;
/** The longer suffixes come first, so "--c-in-on" is not read as "--c-in" plus "-on". */
const STATE_SUFFIXES = [...STATES].sort((a, b) => b.length - a.length);

interface Feed {
  prop: string;
  direct: boolean;
}

interface Hit {
  name: string;
  rule: number;
  media: string[];
  feeds: Feed[];
  reads: string[];
}

type TierContext = { kind: "print" } | { kind: "width"; px: number } | null;

interface Accumulator {
  properties: Set<string>;
  direct: boolean;
  feeds: number;
  tiers: Set<Tier>;
  states: Set<State>;
  bare: boolean;
  reads: Set<string>;
  /** full name, then rule index, then the properties passed straight through */
  passes: Map<string, Map<number, Set<string>>>;
}

export function buildManifest(css: string, opts: { file?: string } = {}): Manifest {
  const root = postcss.parse(css);
  const hits: Hit[] = [];
  const rootDecls = new Map<string, { value: string; top: boolean }>();
  let ruleCount = 0;

  root.walkRules((rule) => {
    const around = atRulesAround(rule);
    const media = around.filter((at) => at.name.toLowerCase() === "media").map((at) => at.params);
    const index = ruleCount++;
    const decls: postcss.Declaration[] = [];
    rule.each((node) => {
      if (node.type === "decl") decls.push(node);
    });

    const names = new Set<string>();
    for (const selector of rule.selectors) for (const name of subjectNames(selector)) names.add(name);
    const reads = [...new Set(decls.flatMap((decl) => [...decl.value.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1])))];
    for (const name of names) hits.push({ name, rule: index, media, feeds: feedsOf(name, decls), reads });

    if (rule.selectors.some(isRootScope)) {
      // The first declaration outside any at-rule gives the token its type; a dark-mode override inside @media never does.
      const top = around.length === 0;
      for (const decl of decls) {
        if (!decl.prop.startsWith("--") || decl.prop.startsWith("--_")) continue;
        const seen = rootDecls.get(decl.prop);
        if (!seen || (top && !seen.top)) rootDecls.set(decl.prop, { value: decl.value, top });
      }
    }
  });

  const warnings = new Set<string>();

  // Phase A: a rule inside a width or print query that carries the matching suffix is a tier of the stem.
  const widthsSeen = new Map<Tier, Map<number, number>>();
  const folded = hits.map((hit) => {
    const { stem, tier, px } = foldTier(hit.name, tierContext(hit.media));
    if (tier && px !== undefined) {
      const seen = widthsSeen.get(tier) ?? new Map<number, number>();
      seen.set(px, (seen.get(px) ?? 0) + 1);
      widthsSeen.set(tier, seen);
    }
    return { hit, stem, tier };
  });

  const stems = new Set<string>();
  for (const { stem } of folded) {
    if (VALID_NAME.test(stem)) stems.add(stem);
    else warnings.add(`invalid-name: ${stem} (a style selector must name a custom property that starts with --)`);
  }

  // Phase B: a stem that ends in a state suffix, on top of a stem that exists, is a state of that base.
  const accumulators = new Map<string, Accumulator>();
  for (const { hit, stem, tier } of folded) {
    if (!VALID_NAME.test(stem)) continue;
    let base = stem;
    let state: State | null = null;
    for (const suffix of STATE_SUFFIXES) {
      const candidate = stem.slice(0, -(suffix.length + 1));
      if (stem.endsWith(`-${suffix}`) && candidate.length >= 3 && stems.has(candidate)) {
        base = candidate;
        state = suffix;
        break;
      }
    }
    if (tier && state) {
      warnings.add(`combo-name: ${hit.name} is ${base} with state ${state} and tier ${tier}; the manifest models one suffix per name`);
    }

    const acc = accumulators.get(base) ?? newAccumulator();
    accumulators.set(base, acc);
    if (tier) acc.tiers.add(tier);
    if (state) acc.states.add(state);
    if (!tier && !state) acc.bare = true;
    for (const read of hit.reads) acc.reads.add(read);
    for (const feed of hit.feeds) {
      if (!feed.prop.startsWith("--_")) acc.properties.add(feed.prop);
      acc.feeds++;
      if (!feed.direct) acc.direct = false;
    }
    const rules = acc.passes.get(hit.name) ?? new Map<number, Set<string>>();
    acc.passes.set(hit.name, rules);
    const passed = rules.get(hit.rule) ?? new Set<string>();
    rules.set(hit.rule, passed);
    for (const feed of hit.feeds) if (feed.direct) passed.add(feed.prop);
  }

  const tokenValues = new Map([...rootDecls].map(([name, { value }]) => [name, value]));
  const props: Record<string, PropEntry> = {};
  for (const name of [...accumulators.keys()].sort(byCodeUnit)) {
    const acc = accumulators.get(name)!;
    const entry: PropEntry = {
      properties: [...acc.properties].sort(byCodeUnit),
      kind: acc.feeds > 0 && acc.direct ? "prop" : "helper",
      tiers: TIERS.filter((tier) => acc.tiers.has(tier)),
      states: STATES.filter((state) => acc.states.has(state)),
    };
    if (!acc.bare) entry.requires_suffix = true;
    const reads = [...acc.reads]
      .filter((read) => !read.startsWith("--_") && !tokenValues.has(read) && !accumulators.has(read) && !isVariant(read, accumulators))
      .sort(byCodeUnit);
    if (reads.length) entry.reads = reads;
    const collision = collisionOf(acc.passes);
    if (collision.length) entry.collision = collision;
    if (DEPRECATED[name]) entry.deprecated = DEPRECATED[name];
    if (acc.feeds === 0) warnings.add(`empty-rule: ${name} sets nothing`);
    props[name] = entry;
  }

  const breakpoints: Partial<Record<Tier, number>> = {};
  for (const tier of TIERS) {
    const seen = widthsSeen.get(tier);
    if (!seen) continue;
    const widths = [...seen].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([px]) => px);
    breakpoints[tier] = widths[0];
    if (widths.length > 1) {
      warnings.add(`breakpoint-conflict: ${tier} appears at ${widths.sort((a, b) => a - b).map((px) => `${px}px`).join(" and ")}`);
    }
  }

  const tokens: Record<string, { type: TokenType }> = {};
  for (const name of [...tokenValues.keys()].sort(byCodeUnit)) {
    tokens[name] = { type: tokenType(tokenValues.get(name)!, tokenValues, new Set([name])) };
  }

  return {
    version: SCHEMA_VERSION,
    generated_from: { file: opts.file ?? "startr.css", sha256: createHash("sha256").update(css).digest("hex") },
    breakpoints,
    props,
    tokens,
    warnings: [...warnings].sort(byCodeUnit),
  };
}

/** The key plus tier or state a style attribute name stands for, or null when the manifest has no such name. */
export function resolveName(
  manifest: Pick<Manifest, "props">,
  name: string,
): { base: string; tier?: Tier; state?: State } | null {
  if (Object.hasOwn(manifest.props, name)) return { base: name };
  for (const tier of TIERS) {
    const stem = name.slice(0, -(tier.length + 1));
    if (name.endsWith(`-${tier}`) && Object.hasOwn(manifest.props, stem) && manifest.props[stem].tiers.includes(tier)) {
      return { base: stem, tier };
    }
  }
  for (const state of STATES) {
    const stem = name.slice(0, -(state.length + 1));
    if (name.endsWith(`-${state}`) && Object.hasOwn(manifest.props, stem) && manifest.props[stem].states.includes(state)) {
      return { base: stem, state };
    }
  }
  return null;
}

/** Every name an author can write: each key (unless it requires a suffix) and its tier and state forms. The inverse of resolveName(). */
export function allNames(manifest: Pick<Manifest, "props">): string[] {
  const names: string[] = [];
  for (const [name, entry] of Object.entries(manifest.props)) {
    if (!entry.requires_suffix) names.push(name);
    for (const tier of entry.tiers) names.push(`${name}-${tier}`);
    for (const state of entry.states) names.push(`${name}-${state}`);
  }
  return names.sort(byCodeUnit);
}

/** props.json text: one prop or token per line, so a diff shows what changed and the file stays small. */
export function formatManifest(manifest: Manifest): string {
  const one = (value: unknown) => JSON.stringify(value);
  const block = (record: Record<string, unknown>) => {
    const keys = Object.keys(record);
    if (keys.length === 0) return "{}";
    return `{\n${keys.map((key) => `    ${one(key)}: ${one(record[key])}`).join(",\n")}\n  }`;
  };
  const list = (items: string[]) =>
    items.length === 0 ? "[]" : `[\n${items.map((item) => `    ${one(item)}`).join(",\n")}\n  ]`;
  return [
    "{",
    `  "version": ${manifest.version},`,
    `  "generated_from": ${one(manifest.generated_from)},`,
    `  "breakpoints": ${one(manifest.breakpoints)},`,
    `  "props": ${block(manifest.props)},`,
    `  "tokens": ${block(manifest.tokens)},`,
    `  "warnings": ${list(manifest.warnings)}`,
    "}",
    "",
  ].join("\n");
}

/** True when the name is a suffixed form (tier or state) of a prop that exists. */
function isVariant(name: string, bases: Map<string, Accumulator>): boolean {
  for (const tier of TIERS) {
    const stem = name.slice(0, -(tier.length + 1));
    if (name.endsWith(`-${tier}`) && bases.get(stem)?.tiers.has(tier)) return true;
  }
  for (const state of STATES) {
    const stem = name.slice(0, -(state.length + 1));
    if (name.endsWith(`-${state}`) && bases.get(stem)?.states.has(state)) return true;
  }
  return false;
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function newAccumulator(): Accumulator {
  return { properties: new Set(), direct: true, feeds: 0, tiers: new Set(), states: new Set(), bare: false, reads: new Set(), passes: new Map() };
}

/** Every at-rule around the rule, innermost first. */
function atRulesAround(rule: postcss.Rule): postcss.AtRule[] {
  const found: postcss.AtRule[] = [];
  for (let node = rule.parent; node && node.type !== "root"; node = node.parent as postcss.Container | undefined) {
    if (node.type === "atrule") found.push(node as postcss.AtRule);
  }
  return found;
}

function tierContext(media: string[]): TierContext {
  for (const params of media) {
    const query = params.toLowerCase();
    if (/(^|[\s,])not\s/.test(query)) continue;
    const width = /\(\s*min-width\s*:\s*(\d+(?:\.\d+)?)px\s*\)/.exec(query);
    if (width) return { kind: "width", px: Number(width[1]) };
    if (/(^|[\s,(])print(?![\w-])/.test(query)) return { kind: "print" };
  }
  return null;
}

function foldTier(name: string, context: TierContext): { stem: string; tier: Tier | null; px?: number } {
  // A stem needs at least "--x", so "--pt" inside @media print is not "-" plus "-pt".
  if (context?.kind === "print" && name.endsWith("-pt") && name.length - 3 >= 3) {
    return { stem: name.slice(0, -3), tier: "pt" };
  }
  if (context?.kind === "width") {
    const match = WIDTH_SUFFIX.exec(name);
    if (match && name.length - match[0].length >= 3) {
      return { stem: name.slice(0, -match[0].length), tier: match[1] as Tier, px: context.px };
    }
  }
  return { stem: name, tier: null };
}

/**
 * Names from [style*="NAME:"] in the compound that styles the element, the one after the last top-level combinator.
 * A name inside :is(), :not() or :has() is a condition, not a definition: the reduced-motion rule lists every animated prop in a :is() and must not turn them into helpers.
 */
function subjectNames(selector: string): string[] {
  const found: { name: string; compound: number }[] = [];
  let compound = 0;
  let depth = 0;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch === "\\") i++;
    else if (ch === '"' || ch === "'") i = endOfString(selector, i);
    else if (ch === "[") {
      NAME_ATTR.lastIndex = i;
      const match = NAME_ATTR.exec(selector);
      if (match) {
        if (depth === 0 && match[2].endsWith(":")) found.push({ name: match[2].slice(0, -1), compound });
        i = NAME_ATTR.lastIndex - 1;
      } else i = endOfBracket(selector, i);
    } else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0 && /[\s>+~]/.test(ch)) compound = i + 1;
  }
  return found.filter((hit) => hit.compound === compound).map((hit) => hit.name);
}

function endOfString(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === text[start]) return i;
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

function isRootScope(selector: string): boolean {
  return /^(?::root|html)(?:\[[^\]]*\]|:[\w-]+(?:\([^)]*\))?)*$/i.test(selector.trim());
}

function feedsOf(name: string, decls: postcss.Declaration[]): Feed[] {
  const prop = (decl: postcss.Declaration) => (decl.prop.startsWith("--") ? decl.prop : decl.prop.toLowerCase());
  const standard = new Set(decls.map(prop).filter((p) => !p.startsWith("--")));
  const feeds: Feed[] = [];
  for (const decl of decls) {
    const p = prop(decl);
    const vendor = VENDOR_PREFIX.exec(p);
    if (vendor && standard.has(vendor[1])) continue; // autoprefixer's twin of a property the rule also sets
    feeds.push({ prop: p, direct: !p.startsWith("--") && passthroughOf(decl.value) === name });
  }
  return feeds;
}

function collisionOf(passes: Map<string, Map<number, Set<string>>>): string[] {
  const found = new Set<string>();
  for (const rules of passes.values()) {
    const sets = [...rules.values()].filter((set) => set.size > 0);
    for (let i = 0; i < sets.length; i++) {
      for (let j = i + 1; j < sets.length; j++) {
        const [a, b] = [sets[i], sets[j]];
        const aInB = [...a].every((p) => b.has(p));
        const bInA = [...b].every((p) => a.has(p));
        if (!aInB && !bInA) for (const p of [...a, ...b]) found.add(p);
      }
    }
  }
  return [...found].sort(byCodeUnit);
}

/** The value as one function call: fn(inner), with the closing paren at the very end. */
function parseCall(value: string): { fn: string; inner: string } | null {
  const v = value.trim();
  const open = v.indexOf("(");
  if (open < 1 || !/^[\w-]+$/.test(v.slice(0, open))) return null;
  let depth = 0;
  let quote = "";
  for (let i = open; i < v.length; i++) {
    const ch = v[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) {
      return i === v.length - 1 ? { fn: v.slice(0, open).toLowerCase(), inner: v.slice(open + 1, i) } : null;
    }
  }
  return null;
}

function splitTopLevel(text: string, separator = ","): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (depth === 0 && ch === separator) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** The custom property a value passes straight through: var(--x) or var(--x, fallback), and nothing else. */
function passthroughOf(value: string): string | null {
  const call = parseCall(value);
  if (call?.fn !== "var") return null;
  const ref = splitTopLevel(call.inner)[0].trim();
  return VALID_NAME.test(ref) ? ref : null;
}

const LENGTH_UNITS = new Set(
  "px rem em ex ch rex rch cap ic lh rlh vw vh vi vb vmin vmax svw svh svi svb lvw lvh lvi lvb dvw dvh dvi dvb cqw cqh cqi cqb cqmin cqmax cm mm q in pt pc".split(" "),
);
const COLOR_FUNCTIONS = new Set("rgb rgba hsl hsla hwb lab lch oklab oklch color color-mix light-dark device-cmyk".split(" "));
const MATH_FUNCTIONS = new Set("calc min max clamp".split(" "));
const NAMED_COLORS = new Set(
  ("transparent currentcolor aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen canvas canvastext linktext visitedtext activetext buttonface buttontext field fieldtext highlight highlighttext graytext").split(" "),
);
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
const DIMENSION = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?([a-z%]+)$/i;

/** color, length, number or other. A var() follows its reference; a calc() is a length if any part is. */
function tokenType(value: string, tokens: Map<string, string>, seen: Set<string>): TokenType {
  const v = value.trim().replace(/\s+/g, " ");
  const call = parseCall(v);
  if (call?.fn === "var") {
    const [ref, ...fallback] = splitTopLevel(call.inner);
    const name = ref.trim();
    if (tokens.has(name) && !seen.has(name)) return tokenType(tokens.get(name)!, tokens, new Set([...seen, name]));
    return fallback.length ? tokenType(fallback.join(","), tokens, seen) : "other";
  }
  if (HEX_COLOR.test(v) || NAMED_COLORS.has(v.toLowerCase())) return "color";
  if (call && COLOR_FUNCTIONS.has(call.fn)) return "color";
  if (NUMBER.test(v)) return "number";
  const dimension = DIMENSION.exec(v);
  if (dimension) return dimension[1] === "%" || LENGTH_UNITS.has(dimension[1].toLowerCase()) ? "length" : "other";
  if (call && MATH_FUNCTIONS.has(call.fn)) return mathType(call.inner, tokens, seen);
  return "other";
}

function mathType(inner: string, tokens: Map<string, string>, seen: Set<string>): TokenType {
  const found = new Set<TokenType>();
  for (const match of inner.matchAll(/var\(\s*(--[\w-]+)/g)) {
    const name = match[1];
    found.add(tokens.has(name) && !seen.has(name) ? tokenType(tokens.get(name)!, tokens, new Set([...seen, name])) : "other");
  }
  // Names such as --space-2 hold digits that are not part of the sum.
  for (const match of inner.replace(/--[\w-]+/g, " ").matchAll(/(?<![\w.])[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?([a-z%]*)/gi)) {
    const unit = match[1].toLowerCase();
    found.add(unit === "" ? "number" : unit === "%" || LENGTH_UNITS.has(unit) ? "length" : "other");
  }
  if (found.has("other") || found.has("color")) return "other";
  return found.has("length") ? "length" : found.has("number") ? "number" : "other";
}

if (import.meta.main) {
  const [input, output] = process.argv.slice(2);
  if (!input) {
    console.error("usage: bun scripts/manifest.ts <startr.css> [props.json]");
    process.exit(2);
  }
  const text = formatManifest(buildManifest(await Bun.file(input).text(), { file: input.split("/").pop() }));
  if (output) await Bun.write(output, text);
  else process.stdout.write(text);
}
