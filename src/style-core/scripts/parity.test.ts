import { describe, expect, test } from "bun:test";
import {
  normalizeSelector,
  normalizeValue,
  normalizeParams,
  specificity,
  isStyleAttrSelector,
  touched,
  parseSheet,
  diffEntries,
  diffOrder,
  isAdditive,
} from "./parity";

const sheet = (css: string) => parseSheet("t.css", css);
const kinds = (p: string, c: string) => {
  const P = sheet(p);
  const C = sheet(c);
  return [...diffEntries(P, C), ...diffOrder(P, C)].map(
    (i) => `${i.kind}:${i.media}|${i.selector}|${i.prop}`,
  );
};

describe("normalize", () => {
  test("selectors", () => {
    expect(normalizeSelector("a  >  b")).toBe("a>b");
    expect(normalizeSelector("a > b c + d")).toBe("a>b c+d");
    expect(normalizeSelector("[style*='--p:']")).toBe('[style*="--p:"]');
    expect(normalizeSelector("[ style *= \"--p:\" ]")).toBe('[style*="--p:"]');
    expect(normalizeSelector("a:before")).toBe("a::before");
    expect(normalizeSelector("a::before")).toBe("a::before");
    expect(normalizeSelector(":is( a , b ) > c")).toBe(":is(a,b)>c");
    expect(normalizeSelector("li:nth-child( 2n + 1 )")).toBe("li:nth-child(2n+1)");
    expect(normalizeSelector(".group:not(.vertical) > * + *")).toBe(".group:not(.vertical)>*+*");
    expect(normalizeSelector("details[open]   >   summary")).toBe("details[open]>summary");
  });
  test("values", () => {
    expect(normalizeValue("rgba( 0, 0 , 0 ,  .5 )")).toBe("rgba(0,0,0,.5)");
    expect(normalizeValue('"a  b" ,  c')).toBe('"a  b",c');
    expect(normalizeValue("1px   solid\n  red")).toBe("1px solid red");
    expect(normalizeValue("calc(1 + 2)")).toBe("calc(1 + 2)");
    expect(normalizeValue('url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'x\' %3E")')).toBe(
      'url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'x\' %3E")',
    );
  });
  test("media params", () => {
    expect(normalizeParams("media", "only screen and (min-width: 1024px)")).toBe(
      "only screen and (min-width:1024px)",
    );
    expect(normalizeParams("media", "Only  Screen and ( min-width : 640px )")).toBe(
      "only screen and (min-width:640px)",
    );
    expect(normalizeParams("keyframes", "Spin")).toBe("Spin");
  });
});

describe("specificity", () => {
  const s = (x: string) => specificity(x).join(",");
  test("basics", () => {
    expect(s(".a.b")).toBe("0,2,0");
    expect(s("#a .b")).toBe("1,1,0");
    expect(s("a:hover::before")).toBe("0,1,2");
    expect(s(":where(.a)")).toBe("0,0,0");
    expect(s(":is(.a,#b)")).toBe("1,0,0");
    expect(s(":not(.a)")).toBe("0,1,0");
    expect(s('[style*="--x:"]:hover')).toBe("0,2,0");
    expect(s('[style][style*="--c:"]:focus-visible')).toBe("0,3,0");
    expect(s(".px-3.max-h-64.overflow-y-auto.scrollbar-hidden.group.relative")).toBe("0,6,0");
    expect(s("html")).toBe("0,0,1");
    expect(s("*")).toBe("0,0,0");
    expect(s("ul li a")).toBe("0,0,3");
    expect(s("li:nth-child(2n+1)")).toBe("0,1,1");
    expect(s(":is(details[open],[aria-current])>[style*=\"--c-in-on:\"]")).toBe("0,2,1");
  });
  test("style attribute subject", () => {
    expect(isStyleAttrSelector('[style*="--p:"]')).toBe(true);
    expect(isStyleAttrSelector('[style*="--bg-hover:"]:hover')).toBe(true);
    expect(isStyleAttrSelector('[style][style*="--c-focus:"]:focus-visible')).toBe(true);
    expect(isStyleAttrSelector(':is(details[open],[aria-current])>[style*="--c-in-on:"]')).toBe(true);
    expect(isStyleAttrSelector('[style*="--a:"] .child')).toBe(false);
    expect(isStyleAttrSelector(".card")).toBe(false);
    expect(isStyleAttrSelector(":dir(rtl)")).toBe(false);
    expect(isStyleAttrSelector("[data-x]")).toBe(false);
  });
  test("shorthands", () => {
    expect(touched("border")).toContain("border-right");
    expect(touched("border")).toContain("border-right-width");
    expect(touched("-webkit-filter")).toEqual(["filter"]);
    expect(touched("gap")).toContain("row-gap");
    expect(touched("--x")).toEqual(["--x"]);
    expect(touched("padding-top")).toEqual(["padding-top"]);
  });
});

describe("diff", () => {
  test("identical", () => {
    const css = `[style*="--p:"]{padding:var(--p)!important}@media print{[style*="--p-pt:"]{padding:var(--p-pt)!important}}`;
    expect(kinds(css, css)).toEqual([]);
  });
  test("whitespace and comments do not count", () => {
    const a = `a , b {\n  color : red ; /* c */\n}`;
    const b = `a,b{color:red}`;
    expect(kinds(a, b)).toEqual([]);
  });
  test("missing and extra, selector lists split", () => {
    expect(kinds(`a,b{color:red}`, `a{color:red}`)).toEqual(["missing:|b|color"]);
    expect(kinds(`a{color:red}`, `a,b{color:red}`)).toEqual(["extra:|b|color"]);
  });
  test("missing and extra declarations in a shared key", () => {
    expect(kinds(`a{color:red;top:0}`, `a{color:red}`)).toEqual(["missing:|a|top"]);
    expect(kinds(`a{color:red}`, `a{color:red;top:0}`)).toEqual(["extra:|a|top"]);
  });
  test("changed value and importance", () => {
    expect(kinds(`a{color:red}`, `a{color:blue}`)).toEqual(["changed:|a|color"]);
    expect(kinds(`a{color:red}`, `a{color:red!important}`)).toEqual(["changed:|a|color"]);
  });
  test("repeat counts: P has --ct twice", () => {
    const p = `[style*="--ct:"]{content:var(--ct)!important}x{top:0}[style*="--ct:"]{content:var(--ct)!important}`;
    const c = `[style*="--ct:"]{content:var(--ct)!important}x{top:0}`;
    expect(kinds(p, c)).toEqual(['missing:|[style*="--ct:"]|content']);
    expect(kinds(c, p)).toEqual(['extra:|[style*="--ct:"]|content']);
  });
  test("media chain is part of the key", () => {
    const p = `@media only screen and (min-width: 640px){a{color:red}}`;
    const c = `@media only screen and (min-width:640px){a{color:red}}`;
    expect(kinds(p, c)).toEqual([]);
    expect(kinds(p, `@media (min-width:640px){a{color:red}}`).sort()).toEqual([
      "extra:@media (min-width:640px)|a|color",
      "missing:@media only screen and (min-width:640px)|a|color",
    ]);
  });
  test("keyframes and at-rules with declarations", () => {
    const p = `@keyframes spin{100%{transform:rotate(360deg)}}@property --x{syntax:"<number>";inherits:false;initial-value:0}`;
    expect(kinds(p, p)).toEqual([]);
    expect(kinds(p, `@property --x{syntax:"<number>";inherits:false;initial-value:1}`)).toEqual(
      expect.arrayContaining(["changed:|@property --x|initial-value", "missing:@keyframes spin|100%|transform"]),
    );
  });
  test("statement at-rules", () => {
    expect(kinds(`@import url('/a.css');a{b:c}`, `a{b:c}`)).toEqual(["missing:|@import url('/a.css')|"]);
  });
});

describe("order", () => {
  test("swapped pair: --br radius then right, --radius between", () => {
    const p = `[style*="--br:"]{border-radius:var(--br)!important}[style*="--radius:"]{border-radius:var(--radius)!important}`;
    const c = `[style*="--radius:"]{border-radius:var(--radius)!important}[style*="--br:"]{border-radius:var(--br)!important}`;
    const r = kinds(p, c);
    expect(r.length).toBe(1);
    expect(r[0]).toMatch(/^order:\|.*\|border-radius$/);
  });
  test("same order passes", () => {
    const css = `[style*="--br:"]{border-radius:var(--br)!important}[style*="--radius:"]{border-radius:var(--radius)!important}`;
    expect(kinds(css, css)).toEqual([]);
  });
  test("shorthand/longhand flip: border vs border-right", () => {
    const p = `[style*="--b:"]{border:var(--b)!important}[style*="--br:"]{border-right:var(--br)!important}`;
    const c = `[style*="--br:"]{border-right:var(--br)!important}[style*="--b:"]{border:var(--b)!important}`;
    const r = kinds(p, c);
    expect(r.some((x) => x.endsWith("|border-right"))).toBe(true);
  });
  test("different importance never conflicts", () => {
    const p = `a{color:red}b{color:blue!important}`;
    const c = `b{color:blue!important}a{color:red}`;
    expect(kinds(p, c)).toEqual([]);
  });
  test("different specificity never conflicts", () => {
    const p = `.a.b.c{color:red}p{color:blue}`;
    const c = `p{color:blue}.a.b.c{color:red}`;
    expect(kinds(p, c)).toEqual([]);
  });
  test("equal specificity conflicts", () => {
    const p = `.a{color:red}.b{color:blue}`;
    const c = `.b{color:blue}.a{color:red}`;
    expect(kinds(p, c).length).toBe(1);
  });
  test("extras and missing do not cause order noise", () => {
    const p = `.a{color:red}.b{color:blue}`;
    const c = `.a{color:red}.x{color:green}.b{color:blue}`;
    expect(kinds(p, c)).toEqual(["extra:|.x|color"]);
  });
  test("a media block moved above the base rule is an order difference", () => {
    const p = `[style*="--p:"]{padding:1px!important}@media (min-width:640px){[style*="--p-sm:"]{padding:2px!important}}`;
    const c = `@media (min-width:640px){[style*="--p-sm:"]{padding:2px!important}}[style*="--p:"]{padding:1px!important}`;
    const r = kinds(p, c);
    expect(r.length).toBe(1);
    expect(r[0].startsWith("order:")).toBe(true);
  });
  test("keyframes do not take part in the cascade", () => {
    const p = `@keyframes a{from{opacity:0}}@keyframes b{from{opacity:1}}`;
    const c = `@keyframes b{from{opacity:1}}@keyframes a{from{opacity:0}}`;
    expect(kinds(p, c)).toEqual([]);
  });
  test("the same selector twice for different props keeps its slot", () => {
    // --fs: flex-shrink first, font-style later (P:904, P:1141)
    const p = `[style*="--fs:"]{flex-shrink:var(--fs)!important}[style*="--x:"]{font-style:var(--x)!important}[style*="--fs:"]{font-style:var(--fs)!important}`;
    const same = p;
    expect(kinds(p, same)).toEqual([]);
    const flipped = `[style*="--fs:"]{font-style:var(--fs)!important}[style*="--x:"]{font-style:var(--x)!important}[style*="--fs:"]{flex-shrink:var(--fs)!important}`;
    const r = kinds(p, flipped);
    expect(r.some((x) => x.startsWith("order:") && x.endsWith("|font-style"))).toBe(true);
  });
});

describe("selector splitting edge cases", () => {
  test("a leading combinator does not leak", () => {
    expect(normalizeSelector("> a b")).toBe("a b");
    expect(normalizeSelector("  a   b  ")).toBe("a b");
  });
  test("escapes", () => {
    expect(normalizeSelector(".sm\\:px-4 > .x")).toBe(".sm\\:px-4>.x");
  });
});

describe("inside one rule", () => {
  test("shorthand then longhand is not longhand then shorthand", () => {
    const r = kinds(`a{padding:1px;padding-top:2px}`, `a{padding-top:2px;padding:1px}`);
    expect(r.length).toBe(1);
    expect(r[0].startsWith("order:|a|")).toBe(true);
  });
  test("same order passes", () => {
    expect(kinds(`a{padding:1px;padding-top:2px}`, `a{padding:1px;padding-top:2px}`)).toEqual([]);
  });
  test("unrelated properties may swap", () => {
    expect(kinds(`a{color:red;top:0}`, `a{top:0;color:red}`)).toEqual([]);
  });
  test("fallback declarations keep their order", () => {
    const p = `a{display:-webkit-box;display:flex}`;
    expect(kinds(p, p)).toEqual([]);
    expect(kinds(p, `a{display:flex;display:-webkit-box}`)).toEqual(["changed:|a|display"]);
  });
  test("a removed prefix is not an order difference", () => {
    expect(kinds(`a{-webkit-filter:x;filter:x}`, `a{filter:x}`)).toEqual(["missing:|a|-webkit-filter"]);
  });
});


describe("additive", () => {
  const extras = (p: string, c: string) => {
    const P = sheet(p);
    return diffEntries(P, sheet(c)).map((i) => ({ i, add: isAdditive(i, P) }));
  };
  test("style-prop forms", () => {
    expect(isStyleAttrSelector('[style]:is([style*="--anim:"],[style*="--anim-sm:"])')).toBe(true);
    expect(isStyleAttrSelector('[style]:is([style*="--a:"],.foo)')).toBe(false);
    expect(isStyleAttrSelector(':where([style*="--a:"])')).toBe(true);
    expect(isStyleAttrSelector(':not([style*="--a:"])')).toBe(false);
    expect(isStyleAttrSelector(':is(details[open],[aria-current])>[style*="--c-in-on:"]')).toBe(true);
  });
  test("a new rule on a style prop passes", () => {
    const r = extras(`a{b:c}`, `a{b:c}[style*="--x-hover:"]:hover{color:red!important}`);
    expect(r.map((x) => x.add)).toEqual([true]);
  });
  test("an extra line in one of P's own rules does not", () => {
    const r = extras(`[style*="--c:"]{color:var(--c)!important}`, `[style*="--c:"]{color:var(--c)!important;transition:none}`);
    expect(r.map((x) => [x.i.kind, x.add])).toEqual([["extra", false]]);
  });
  test("keyframes: a new name passes, a new frame in P's own does not", () => {
    const p = `@keyframes spin{100%{transform:rotate(360deg)}}`;
    expect(extras(p, p + `@keyframes st-fade{from{opacity:0}}`).map((x) => x.add)).toEqual([true]);
    expect(extras(p, `@keyframes spin{from{opacity:0}100%{transform:rotate(360deg)}}`).map((x) => x.add)).toEqual([false]);
  });
  test("tokens: a new one in :root passes, a repeat of one P has does not", () => {
    const p = `:root{--a:1}`;
    expect(extras(p, `:root{--a:1;--b:2}`).map((x) => x.add)).toEqual([true]);
    expect(extras(p, `:root{--a:1;--a:2}`).map((x) => x.add)).toEqual([false]);
    expect(extras(p, `:root{--a:1}[data-theme=dark]{--b:2}`).map((x) => x.add)).toEqual([false]);
  });
  test("a prop P switched off in a comment is not growth", () => {
    const p = `/*[style*="--maxw-sm:"]{max-width:var(--maxw-sm)!important}*/a{b:c}`;
    expect(extras(p, `a{b:c}[style*="--maxw-sm:"]{max-width:var(--maxw-sm)!important}`).map((x) => x.add)).toEqual([false]);
  });
});

describe("logical sides", () => {
  test("touched", () => {
    expect(touched("padding-inline-start")).toEqual(["padding-left"]);
    expect(touched("-webkit-padding-start")).toEqual(["padding-left"]);
    expect(touched("margin-block")).toEqual(["margin-block", "margin-top", "margin-bottom"]);
    expect(touched("padding")).toContain("padding-left");
  });
  test("--px and --pl run in one order or the other", () => {
    const p = `[style*="--pl:"]{padding-left:var(--pl)}[style*="--px:"]{padding-inline-start:var(--px)}`;
    const c = `[style*="--px:"]{padding-inline-start:var(--px)}[style*="--pl:"]{padding-left:var(--pl)}`;
    expect(kinds(p, p)).toEqual([]);
    const r = kinds(p, c);
    expect(r.length).toBe(1);
    expect(r[0].startsWith("order:")).toBe(true);
  });
});
