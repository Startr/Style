// WCAG contrast, and a small resolver for the colour tokens in src/variables.css.
//
// The tests use it two ways: on colours the browser computed ("rgb(116, 116, 116)"),
// and on the source, where a token like --text-bright is
// color-mix(in srgb, var(--black) 64%, var(--white) 36%) and the answer has to come
// from the file, with no browser. The resolver reads only what variables.css uses:
// hsl()/hsla(), #hex, var(), and color-mix(in srgb, A p%, B q%). Alpha is dropped.

export type RGB = [number, number, number];

/** sRGB channels (0-255, may be fractional) from hue 0-360, saturation and lightness 0-100. */
export function hslToRgb(h: number, s: number, l: number): RGB {
  const S = s / 100;
  const L = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** WCAG 2 relative luminance. */
export function luminance([r, g, b]: RGB): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2 contrast ratio, 1 to 21, whichever colour is lighter. */
export function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** A colour the browser serializes: rgb()/rgba(), color(srgb ...) or #hex. */
export function parseColor(css: string): RGB {
  const s = css.trim();
  let m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  m = s.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (m) return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255];
  m = s.match(/^#([0-9a-f]{6})/i);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as RGB;
  throw new Error(`cannot read colour: ${css}`);
}

/** Mix two colours in sRGB with the weights color-mix() would normalise (they need not sum to 100). */
export function mixSrgb(a: RGB, pa: number, b: RGB, pb: number): RGB {
  const total = pa + pb;
  return a.map((v, i) => (v * pa + b[i] * pb) / total) as RGB;
}

// --- the source ---------------------------------------------------------------------------------

/** The declarations of the first block whose selector is exactly `selector`: name -> value. */
export function blockOf(css: string, selector: string): Map<string, string> {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(stripped);
  if (!m) throw new Error(`no ${selector} block`);
  const out = new Map<string, string>();
  for (const decl of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(decl[1], decl[2].trim());
  return out;
}

/** The token map for a theme: :root, and for dark the [data-theme="dark"] block on top of it. */
export function tokens(css: string, theme: "light" | "dark"): Map<string, string> {
  const map = blockOf(css, ":root");
  if (theme === "dark") for (const [k, v] of blockOf(css, '[data-theme="dark"]')) map.set(k, v);
  return map;
}

/** Split on commas that are not inside parentheses. */
function splitTop(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") depth--;
    else if (text[i] === "," && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts;
}

/** A value from variables.css to a colour, following var() through `map`. */
export function resolve(value: string, map: Map<string, string>): RGB {
  const v = value.trim();
  let m = v.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (m) {
    const next = map.get(m[1]);
    if (next === undefined) throw new Error(`${m[1]} is not defined`);
    return resolve(next, map);
  }
  m = v.match(/^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/);
  if (m) return hslToRgb(Number(m[1]), Number(m[2]), Number(m[3]));
  if (/^#[0-9a-f]{6}$/i.test(v)) return parseColor(v);
  m = v.match(/^color-mix\(\s*in srgb\s*,(.*)\)$/s);
  if (m) {
    const [a, b] = splitTop(m[1]);
    const side = (part: string): [RGB, number] => {
      const pm = part.match(/^(.*?)\s+([\d.]+)%$/s);
      if (!pm) throw new Error(`color-mix side needs a percentage: ${part}`);
      return [resolve(pm[1], map), Number(pm[2])];
    };
    const [ca, pa] = side(a);
    const [cb, pb] = side(b);
    return mixSrgb(ca, pa, cb, pb);
  }
  throw new Error(`cannot resolve: ${value}`);
}

/** A named token in a theme, as a colour. */
export function token(css: string, theme: "light" | "dark", name: string): RGB {
  const map = tokens(css, theme);
  const value = map.get(name);
  if (value === undefined) throw new Error(`${name} is not defined in ${theme}`);
  return resolve(value, map);
}

/** [r, g, b, alpha 0-1] from what Chrome serializes: rgb(), rgba(), color(srgb r g b / a). */
export function parseRgba(css: string): [number, number, number, number] {
  const s = css.trim();
  let m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), alpha(m[4])];
  m = s.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?))?\s*\)$/);
  if (m) return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255, alpha(m[4])];
  throw new Error(`cannot read colour: ${css}`);
}

function alpha(text: string | undefined): number {
  if (text === undefined) return 1;
  return text.endsWith("%") ? Number(text.slice(0, -1)) / 100 : Number(text);
}

/** A colour with alpha painted over an opaque one. */
export function over(top: [number, number, number, number], under: RGB): RGB {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)) as RGB;
}
