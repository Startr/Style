// Parity check: does C (this repo's PostCSS build) still generate P (the
// hand-edited published 1.x sheet)?
//
//   bun run parity                 build C into a temp dir, diff it against P
//   bun run parity --json          the same, as JSON on stdout
//   bun run parity --all           list every item, allowed ones included
//   bun run parity --p FILE        compare against another P (env PARITY_P); the default is
//                                  test/fixtures/published-1.3.2.css, a byte copy of the
//                                  sheet startr.style served on 2026-10-16 (sha256 bdc59404…)
//   bun run parity --c FILE        skip the build, use this already-built sheet
//   bun run parity --keep          keep the temp build dir (path is printed)
//   bun run parity --max N         lines shown per kind (default 60; --all shows all)
//   bun run parity --allow-dir DIR read allowlist fragments from DIR (default parity-allow.d)
//
// Both sheets are parsed with PostCSS. Every rule is keyed by
//   (at-rule chain, ONE selector)        selector lists are split
// and holds its declarations as (property, value, !important), merged in
// source order when the key occurs more than once. Comments are ignored, and
// whitespace in selectors, media params and values is normalized.
//
// Four kinds of difference:
//   missing   in P, not in C
//   extra     in C, not in P
//   changed   in both, but value, !important, repeat count or the order of
//             repeated declarations (fallbacks) differ
//   order     the cascade differs: two rules of equal specificity and
//             importance that set the same property run in another order.
//             Shorthands count for their longhands (`border` sets
//             border-right). This is what catches the duplicate selector
//             pairs: --br (border-radius, then border-right), --fs (flex-shrink,
//             then font-style), --ct (content, twice). Rules that differ in
//             specificity never conflict by order, so they are not compared.
//             Inside one rule the later declaration wins too: `padding` then
//             `padding-top` is not `padding-top` then `padding`.
//
// Passes without an allowlist entry (additive 1.x growth):
//   - new rules whose selectors all end in a [style*="..."] attribute selector
//     (pseudo-classes, :is(), :where() and combinators in front are fine; so is
//     [style]:is([style*="--a:"], [style*="--b:"])) -- unless P carries that
//     attribute selector only inside a comment, which means P switched the prop
//     off on purpose (--maxw-sm). A new line in one of P's own rules is not growth.
//   - new @keyframes (a name P lacks) and new @property rules
//   - new custom properties in :root
//
// Everything else must be listed in parity-allow.d/*.json, one fragment per
// stream. A fragment is an array of
//   { "kind": "missing" | "extra" | "changed" | "order",
//     "selector": regex,            the single normalized selector (for order
//                                   items also the other rule of the pair)
//     "media": regex (optional),    the at-rule chain, e.g.
//                                   "@media only screen and (min-width:640px)";
//                                   nested chains join with " | ";
//                                   "^$" is the top level
//     "prop": regex (optional),     the property (order items: any of them)
//     "value": regex (optional),    the value: P's for missing, C's for extra,
//                                   either for changed
//     "reason": text }              required
//
// Exit 0: no unallowed difference. Exit 1: some. Exit 2: setup error (build
// failed, unreadable file, bad allowlist fragment).

import postcss from "postcss";
import { parseArgs } from "node:util";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";

// ---------------------------------------------------------------- types ---

type Kind = "missing" | "extra" | "changed" | "order";
const KINDS: Kind[] = ["missing", "extra", "changed", "order"];

interface Decl {
  prop: string;
  value: string;
  important: boolean;
  line: number;
  col: number;
}

interface Entry {
  ctx: string; // normalized at-rule chain, "" at top level
  sel: string; // one normalized selector
  decls: Decl[];
  line: number; // first rule that carries this key
}

interface SeqItem {
  id: string; // ctx + SEP + sel
  ctx: string;
  sel: string;
  line: number;
  col: number;
  lit: boolean; // the rule declares this property itself, not through a shorthand
}

interface Sheet {
  file: string;
  entries: Map<string, Entry>;
  // property (vendor prefix stripped, longhands expanded) -> partition ->
  // the rules that set it, in source order
  seq: Map<string, SeqItem[]>;
  nestedSkipped: number;
  comments: string; // all comment text, for the retired-rule guard
  ctxs: Set<string>; // every at-rule chain that holds a rule
}

interface Item {
  kind: Kind;
  media: string;
  selector: string;
  prop: string;
  props?: string[]; // order items: every property the same swap shows up in
  peer?: string; // order items: the rule on the other side of the swap
  p?: { line: number; value?: string; important?: boolean };
  c?: { line: number; value?: string; important?: boolean; src?: string };
  note?: string;
  newKey?: boolean; // extra items: the whole rule is absent from P
  status: "unallowed" | "allowed" | "additive";
  fragment?: string;
  reason?: string;
}

interface AllowEntry {
  kind: Kind;
  selector: RegExp;
  media?: RegExp;
  prop?: RegExp;
  value?: RegExp;
  reason: string;
  fragment: string;
  index: number;
  hits: number;
}

const SEP = "␟"; // joins ctx and selector in ids

// ------------------------------------------------------- normalization ---

const collapseWs = (s: string) => s.replace(/\s+/g, " ").trim();

/** Collapse whitespace outside strings and drop it next to ( ) , */
function normalizeValue(raw: string): string {
  let out = "";
  let quote = "";
  let space = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote) {
      out += ch;
      if (ch === "\\") out += raw[++i] ?? "";
      else if (ch === quote) quote = "";
      continue;
    }
    if (/\s/.test(ch)) {
      space = true;
      continue;
    }
    if (space && out && !"(,".includes(out[out.length - 1]) && !"),".includes(ch)) {
      out += " ";
    }
    space = false;
    if (ch === '"' || ch === "'") quote = ch;
    if (ch === "\\") {
      out += ch + (raw[++i] ?? "");
      continue;
    }
    out += ch;
  }
  return out;
}

/** At-rule params: lowercase for conditions, tight around : ( ) , */
function normalizeParams(name: string, params: string): string {
  let p = collapseWs(params);
  if (/^(media|supports|container)$/i.test(name)) {
    p = p.toLowerCase();
    p = p.replace(/\s*:\s*/g, ":").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
    p = p.replace(/\s*,\s*/g, ",");
  }
  return p;
}

const LEGACY_PSEUDO_EL = /(?<!:):(before|after|first-line|first-letter)(?![\w-])/g;

function normalizeAttr(body: string): string {
  const m = body.match(
    /^\[\s*([^\s~|^$*=\]]+)\s*(?:([~|^$*]?=)\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s\]]+)(?:\s+([iIsS]))?\s*)?\]$/,
  );
  if (!m) return collapseWs(body);
  const [, name, op, rawVal, flag] = m;
  if (!op) return `[${name}]`;
  let val = rawVal;
  if (/^['"]/.test(val)) val = val.slice(1, -1);
  const quoted = val.includes('"') ? `'${val}'` : `"${val}"`;
  return `[${name}${op}${quoted}${flag ? " " + flag : ""}]`;
}

interface SelParts {
  parts: string[]; // compound selectors
  combs: string[]; // combs[i] sits between parts[i] and parts[i+1]: " " > + ~
}

/** Split a complex selector into compounds and combinators, outside () [] "" */
function splitSelector(sel: string): SelParts {
  const parts: string[] = [];
  const combs: string[] = [];
  let cur = "";
  let depth = 0;
  let quote = "";
  let pending: string | null = null;
  const flush = () => {
    if (cur) {
      parts.push(cur);
      cur = "";
    }
  };
  // the first character of a compound closes the combinator before it
  const startCompound = () => {
    if (parts.length > combs.length) combs.push(pending ?? " ");
    pending = null;
  };
  for (let i = 0; i < sel.length; i++) {
    const ch = sel[i];
    if (quote) {
      cur += ch;
      if (ch === "\\") cur += sel[++i] ?? "";
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === "\\") {
      if (cur === "") startCompound();
      cur += ch + (sel[++i] ?? "");
      continue;
    }
    if (depth === 0 && (/\s/.test(ch) || ch === ">" || ch === "+" || ch === "~")) {
      flush();
      if (ch === ">" || ch === "+" || ch === "~") pending = ch;
      else if (pending === null) pending = " ";
      continue;
    }
    if (cur === "") startCompound();
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth--;
    cur += ch;
  }
  flush();
  return { parts, combs };
}

const SELECTOR_LIST_PSEUDOS = /^(is|where|not|has|matches|any|-webkit-any|-moz-any)$/i;

/** Canonical text of one compound: attributes quoted, :is() lists normalized */
function normalizeCompound(c: string): string {
  let out = "";
  let i = 0;
  while (i < c.length) {
    const ch = c[i];
    if (ch === "\\") {
      out += ch + (c[i + 1] ?? "");
      i += 2;
      continue;
    }
    if (ch === "[") {
      const end = findClose(c, i, "[", "]");
      out += normalizeAttr(c.slice(i, end + 1));
      i = end + 1;
      continue;
    }
    if (ch === ":") {
      // :name or ::name, optionally with (args)
      let j = i + 1;
      if (c[j] === ":") j++;
      const nameStart = j;
      while (j < c.length && /[\w-]/.test(c[j])) j++;
      const name = c.slice(nameStart, j);
      let text = c.slice(i, j);
      if (c[j] === "(") {
        const end = findClose(c, j, "(", ")");
        const inner = c.slice(j + 1, end);
        let arg: string;
        if (SELECTOR_LIST_PSEUDOS.test(name)) arg = normalizeSelectorList(inner);
        else if (/^nth-/i.test(name)) arg = collapseWs(inner).replace(/\s*([+-])\s*/g, "$1");
        else arg = collapseWs(inner).replace(/\s*,\s*/g, ",");
        text += `(${arg})`;
        j = end + 1;
      }
      out += text;
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out.replace(LEGACY_PSEUDO_EL, "::$1");
}

function findClose(s: string, from: number, open: string, close: string): number {
  let depth = 0;
  let quote = "";
  for (let i = from; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return i;
  }
  return s.length - 1;
}

function splitTopLevel(s: string, sepChar: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      cur += ch;
      if (ch === "\\") cur += s[++i] ?? "";
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === "\\") {
      cur += ch + (s[++i] ?? "");
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === sepChar && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function normalizeSelector(sel: string): string {
  const { parts, combs } = splitSelector(collapseWs(sel));
  let out = "";
  parts.forEach((p, i) => {
    out += normalizeCompound(p);
    if (i < combs.length) out += combs[i];
  });
  return out;
}

function normalizeSelectorList(list: string): string {
  return splitTopLevel(list, ",")
    .map((s) => normalizeSelector(s))
    .join(",");
}

// ---------------------------------------------------------- specificity ---

type Spec = [number, number, number];

const cmpSpec = (a: Spec, b: Spec) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

function specificity(sel: string): Spec {
  const total: Spec = [0, 0, 0];
  for (const compound of splitSelector(sel).parts) {
    const s = compoundSpecificity(compound);
    total[0] += s[0];
    total[1] += s[1];
    total[2] += s[2];
  }
  return total;
}

function compoundSpecificity(c: string): Spec {
  const s: Spec = [0, 0, 0];
  let i = 0;
  const ident = (from: number) => {
    let j = from;
    while (j < c.length && (/[\w\u0080-￿-]/.test(c[j]) || c[j] === "\\")) {
      if (c[j] === "\\") j++;
      j++;
    }
    return j;
  };
  // optional type selector / universal / namespace
  if (i < c.length && /[\w*|\\-]/.test(c[i]) && c[i] !== "-") {
    const j = ident(i);
    const tok = c.slice(i, j) || c[i];
    if (c[i] === "*") i++;
    else {
      if (tok && tok !== "*") s[2]++;
      i = Math.max(j, i + 1);
    }
  }
  while (i < c.length) {
    const ch = c[i];
    if (ch === "#") {
      s[0]++;
      i = ident(i + 1);
    } else if (ch === ".") {
      s[1]++;
      i = ident(i + 1);
    } else if (ch === "[") {
      s[1]++;
      i = findClose(c, i, "[", "]") + 1;
    } else if (ch === ":") {
      const dbl = c[i + 1] === ":";
      const nameStart = i + (dbl ? 2 : 1);
      const j = ident(nameStart);
      const name = c.slice(nameStart, j).toLowerCase();
      let end = j;
      let arg = "";
      if (c[j] === "(") {
        end = findClose(c, j, "(", ")") + 1;
        arg = c.slice(j + 1, end - 1);
      }
      if (dbl || /^(before|after|first-line|first-letter)$/.test(name)) s[2]++;
      else if (name === "where") {
        // zero
      } else if (/^(is|not|has|matches|any|-webkit-any|-moz-any)$/.test(name)) {
        let max: Spec = [0, 0, 0];
        for (const a of splitTopLevel(arg, ",")) {
          const as = specificity(a.trim());
          if (cmpSpec(as, max) > 0) max = as;
        }
        s[0] += max[0];
        s[1] += max[1];
        s[2] += max[2];
      } else s[1]++;
      i = end;
    } else i++;
  }
  return s;
}

/**
 * The [style*="..."] attribute selectors that make a selector a style-prop
 * selector: those on its subject (last) compound, or inside an :is() or
 * :where() on that compound whose alternatives all qualify. Empty if none.
 */
function styleAttrsOf(sel: string): string[] {
  const parts = splitSelector(sel).parts;
  const subject = parts[parts.length - 1] ?? "";
  const out: string[] = [];
  for (let i = 0; i < subject.length; i++) {
    const ch = subject[i];
    if (ch === "\\") i++;
    else if (ch === "[") {
      const end = findClose(subject, i, "[", "]");
      const attr = subject.slice(i, end + 1);
      if (/^\[style\*=/.test(attr)) out.push(attr);
      i = end;
    } else if (ch === ":") {
      const m = /^::?(is|where|matches|any|-webkit-any|-moz-any)\(/i.exec(subject.slice(i));
      if (m) {
        const open = i + m[0].length - 1;
        const close = findClose(subject, open, "(", ")");
        const alts = splitTopLevel(subject.slice(open + 1, close), ",")
          .map((a) => a.trim())
          .filter(Boolean);
        const found = alts.map(styleAttrsOf);
        if (alts.length && found.every((f) => f.length)) out.push(...found.flat());
        i = close;
      }
    } else if (ch === "(") i = findClose(subject, i, "(", ")");
  }
  return out;
}

/** Does the selector end in a [style*="..."] attribute selector? */
const isStyleAttrSelector = (sel: string) => styleAttrsOf(sel).length > 0;

// ------------------------------------------------------------ shorthands ---

const SIDES = ["top", "right", "bottom", "left"];
const CORNERS = ["top-left", "top-right", "bottom-right", "bottom-left"];
const borderSide = (s: string) => [`border-${s}-width`, `border-${s}-style`, `border-${s}-color`];

const LONGHANDS: Record<string, string[]> = {
  margin: SIDES.map((s) => `margin-${s}`),
  padding: SIDES.map((s) => `padding-${s}`),
  inset: [...SIDES],
  border: [
    "border-width",
    "border-style",
    "border-color",
    ...SIDES.flatMap((s) => [`border-${s}`, ...borderSide(s)]),
    "border-image",
  ],
  "border-top": borderSide("top"),
  "border-right": borderSide("right"),
  "border-bottom": borderSide("bottom"),
  "border-left": borderSide("left"),
  "border-width": SIDES.map((s) => `border-${s}-width`),
  "border-style": SIDES.map((s) => `border-${s}-style`),
  "border-color": SIDES.map((s) => `border-${s}-color`),
  "border-radius": CORNERS.map((c) => `border-${c}-radius`),
  background: [
    "background-color",
    "background-image",
    "background-position",
    "background-size",
    "background-repeat",
    "background-origin",
    "background-clip",
    "background-attachment",
  ],
  font: [
    "font-style",
    "font-variant",
    "font-weight",
    "font-stretch",
    "font-size",
    "line-height",
    "font-family",
  ],
  flex: ["flex-grow", "flex-shrink", "flex-basis"],
  "flex-flow": ["flex-direction", "flex-wrap"],
  gap: ["row-gap", "column-gap"],
  "grid-gap": ["row-gap", "column-gap"],
  "grid-template": ["grid-template-rows", "grid-template-columns", "grid-template-areas"],
  "grid-row": ["grid-row-start", "grid-row-end"],
  "grid-column": ["grid-column-start", "grid-column-end"],
  "grid-area": ["grid-row-start", "grid-row-end", "grid-column-start", "grid-column-end"],
  overflow: ["overflow-x", "overflow-y"],
  "place-items": ["align-items", "justify-items"],
  "place-content": ["align-content", "justify-content"],
  "place-self": ["align-self", "justify-self"],
  "text-decoration": [
    "text-decoration-line",
    "text-decoration-style",
    "text-decoration-color",
    "text-decoration-thickness",
  ],
  transition: [
    "transition-property",
    "transition-duration",
    "transition-timing-function",
    "transition-delay",
  ],
  animation: [
    "animation-name",
    "animation-duration",
    "animation-timing-function",
    "animation-delay",
    "animation-iteration-count",
    "animation-direction",
    "animation-fill-mode",
    "animation-play-state",
  ],
  "list-style": ["list-style-type", "list-style-position", "list-style-image"],
  outline: ["outline-width", "outline-style", "outline-color"],
  columns: ["column-width", "column-count"],
  "column-rule": ["column-rule-width", "column-rule-style", "column-rule-color"],
};
// grid-gap is the old name of gap
LONGHANDS["grid-gap"] = LONGHANDS.gap;
// longhands of grid-row-gap and grid-column-gap, same as row-gap, column-gap
const ALIASES: Record<string, string> = {
  "grid-row-gap": "row-gap",
  "grid-column-gap": "column-gap",
};

// Logical sides are the physical ones in a left-to-right, horizontal page, so
// --px (padding-inline-start) and --pl (padding-left) fight over one property.
// The -webkit-padding-start spellings are the old names of the same thing.
const PHYSICAL: Record<string, string> = {};
for (const box of ["margin", "padding"]) {
  for (const [logical, side] of [
    ["inline-start", "left"],
    ["inline-end", "right"],
    ["block-start", "top"],
    ["block-end", "bottom"],
    ["start", "left"],
    ["end", "right"],
    ["before", "top"],
    ["after", "bottom"],
  ]) {
    PHYSICAL[`${box}-${logical}`] = `${box}-${side}`;
  }
  LONGHANDS[`${box}-inline`] = [`${box}-left`, `${box}-right`];
  LONGHANDS[`${box}-block`] = [`${box}-top`, `${box}-bottom`];
}
for (const [logical, side] of [
  ["inline-start", "left"],
  ["inline-end", "right"],
  ["block-start", "top"],
  ["block-end", "bottom"],
]) {
  PHYSICAL[`inset-${logical}`] = side;
}
LONGHANDS["inset-inline"] = ["left", "right"];
LONGHANDS["inset-block"] = ["top", "bottom"];

const stripVendor = (p: string) => p.replace(/^-(webkit|moz|ms|o)-/, "");

/** The properties a declaration sets: itself, plus every longhand it resets */
function touched(prop: string): string[] {
  if (prop.startsWith("--")) return [prop];
  let p = stripVendor(prop);
  p = ALIASES[p] ?? PHYSICAL[p] ?? p;
  return [p, ...(LONGHANDS[p] ?? [])];
}

// ----------------------------------------------------------------- parse ---

const NO_CASCADE = /@(-\w+-)?(keyframes|font-face|property|page|counter-style)\b/;

function parseSheet(file: string, css: string): Sheet {
  const root = postcss.parse(css, { from: file });
  const sheet: Sheet = {
    file,
    entries: new Map(),
    seq: new Map(),
    nestedSkipped: 0,
    comments: "",
    ctxs: new Set(),
  };
  root.walkComments((c) => {
    sheet.comments += c.text + "\n";
  });
  const atKeys = new Map<string, number>();

  const entry = (ctx: string, sel: string, line: number): Entry => {
    const id = ctx + SEP + sel;
    let e = sheet.entries.get(id);
    if (!e) {
      e = { ctx, sel, decls: [], line };
      sheet.entries.set(id, e);
    }
    return e;
  };

  const record = (ctx: string, sel: string, decls: Decl[], line: number) => {
    const e = entry(ctx, sel, line);
    e.decls.push(...decls);
    sheet.ctxs.add(ctx);
    if (NO_CASCADE.test(ctx) || sel.startsWith("@")) return;
    const spec = specificity(sel).join(",");
    const here = new Map<string, SeqItem>();
    for (const d of decls) {
      const names = touched(d.prop);
      names.forEach((t, k) => {
        const key = `${d.important ? "!" : ""}${spec}\u0000${t}`;
        const lit = k === 0;
        const prev = here.get(key);
        if (prev) {
          prev.lit ||= lit;
          return;
        }
        here.set(key, { id: ctx + SEP + sel, ctx, sel, line: d.line, col: d.col, lit });
      });
    }
    for (const [key, item] of here) {
      let list = sheet.seq.get(key);
      if (!list) sheet.seq.set(key, (list = []));
      list.push(item);
    }
  };

  const declsOf = (node: postcss.Container): Decl[] => {
    const out: Decl[] = [];
    node.each((child) => {
      if (child.type === "decl") {
        out.push({
          prop: child.prop.startsWith("--") ? child.prop : child.prop.toLowerCase(),
          value: normalizeValue(child.value),
          important: !!child.important,
          line: child.source?.start?.line ?? 0,
          col: child.source?.start?.column ?? 0,
        });
      } else if (child.type === "rule") {
        sheet.nestedSkipped++;
      }
    });
    return out;
  };

  const walk = (container: postcss.Container, chain: string[]) => {
    container.each((node) => {
      if (node.type === "rule") {
        const ctx = chain.join(" | ");
        const decls = declsOf(node);
        const seen = new Set<string>();
        for (const raw of node.selectors) {
          const sel = normalizeSelector(raw);
          if (seen.has(sel)) continue;
          seen.add(sel);
          record(ctx, sel, decls, node.source?.start?.line ?? 0);
        }
      } else if (node.type === "atrule") {
        const name = node.name.toLowerCase();
        const text = `@${name}${node.params ? " " + normalizeParams(name, node.params) : ""}`;
        const line = node.source?.start?.line ?? 0;
        if (!node.nodes) {
          // statement at-rule: @import, @charset, @namespace
          entry(chain.join(" | "), text, line);
        } else if (node.nodes.some((n) => n.type === "decl")) {
          // @font-face, @property, @page: declarations sit directly inside
          const ctx = chain.join(" | ");
          const n = (atKeys.get(ctx + SEP + text) ?? 0) + 1;
          atKeys.set(ctx + SEP + text, n);
          const key = /^@(font-face|page)/.test(text) && n > 1 ? `${text}#${n}` : text;
          record(ctx, key, declsOf(node), line);
        } else {
          walk(node, [...chain, text]);
        }
      }
    });
  };
  walk(root, []);
  return sheet;
}

// ------------------------------------------------------------------ diff ---

function groupByProp(decls: Decl[]): Map<string, Decl[]> {
  const m = new Map<string, Decl[]>();
  for (const d of decls) {
    const list = m.get(d.prop);
    if (list) list.push(d);
    else m.set(d.prop, [d]);
  }
  return m;
}

const sameDecl = (a: Decl, b: Decl) => a.value === b.value && a.important === b.important;

function diffEntries(p: Sheet, c: Sheet): Item[] {
  const items: Item[] = [];
  const push = (it: Omit<Item, "status">) => items.push({ ...it, status: "unallowed" });

  const declP = (d: Decl) => ({ line: d.line, value: d.value, important: d.important });

  for (const [id, pe] of p.entries) {
    const ce = c.entries.get(id);
    if (!ce) {
      if (pe.decls.length === 0) {
        push({ kind: "missing", media: pe.ctx, selector: pe.sel, prop: "", p: { line: pe.line } });
      }
      for (const d of pe.decls) {
        push({ kind: "missing", media: pe.ctx, selector: pe.sel, prop: d.prop, p: declP(d) });
      }
      continue;
    }
    const pg = groupByProp(pe.decls);
    const cg = groupByProp(ce.decls);
    for (const [prop, pl] of pg) {
      const cl = cg.get(prop) ?? [];
      // pair identical declarations first, then the leftovers in order
      const cLeft = [...cl];
      const pLeft: Decl[] = [];
      for (const d of pl) {
        const k = cLeft.findIndex((x) => sameDecl(x, d));
        if (k >= 0) cLeft.splice(k, 1);
        else pLeft.push(d);
      }
      // the same repeats in another order: the last one wins, so it matters
      if (!pLeft.length && !cLeft.length && pl.length > 1) {
        const sig = (d: Decl) => `${d.value}\u0000${d.important}`;
        const k = pl.findIndex((d, i) => sig(d) !== sig(cl[i]));
        if (k >= 0) {
          push({
            kind: "changed",
            media: pe.ctx,
            selector: pe.sel,
            prop,
            p: declP(pl[k]),
            c: { line: cl[k].line, value: cl[k].value, important: cl[k].important },
            note: "repeated declarations run in another order",
          });
        }
      }
      const pairs = Math.min(pLeft.length, cLeft.length);
      for (let i = 0; i < pairs; i++) {
        push({
          kind: "changed",
          media: pe.ctx,
          selector: pe.sel,
          prop,
          p: declP(pLeft[i]),
          c: { line: cLeft[i].line, value: cLeft[i].value, important: cLeft[i].important },
        });
      }
      for (const d of pLeft.slice(pairs)) {
        push({
          kind: "missing",
          media: pe.ctx,
          selector: pe.sel,
          prop,
          p: declP(d),
          note: cl.length ? `P declares it ${pl.length}x, C ${cl.length}x` : undefined,
        });
      }
      for (const d of cLeft.slice(pairs)) {
        push({
          kind: "extra",
          media: pe.ctx,
          selector: pe.sel,
          prop,
          c: { line: d.line, value: d.value, important: d.important },
          note: pl.length ? `P declares it ${pl.length}x, C ${cl.length}x` : undefined,
        });
      }
    }
    items.push(...ruleOrder(pe, ce));
    for (const [prop, cl] of cg) {
      if (pg.has(prop)) continue;
      for (const d of cl) {
        push({
          kind: "extra",
          media: ce.ctx,
          selector: ce.sel,
          prop,
          c: { line: d.line, value: d.value, important: d.important },
        });
      }
    }
  }
  for (const [id, ce] of c.entries) {
    if (p.entries.has(id)) continue;
    if (ce.decls.length === 0) {
      push({ kind: "extra", media: ce.ctx, selector: ce.sel, prop: "", c: { line: ce.line }, newKey: true });
    }
    for (const d of ce.decls) {
      push({
        kind: "extra",
        media: ce.ctx,
        selector: ce.sel,
        prop: d.prop,
        c: { line: d.line, value: d.value, important: d.important },
        newKey: true,
      });
    }
  }
  return items;
}

/**
 * Inside one rule the later declaration wins, so `padding` then `padding-top`
 * is not `padding-top` then `padding`. For every longhand, the properties that
 * set it must run in the same order in P and C.
 */
function ruleOrder(pe: Entry, ce: Entry): Item[] {
  const common = new Set(pe.decls.map((d) => d.prop).filter((n) => ce.decls.some((d) => d.prop === n)));
  const byLonghand = (e: Entry) => {
    const m = new Map<string, Decl[]>();
    for (const d of e.decls) {
      if (!common.has(d.prop)) continue;
      for (const l of touched(d.prop)) {
        const list = m.get(l);
        if (list) list.push(d);
        else m.set(l, [d]);
      }
    }
    return m;
  };
  const squeeze = (ds: Decl[]) => ds.filter((d, i) => d.prop !== ds[i - 1]?.prop);
  const pm = byLonghand(pe);
  const cm = byLonghand(ce);
  const seen = new Set<string>();
  const out: Item[] = [];
  for (const [longhand, pds] of pm) {
    const cds = cm.get(longhand);
    if (!cds) continue;
    const ps = squeeze(pds);
    const cs = squeeze(cds);
    if (ps.length < 2 || ps.map((d) => d.prop).join() === cs.map((d) => d.prop).join()) continue;
    const props = [...new Set(ps.map((d) => d.prop))];
    const key = props.sort().join();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind: "order",
      media: pe.ctx,
      selector: pe.sel,
      prop: props.find((n) => n === longhand) ?? props[0],
      props,
      p: { line: ps[0].line },
      c: { line: cs[0].line },
      note: `inside one rule: P declares ${ps.map((d) => d.prop).join(", ")}; C declares ${cs.map((d) => d.prop).join(", ")}`,
      status: "unallowed",
    });
  }
  return out;
}

/** Longest common subsequence of two id lists; returns the indices not in it */
function unmatched(a: string[], b: string[]): { a: number[]; b: number[] } {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ua = new Set<number>(a.map((_, i) => i));
  const ub = new Set<number>(b.map((_, i) => i));
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ua.delete(i);
      ub.delete(j);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return { a: [...ua], b: [...ub] };
}

/** Keep the first min(count) occurrences of every id that both sides have */
function commonOnly(a: SeqItem[], b: SeqItem[]): [SeqItem[], SeqItem[]] {
  const count = (list: SeqItem[]) => {
    const m = new Map<string, number>();
    for (const x of list) m.set(x.id, (m.get(x.id) ?? 0) + 1);
    return m;
  };
  const ca = count(a);
  const cb = count(b);
  const keep = (list: SeqItem[], other: Map<string, number>) => {
    const used = new Map<string, number>();
    return list.filter((x) => {
      const allowed = other.get(x.id) ?? 0;
      const n = used.get(x.id) ?? 0;
      if (n >= allowed) return false;
      used.set(x.id, n + 1);
      return true;
    });
  };
  return [keep(a, cb), keep(b, ca)];
}

function diffOrder(p: Sheet, c: Sheet): Item[] {
  interface Move {
    prop: string;
    lit: boolean;
    from: SeqItem;
    to?: SeqItem;
    peer?: SeqItem;
    rel: string;
  }
  const moves: Move[] = [];
  for (const [key, ps] of p.seq) {
    const cs = c.seq.get(key);
    if (!cs) continue;
    const prop = key.slice(key.indexOf("\u0000") + 1);
    const [pa, ca] = commonOnly(ps, cs);
    if (pa.length < 2) continue;
    const { a: moved } = unmatched(
      pa.map((x) => x.id),
      ca.map((x) => x.id),
    );
    // the same element, counted by occurrence, on the C side
    const occ = (idx: number) => pa.slice(0, idx).filter((x) => x.id === pa[idx].id).length;
    const posInC = (id: string, nth: number) => {
      let seen = 0;
      for (let k = 0; k < ca.length; k++) {
        if (ca[k].id !== id) continue;
        if (seen++ === nth) return k;
      }
      return -1;
    };
    for (const idx of moved) {
      const from = pa[idx];
      const k = posInC(from.id, occ(idx));
      // the closest P neighbour that sits on the other side of `from` in C
      let peer: SeqItem | undefined;
      let rel = "";
      for (let d = 1; d < pa.length && !peer; d++) {
        for (const q of [idx - d, idx + d]) {
          const other = pa[q];
          if (!other || other.id === from.id) continue;
          const oc = ca.findIndex((x) => x.id === other.id);
          if (oc < 0) continue;
          if (q < idx !== oc < k) {
            peer = other;
            rel = q < idx ? "after" : "before";
            break;
          }
        }
      }
      moves.push({ prop, lit: from.lit, from, to: ca[k], peer, rel });
    }
  }

  // One swap shows up once per longhand a shorthand resets (padding: four
  // sides). Fold those into one item per pair of rules.
  const groups = new Map<string, Move[]>();
  for (const m of moves) {
    const pair = [m.from.id, m.peer?.id ?? ""].sort().join("\u0001");
    const key = `${m.from.ctx}\u0002${pair}`;
    const g = groups.get(key);
    if (g) g.push(m);
    else groups.set(key, [m]);
  }
  const items: Item[] = [];
  for (const g of groups.values()) {
    const lead = g.find((m) => m.lit) ?? g[0];
    const { from, to, peer, rel } = lead;
    items.push({
      kind: "order",
      media: from.ctx,
      selector: from.sel,
      prop: lead.prop,
      props: [...new Set(g.map((m) => m.prop))],
      peer: peer?.sel,
      p: { line: from.line },
      c: to ? { line: to.line } : undefined,
      note: peer
        ? `P runs it ${rel} ${peer.ctx && peer.ctx !== from.ctx ? peer.ctx + " " : ""}${peer.sel} (P:${peer.line}); C has them the other way round`
        : "moved",
      status: "unallowed",
    });
  }
  return items;
}

// ------------------------------------------------------------- allowlist ---

function loadAllow(dir: string): AllowEntry[] {
  const out: AllowEntry[] = [];
  if (!existsSync(dir)) return out;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  for (const f of files) {
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(join(dir, f), "utf8"));
    } catch (e) {
      throw new Error(`${f}: not valid JSON (${(e as Error).message})`);
    }
    if (!Array.isArray(data)) throw new Error(`${f}: must be an array of entries`);
    data.forEach((raw: any, index: number) => {
      const where = `${f}[${index}]`;
      if (!raw || typeof raw !== "object") throw new Error(`${where}: not an object`);
      if (!KINDS.includes(raw.kind)) {
        throw new Error(`${where}: kind must be one of ${KINDS.join(", ")}`);
      }
      if (typeof raw.reason !== "string" || !raw.reason.trim()) {
        throw new Error(`${where}: reason is required`);
      }
      if (typeof raw.selector !== "string") throw new Error(`${where}: selector (regex) is required`);
      for (const k of Object.keys(raw)) {
        if (!["kind", "selector", "media", "prop", "value", "reason"].includes(k)) {
          console.error(`warning: ${where}: unknown key "${k}" ignored`);
        }
      }
      const re = (field: string): RegExp | undefined => {
        if (raw[field] === undefined) return undefined;
        try {
          return new RegExp(raw[field]);
        } catch (e) {
          throw new Error(`${where}: ${field} is not a valid regex (${(e as Error).message})`);
        }
      };
      out.push({
        kind: raw.kind,
        selector: re("selector")!,
        media: re("media"),
        prop: re("prop"),
        value: re("value"),
        reason: raw.reason,
        fragment: f,
        index,
        hits: 0,
      });
    });
  }
  return out;
}

function matches(e: AllowEntry, it: Item): boolean {
  if (e.kind !== it.kind) return false;
  if (!(e.selector.test(it.selector) || (it.peer !== undefined && e.selector.test(it.peer)))) {
    return false;
  }
  if (e.media && !e.media.test(it.media)) return false;
  if (e.prop && !(e.prop.test(it.prop) || (it.props ?? []).some((x) => e.prop!.test(x)))) return false;
  if (e.value) {
    const vals = [it.p?.value, it.c?.value].filter((v): v is string => v !== undefined);
    const wanted = it.kind === "missing" ? [it.p?.value] : it.kind === "extra" ? [it.c?.value] : vals;
    if (!wanted.some((v) => v !== undefined && e.value!.test(v))) return false;
  }
  return true;
}

/** Growth that needs no entry: see the header */
function isAdditive(it: Item, p: Sheet): boolean {
  if (it.kind !== "extra") return false;
  // a keyframes name P does not have; adding a frame to P's own would change it
  if (/@(-\w+-)?keyframes\b/.test(it.media)) return !p.ctxs.has(it.media);
  if (it.selector.startsWith("@property")) return !!it.newKey;
  // a token P does not declare yet (a second copy of one P declares has a note)
  if (it.selector === ":root" && it.prop.startsWith("--")) return !it.note;
  // a whole new rule on a style prop; an extra line in one of P's rules is not growth
  if (!it.newKey || it.selector.startsWith("@")) return false;
  const attrs = styleAttrsOf(it.selector);
  if (!attrs.length) return false;
  // P switched this prop off on purpose: its selector survives only in a comment
  const retired = attrs.some(
    (a) =>
      (p.comments.includes(a) || p.comments.includes(a.replace(/"/g, "'"))) &&
      ![...p.entries.values()].some((e) => e.sel.includes(a)),
  );
  return !retired;
}

// --------------------------------------------------------------- sources ---

type SourceLookup = (line: number, col: number) => string | undefined;

async function sourceLookup(cssFile: string, repoRoot: string): Promise<SourceLookup> {
  try {
    const { SourceMapConsumer } = await import("source-map-js");
    const mapFile = cssFile + ".map";
    if (!existsSync(mapFile)) return () => undefined;
    const consumer = new SourceMapConsumer(JSON.parse(readFileSync(mapFile, "utf8")));
    return (line, col) => {
      const pos = consumer.originalPositionFor({ line, column: Math.max(0, col - 1) });
      if (!pos.source || pos.line == null) return undefined;
      const abs = resolve(dirname(mapFile), pos.source);
      return `${relative(repoRoot, abs)}:${pos.line}`;
    };
  } catch {
    return () => undefined;
  }
}

// ------------------------------------------------------------------ main ---

/**
 * Write to stdout and wait until it is all out. console.log and Bun.write can
 * lose the tail of a large report, or spin, when stdout is a pipe.
 */
function emit(text: string) {
  const buf = Buffer.from(text.endsWith("\n") ? text : text + "\n");
  let off = 0;
  while (off < buf.length) {
    try {
      off += writeSync(1, buf, off, buf.length - off);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EAGAIN") throw e;
      Bun.sleepSync(2);
    }
  }
}

async function main(): Promise<number> {
  const root = resolve(import.meta.dir, "..");
  let args: ReturnType<typeof parseArgs>["values"];
  try {
    args = parseArgs({
      options: {
        p: { type: "string" },
        c: { type: "string" },
        "allow-dir": { type: "string" },
        json: { type: "boolean", default: false },
        all: { type: "boolean", default: false },
        keep: { type: "boolean", default: false },
        max: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
    }).values;
  } catch (e) {
    console.error(`${(e as Error).message}\nSee: bun run parity --help`);
    return 2;
  }
  if (args.help) {
    const lines = readFileSync(import.meta.path, "utf8").split("\n");
    emit(lines.slice(0, lines.findIndex((l) => l.startsWith("import "))).join("\n"));
    return 0;
  }

  const pFile = resolve(
    (args.p as string | undefined) ?? process.env.PARITY_P ?? join(root, "test/fixtures/published-1.3.2.css"),
  );
  if (!existsSync(pFile)) {
    console.error(`P not found: ${pFile}\nPass --p FILE or set PARITY_P.`);
    return 2;
  }

  // Build C into a directory of our own, never dist/
  let cFile: string;
  let tmpDir: string | undefined;
  if (args.c) {
    cFile = resolve(args.c as string);
  } else {
    tmpDir = mkdtempSync(join(tmpdir(), "startr-parity-"));
    const build = Bun.spawnSync([process.execPath, "run", "build.ts"], {
      cwd: root,
      env: { ...process.env, STARTR_DIST: tmpDir },
      stdout: "pipe",
      stderr: "pipe",
    });
    if (build.exitCode !== 0) {
      console.error("C failed to build, so there is nothing to compare.");
      console.error(build.stderr.toString().trim().split("\n").slice(-15).join("\n"));
      console.error(build.stdout.toString().trim().split("\n").slice(-5).join("\n"));
      console.error("If the failing file is not yours, another stream may be mid-edit. Retry in a minute.");
      rmSync(tmpDir, { recursive: true, force: true });
      return 2;
    }
    cFile = join(tmpDir, "startr.css");
  }
  if (!existsSync(cFile)) {
    console.error(`C not found: ${cFile}`);
    return 2;
  }

  let allow: AllowEntry[];
  try {
    allow = loadAllow(resolve((args["allow-dir"] as string | undefined) ?? join(root, "parity-allow.d")));
  } catch (e) {
    console.error(`allowlist: ${(e as Error).message}`);
    return 2;
  }

  const pCss = readFileSync(pFile, "utf8");
  const cCss = readFileSync(cFile, "utf8");
  let pSheet: Sheet;
  let cSheet: Sheet;
  try {
    pSheet = parseSheet(pFile, pCss);
    cSheet = parseSheet(cFile, cCss);
  } catch (e) {
    console.error(`CSS parse error: ${(e as Error).message}`);
    return 2;
  }
  const srcOf = await sourceLookup(cFile, root);

  const items = [...diffEntries(pSheet, cSheet), ...diffOrder(pSheet, cSheet)];

  // The font banner stays byte-identical: Trellis scripts/vendor_kit.py reads it
  const pBanner = pCss.split("\n", 1)[0];
  const cBanner = cCss.split("\n", 1)[0];
  if (pBanner !== cBanner) {
    items.push({
      kind: "changed",
      media: "",
      selector: "@banner",
      prop: "line 1",
      p: { line: 1, value: pBanner },
      c: { line: 1, value: cBanner },
      note: "the first line must stay byte-identical",
      status: "unallowed",
    });
  }

  for (const it of items) {
    if (it.c?.line && it.kind !== "order") {
      const decl = [...cSheet.entries.values()]
        .find((e) => e.ctx === it.media && e.sel === it.selector)
        ?.decls.find((d) => d.line === it.c!.line && (it.prop === "" || d.prop === it.prop));
      it.c.src = srcOf(it.c.line, decl?.col ?? 1);
    } else if (it.c?.line && it.kind === "order") {
      it.c.src = srcOf(it.c.line, 1);
    }
    const entry = allow.find((e) => matches(e, it));
    if (entry) {
      entry.hits++;
      it.status = "allowed";
      it.fragment = entry.fragment;
      it.reason = entry.reason;
    } else if (isAdditive(it, pSheet)) {
      it.status = "additive";
      it.fragment = "(built-in additive)";
    }
  }

  items.sort(
    (a, b) =>
      KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) ||
      (a.p?.line ?? a.c?.line ?? 0) - (b.p?.line ?? b.c?.line ?? 0) ||
      (a.c?.line ?? 0) - (b.c?.line ?? 0),
  );

  const unused = allow.filter((e) => e.hits === 0);
  const unallowed = items.filter((i) => i.status === "unallowed");

  const counts = Object.fromEntries(
    KINDS.map((k) => {
      const of = items.filter((i) => i.kind === k);
      return [
        k,
        {
          total: of.length,
          allowed: of.filter((i) => i.status === "allowed").length,
          additive: of.filter((i) => i.status === "additive").length,
          unallowed: of.filter((i) => i.status === "unallowed").length,
        },
      ];
    }),
  );
  const byFragment: Record<string, number> = {};
  for (const i of items) {
    if (i.fragment) byFragment[i.fragment] = (byFragment[i.fragment] ?? 0) + 1;
  }

  if (args.json) {
    emit(
      JSON.stringify(
        {
          p: pFile,
          c: cFile,
          ok: unallowed.length === 0,
          counts,
          byFragment,
          unusedAllow: unused.map((e) => ({ fragment: e.fragment, index: e.index })),
          items,
        },
        null,
        2,
      ),
    );
  } else {
    emit(
      renderText(items, counts, byFragment, unused, pFile, tmpDir ? "build of src/builds/startr.css" : cFile, !!args.all, Number(args.max ?? 60), pSheet, cSheet),
    );
  }

  if (tmpDir) {
    if (args.keep) console.error(`kept build: ${tmpDir}`);
    else rmSync(tmpDir, { recursive: true, force: true });
  }
  return unallowed.length === 0 ? 0 : 1;
}

// ---------------------------------------------------------------- report ---

const ctxLabel = (m: string) => (m === "" ? "" : `[${m}] `);

function short(v: string | undefined, n = 70): string {
  if (v === undefined) return "";
  return v.length > n ? v.slice(0, n - 1) + "…" : v;
}

function lineFor(it: Item): string {
  const loc = [
    it.p?.line ? `P:${it.p.line}` : "",
    it.c?.line ? `C:${it.c.line}${it.c.src ? ` (${it.c.src})` : ""}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const bang = (i?: boolean) => (i ? " !important" : "");
  let what = it.prop;
  if (it.kind === "changed") {
    what = `${it.prop}: P \`${short(it.p?.value)}${bang(it.p?.important)}\` C \`${short(it.c?.value)}${bang(it.c?.important)}\``;
  } else if (it.kind === "missing" || it.kind === "extra") {
    const d = it.kind === "missing" ? it.p : it.c;
    if (it.prop) what = `${it.prop}: ${short(d?.value)}${bang(d?.important)}`;
  }
  const note = it.note ? `  -- ${it.note}` : "";
  const why = it.status === "allowed" ? `  [${it.fragment}: ${short(it.reason, 60)}]` : "";
  return `${loc}  ${ctxLabel(it.media)}${it.selector}  ${what}${note}${why}`;
}

/** One display line per rule for missing and extra; one per declaration otherwise */
function displayLines(items: Item[], tag: (i: Item) => string): string[] {
  const out: string[] = [];
  const groups = new Map<string, Item[]>();
  for (const it of items) {
    if (it.kind === "changed" || it.kind === "order") {
      out.push(`${tag(it)}${lineFor(it)}`);
      continue;
    }
    const key = [it.kind, it.status, it.fragment, it.media, it.selector].join("\u0000");
    const g = groups.get(key);
    if (g) g.push(it);
    else {
      groups.set(key, [it]);
      out.push(key); // placeholder, resolved below in order
    }
  }
  return out.map((line) => {
    const g = groups.get(line);
    if (!g) return line;
    const first = g[0];
    const side = first.kind === "missing" ? "p" : "c";
    const lines = g.map((x) => x[side]?.line ?? 0).filter(Boolean);
    const lo = Math.min(...lines);
    const hi = Math.max(...lines);
    const src = first.c?.src ? ` (${first.c.src})` : "";
    const loc = `${side.toUpperCase()}:${lo}${hi !== lo ? "-" + hi : ""}${src}`;
    const props = g
      .filter((x) => x.prop)
      .map((x) => {
        const d = x[side];
        return `${x.prop}: ${short(d?.value, 40)}${d?.important ? " !important" : ""}`;
      })
      .join("; ");
    const notes = [...new Set(g.map((x) => x.note).filter(Boolean))].join("; ");
    const why = first.status === "allowed" ? `  [${first.fragment}: ${short(first.reason, 60)}]` : "";
    return `${tag(first)}${loc}  ${ctxLabel(first.media)}${first.selector}${props ? "  { " + short(props, 150) + " }" : ""}${notes ? "  -- " + notes : ""}${why}`;
  });
}

function renderText(
  items: Item[],
  counts: Record<string, Record<string, number>>,
  byFragment: Record<string, number>,
  unused: AllowEntry[],
  pFile: string,
  cFile: string,
  all: boolean,
  max: number,
  p: Sheet,
  c: Sheet,
): string {
  const out: string[] = [];
  out.push(`P  ${pFile}`);
  out.push(`C  ${cFile}`);
  out.push(`   ${p.entries.size} rule keys in P, ${c.entries.size} in C`);
  if (p.nestedSkipped || c.nestedSkipped) {
    out.push(`   warning: skipped nested rules (P ${p.nestedSkipped}, C ${c.nestedSkipped})`);
  }
  for (const kind of KINDS) {
    const shown = items.filter((i) => i.kind === kind && (all || i.status === "unallowed"));
    if (!shown.length) continue;
    out.push("");
    out.push(`${kind.toUpperCase()} (${shown.length}${all ? "" : " unallowed"})`);
    const tag = (i: Item) =>
      all ? (i.status === "unallowed" ? "!! " : i.status === "additive" ? "+  " : "ok ") : "";
    const lines = displayLines(shown, tag);
    const limit = all ? lines.length : max;
    for (const l of lines.slice(0, limit)) out.push(`  ${l}`);
    if (lines.length > limit) out.push(`  ... ${lines.length - limit} more (--all, --max N or --json)`);
  }
  if (unused.length) {
    out.push("");
    out.push("UNUSED ALLOWLIST ENTRIES (they matched nothing; not a failure)");
    for (const e of unused) out.push(`  ${e.fragment}[${e.index}] ${e.kind} ${e.selector.source}  -- ${short(e.reason, 60)}`);
  }
  out.push("");
  out.push("SUMMARY BY KIND");
  out.push(`  ${"kind".padEnd(9)} ${"total".padStart(6)} ${"allowed".padStart(8)} ${"additive".padStart(9)} ${"unallowed".padStart(10)}`);
  for (const k of KINDS) {
    const n = counts[k];
    out.push(
      `  ${k.padEnd(9)} ${String(n.total).padStart(6)} ${String(n.allowed).padStart(8)} ${String(n.additive).padStart(9)} ${String(n.unallowed).padStart(10)}`,
    );
  }
  out.push("SUMMARY BY SOURCE");
  const frags = Object.entries(byFragment).sort();
  if (!frags.length) out.push("  (none)");
  for (const [f, n] of frags) out.push(`  ${f.padEnd(24)} ${String(n).padStart(5)}`);
  const bad = items.filter((i) => i.status === "unallowed").length;
  out.push(`  ${"(unallowed)".padEnd(24)} ${String(bad).padStart(5)}`);
  out.push("");
  out.push(bad === 0 ? "PARITY OK" : `PARITY FAIL: ${bad} unallowed difference${bad === 1 ? "" : "s"}`);
  return out.join("\n");
}

// Importable for tests; runs only as the entry point.
export {
  normalizeSelector,
  normalizeValue,
  normalizeParams,
  specificity,
  isStyleAttrSelector,
  styleAttrsOf,
  touched,
  parseSheet,
  diffEntries,
  diffOrder,
  isAdditive,
  loadAllow,
  matches,
};

if (import.meta.main) {
  // exitCode, not exit(): a large --json written to a pipe must drain first
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(e instanceof Error ? e.stack : e);
      process.exitCode = 2;
    },
  );
}
