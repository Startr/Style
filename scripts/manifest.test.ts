/**
 * Guards for scripts/manifest.ts and the props.json step in build.ts. Run with `bun test scripts`.
 *
 * Fixture tests feed small sheets from test/fixtures/manifest-*.css to buildManifest(). The "built sheet" suite runs the real build into a temp dir, then checks that props.json and startr.css agree both ways. It is the gate: build.ts only warns when the manifest step fails, and this suite does not.
 *
 * MANIFEST_DIST=<dir> skips the build and reads <dir>/startr.css and <dir>/props.json instead.
 * MANIFEST_STRICT=1 fails the run when a deprecated name's replacement is missing from the sheet. Without it, the run reports them and passes.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postcss from "postcss";
import { allNames, buildManifest, DEPRECATED, formatManifest, resolveName, STATES, TIERS, type Manifest } from "./manifest.ts";

const ROOT = join(import.meta.dir, "..");
const fixture = (name: string) => readFileSync(join(ROOT, "test/fixtures", name), "utf8");
const BUILD_TIMEOUT = 120_000;

// The old grammar and its replacements, as the plan lists them. A second copy on purpose: a typo in manifest.ts fails here.
const DEPRECATED_TABLE: Record<string, string> = {
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

// Names that feed two properties from separate rules today. They wait for 2.0.
const KNOWN_COLLISIONS: Record<string, string[]> = {
  "--br": ["border-radius", "border-right"],
  "--bs": ["border-style", "box-shadow"],
  "--cr": ["clear", "column-rule"],
  "--fs": ["flex-shrink", "font-style"],
  "--td": ["text-decoration", "transition-delay"],
};

const ENTRY_KEY_ORDER = ["properties", "kind", "tiers", "states", "requires_suffix", "reads", "collision", "deprecated"];

describe("tiers and names (fixture)", () => {
  const m = buildManifest(fixture("manifest-props.css"));

  test("a width tier needs the min-width query and the matching suffix", () => {
    expect(m.props["--p"].tiers).toEqual(["sm", "md", "lg", "xl", "pt"]);
    expect(m.props["--p-sm"]).toBeUndefined();
    expect(m.breakpoints).toEqual({ xs: 440, sm: 640, md: 768, lg: 1024, xl: 1280 });
  });

  test("--pt is padding-top, and only --pt-pt inside @media print is its print tier", () => {
    expect(m.props["--pt"]).toEqual({ properties: ["padding-top"], kind: "prop", tiers: ["pt"], states: [] });
  });

  test("a tier suffix outside any query is a prop of its own", () => {
    expect(m.props["--maxw-sm"]).toEqual({ properties: ["max-width"], kind: "prop", tiers: [], states: [] });
  });

  test("grid props with tiers and no bare rule require a suffix", () => {
    expect(m.props["--col"]).toMatchObject({ tiers: ["xs", "lg"], requires_suffix: true });
    expect(m.props["--sc"]).toMatchObject({ tiers: ["xs"], requires_suffix: true });
    expect(m.props["--p"].requires_suffix).toBeUndefined();
  });

  test("keyframes, comments and style selectors without a colon yield nothing", () => {
    const names = Object.keys(m.props);
    expect(names).not.toContain("--commented");
    expect(names).not.toContain("color");
    expect(names.some((name) => name.includes("spin"))).toBe(false);
  });

  test("a single-dash name is reported once and is no prop", () => {
    expect(m.warnings).toEqual(["invalid-name: -ttf (a style selector must name a custom property that starts with --)"]);
    expect(Object.keys(m.props).some((name) => name.startsWith("-ttf") || name === "-")).toBe(false);
  });

  test("names inside :is() are conditions: the reduced-motion rule changes nothing", () => {
    expect(m.props["--anim"]).toEqual({ properties: ["animation"], kind: "prop", tiers: [], states: [] });
    expect(m.props["--tn"]).toEqual({ properties: ["transition"], kind: "prop", tiers: [], states: [] });
    expect(m.props["-hvr"]).toBeUndefined();
    expect(m.props["-hover"]).toBeUndefined();
  });

  test("a bare --pt inside @media print is not a dash plus a print tier", () => {
    const odd = buildManifest('@media print { [style*="--pt:"] { color: red; } }');
    expect(Object.keys(odd.props)).toEqual(["--pt"]);
    expect(odd.props["--pt"].tiers).toEqual([]);
    expect(odd.warnings).toEqual([]);
  });

  test("a base that has only tiers still requires a suffix when it also has a state", () => {
    const tiered = buildManifest(
      `@media (min-width:640px) { [style*="--z-sm:"] { color: var(--z-sm); } }
       @media (hover:hover) { [style*="--z-hover:"]:hover { color: var(--z-hover); } }`,
    );
    expect(tiered.props["--z"]).toEqual({ properties: ["color"], kind: "prop", tiers: ["sm"], states: ["hover"], requires_suffix: true });
  });

  test("an empty sheet gives an empty manifest", () => {
    const empty = buildManifest("");
    expect(empty.props).toEqual({});
    expect(empty.tokens).toEqual({});
    expect(empty.breakpoints).toEqual({});
    expect(empty.warnings).toEqual([]);
  });

  test("a width suffix in a different query than the others is reported", () => {
    const odd = buildManifest(
      `@media (min-width:640px) { [style*="--q-sm:"] { color: var(--q-sm); } }
       @media (min-width:640px) { [style*="--r-sm:"] { color: var(--r-sm); } }
       @media (min-width:700px) { [style*="--s-sm:"] { color: var(--s-sm); } }`,
    );
    expect(odd.breakpoints.sm).toBe(640);
    expect(odd.warnings).toEqual(["breakpoint-conflict: sm appears at 640px and 700px"]);
  });
});

describe("properties and kind (fixture)", () => {
  const m = buildManifest(fixture("manifest-props.css"));

  test("vendor twins fold into the property they copy, and a lone prefix stays", () => {
    expect(m.props["--us"].properties).toEqual(["user-select"]);
    expect(m.props["--line-clamp"].properties).toEqual(["-webkit-box-orient", "-webkit-line-clamp", "display", "overflow"]);
  });

  test("a pass-through is a prop, with or without a fallback", () => {
    expect(m.props["--p"].kind).toBe("prop");
    expect(m.props["--cur"]).toMatchObject({ properties: ["cursor"], kind: "prop" });
    expect(m.props["--hvr-bg"]).toMatchObject({ properties: ["background"], kind: "prop" });
  });

  test("one rule with many properties is still a prop", () => {
    expect(m.props["--px"]).toMatchObject({ properties: ["padding-inline-end", "padding-inline-start"], kind: "prop" });
    expect(m.props["--inset"]).toMatchObject({ properties: ["bottom", "left", "right", "top"], kind: "prop" });
    expect(m.props["--px"].collision).toBeUndefined();
    expect(m.props["--inset"].collision).toBeUndefined();
  });

  test("a formula, another token, a literal or a custom-property output makes a helper", () => {
    expect(m.props["--levitate"]).toMatchObject({ properties: ["box-shadow", "transform"], kind: "helper" });
    expect(m.props["--grid-cols"].kind).toBe("helper");
    expect(m.props["--shadow-hvr"]).toMatchObject({ properties: ["box-shadow", "transition"], kind: "helper" });
    expect(m.props["--line-clamp"].kind).toBe("helper");
    expect(m.props["--wrapper"]).toMatchObject({ properties: ["--gutter", "margin-left", "max-width", "padding-left"], kind: "helper" });
    expect(m.props["--mix"]).toEqual({ properties: ["--mixed"], kind: "helper", tiers: [], states: [] });
  });

  test("a grouped selector gives every name the same formula", () => {
    expect(m.props["--translate"]).toMatchObject({ properties: ["transform"], kind: "helper" });
    expect(m.props["--scale"]).toMatchObject({ properties: ["transform"], kind: "helper" });
  });

  test("a rule that only copies the value into another custom property is a helper", () => {
    expect(m.props["--alias"]).toEqual({ properties: ["--target"], kind: "helper", tiers: [], states: [] });
  });

  test("reads lists the extra inputs a helper takes, and only those", () => {
    expect(m.props["--tone"].reads).toEqual(["--tone-of"]);
    expect(m.props["--grad"].reads).toEqual(["--grad-color"]);
    expect(m.props["--wrapper"].reads).toEqual(["--gutter", "--gutter-sm"]);
    // tokens, other props, private names and the name itself are not extra inputs
    expect(m.props["--cur"].reads).toBeUndefined();
    expect(m.props["--shadow-hvr"].reads).toBeUndefined();
    expect(m.props["--levitate"].reads).toBeUndefined();
    expect(m.props["--translate"].reads).toBeUndefined();
    expect(m.props["--glow"].reads).toBeUndefined();
  });

  test("private --_ outputs stay out of properties but still make a helper", () => {
    expect(m.props["--glow"]).toMatchObject({ properties: ["box-shadow"], kind: "helper" });
  });
});

describe("collisions (fixture)", () => {
  const m = buildManifest(fixture("manifest-props.css"));

  test("one name, two properties, two rules", () => {
    expect(m.props["--br"].collision).toEqual(["border-radius", "border-right"]);
    expect(m.props["--td"].collision).toEqual(["text-decoration", "transition-delay"]);
  });

  test("the same property in two rules is a duplicate, not a collision", () => {
    expect(m.props["--ct"].collision).toBeUndefined();
  });

  test("a rule that adds a property to another rule's set is not a collision", () => {
    expect(m.props["--nest"].collision).toBeUndefined();
  });

  test("only the colliding names carry the field", () => {
    const flagged = Object.keys(m.props).filter((name) => m.props[name].collision);
    expect(flagged).toEqual(["--br", "--td"]);
  });
});

describe("states (fixture)", () => {
  const m = buildManifest(fixture("manifest-states.css"));

  test("a state is a suffix on a name that exists", () => {
    expect(m.props["--bg"].states).toEqual(["hover", "focus", "active", "on", "in-on", "in-hover"]);
    expect(m.props["--bg"].tiers).toEqual(["md"]);
    expect(m.props["--bg-hover"]).toBeUndefined();
  });

  test("each prop lists only the states it has", () => {
    expect(m.props["--c"].states).toEqual(["hover", "in-on"]);
    expect(m.props["--oe"].states).toEqual(["hover"]);
    expect(m.props["--oo"].states).toEqual([]);
  });

  test("in-on is not read as on", () => {
    expect(m.props["--c"].states).toContain("in-on");
    expect(m.props["--c-in"]).toBeUndefined();
    expect(resolveName(m, "--c-in-on")).toEqual({ base: "--c", state: "in-on" });
  });

  test("a state-looking name with no base is a prop of its own", () => {
    expect(m.props["--button-hover"]).toEqual({ properties: ["background"], kind: "prop", tiers: [], states: [] });
    expect(m.props["--button"]).toBeUndefined();
  });

  test("a state rule is a plain pass-through, so the prop stays a prop and nothing collides", () => {
    expect(m.props["--bg"].kind).toBe("prop");
    expect(m.props["--bg"].collision).toBeUndefined();
  });

  test("the old grammar keeps its own name and points at the replacement", () => {
    expect(m.props["--hvr-bg"].deprecated).toBe("--bg-hover");
    expect(resolveName(m, "--bg-hover")).toEqual({ base: "--bg", state: "hover" });
  });

  test("a name with both a tier and a state is reported", () => {
    const combo = buildManifest(
      `[style*="--k:"] { color: var(--k); }
       @media (hover:hover) { [style*="--k-hover:"]:hover { color: var(--k-hover); } }
       @media (min-width:768px) { [style*="--k-hover-md:"]:hover { color: var(--k-hover-md); } }`,
    );
    expect(combo.warnings.some((warning) => warning.startsWith("combo-name: --k-hover-md"))).toBe(true);
  });
});

describe("resolveName", () => {
  const m = buildManifest(`${fixture("manifest-props.css")}\n${fixture("manifest-states.css")}`);

  test("a key, a key plus a tier, a key plus a state", () => {
    expect(resolveName(m, "--p")).toEqual({ base: "--p" });
    expect(resolveName(m, "--p-md")).toEqual({ base: "--p", tier: "md" });
    expect(resolveName(m, "--c-hover")).toEqual({ base: "--c", state: "hover" });
    expect(resolveName(m, "--pt-pt")).toEqual({ base: "--pt", tier: "pt" });
    expect(resolveName(m, "--maxw-sm")).toEqual({ base: "--maxw-sm" });
  });

  test("allNames lists every spelling once, and resolveName reads each one back", () => {
    const names = allNames(m);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("--p-md");
    expect(names).toContain("--c-in-on");
    expect(names).not.toContain("--col");
    expect(names).toContain("--col-xs");
    for (const name of names) expect(resolveName(m, name), name).not.toBeNull();
  });

  test("a suffix the prop does not have is unknown", () => {
    expect(resolveName(m, "--c-focus")).toBeNull();
    expect(resolveName(m, "--us-md")).toBeNull();
    expect(resolveName(m, "--oo-hover")).toBeNull();
    expect(resolveName(m, "--c-hover-md")).toBeNull();
  });

  test("a typo and the Object prototype are unknown", () => {
    expect(resolveName(m, "--padding")).toBeNull();
    expect(resolveName(m, "constructor")).toBeNull();
    expect(resolveName(m, "__proto__")).toBeNull();
    expect(resolveName(m, "toString")).toBeNull();
  });
});

describe("tokens (fixture)", () => {
  const m = buildManifest(fixture("manifest-tokens.css"));
  const type = (name: string) => m.tokens[name]?.type;

  test("colors", () => {
    for (const name of ["--primary", "--white", "--named", "--blend", "--pair"]) expect(type(name)).toBe("color");
  });

  test("a var() takes the type of what it points at, and a loop is other", () => {
    expect(type("--accent")).toBe("color");
    expect(type("--fallback")).toBe("length");
    expect(type("--loop-a")).toBe("other");
    expect(type("--loop-b")).toBe("other");
  });

  test("lengths, including calc, min, max and clamp over lengths", () => {
    for (const name of ["--base-size", "--pct", "--space-2", "--measure", "--fluid"]) expect(type(name)).toBe("length");
  });

  test("numbers, including a calc of numbers", () => {
    for (const name of ["--ratio", "--zero", "--count", "--scaled", "--on-html"]) expect(type(name)).toBe("number");
  });

  test("everything else is other", () => {
    for (const name of ["--dur", "--ease", "--font-sans", "--shadow", "--arrow"]) expect(type(name)).toBe("other");
  });

  test("a dark-mode override never changes the type, but adds tokens that only it declares", () => {
    expect(type("--primary")).toBe("color");
    expect(type("--dark-only")).toBe("color");
  });

  test(":root, html and :root with a qualifier count", () => {
    expect(type("--on-html")).toBe("number");
    expect(type("--themed")).toBe("color");
    expect(type("--dark-theme")).toBe("color");
  });

  test("private, scoped and nested custom properties do not", () => {
    for (const name of ["--_private", "--scoped-override", "--card-gap", "--nested"]) expect(m.tokens[name]).toBeUndefined();
  });

  test("props and tokens are separate lists, and a name may be in both", () => {
    expect(Object.keys(m.props)).toEqual([]);
    const both = buildManifest(`:root { --wrapper: 960px; }\n[style*="--wrapper:"] { max-width: var(--wrapper); margin-left: auto; }`);
    expect(both.tokens["--wrapper"]).toEqual({ type: "length" });
    expect(both.props["--wrapper"].kind).toBe("helper");
  });
});

describe("output (fixture)", () => {
  const css = fixture("manifest-props.css");

  test("the same sheet gives the same bytes", () => {
    expect(formatManifest(buildManifest(css))).toBe(formatManifest(buildManifest(css)));
  });

  test("rule order in the sheet does not change props or breakpoints", () => {
    const root = postcss.parse(css);
    const nodes = [...root.nodes].reverse();
    root.removeAll();
    for (const node of nodes) root.append(node);
    const flipped = buildManifest(root.toString());
    const straight = buildManifest(css);
    expect(flipped.props).toEqual(straight.props);
    expect(flipped.breakpoints).toEqual(straight.breakpoints);
    expect(flipped.warnings).toEqual(straight.warnings);
  });

  test("generated_from hashes the exact text it was given", () => {
    const m = buildManifest(css, { file: "x.css" });
    expect(m.generated_from).toEqual({ file: "x.css", sha256: createHash("sha256").update(css).digest("hex") });
  });

  test("props.json text parses back to the manifest, one prop or token per line, with a final newline", () => {
    const m = buildManifest(css);
    const text = formatManifest(m);
    expect(JSON.parse(text)).toEqual(m);
    expect(text.endsWith("}\n")).toBe(true);
    const lines = text.split("\n").filter((line) => line.startsWith('    "--'));
    expect(lines.length).toBe(Object.keys(m.props).length + Object.keys(m.tokens).length);
    expect(Object.keys(JSON.parse(text))).toEqual(Object.keys(m));
  });

  test("an empty manifest is valid JSON", () => {
    const text = formatManifest(buildManifest(""));
    expect(JSON.parse(text).props).toEqual({});
  });

  test("the schema has eight entry keys, in a fixed order", () => {
    const m = buildManifest(`${css}\n${fixture("manifest-states.css")}`);
    const keys = new Set<string>();
    for (const entry of Object.values(m.props)) {
      for (const key of Object.keys(entry)) keys.add(key);
      expect(Object.keys(entry)).toEqual(ENTRY_KEY_ORDER.filter((key) => key in entry));
    }
    expect([...keys].sort()).toEqual([...ENTRY_KEY_ORDER].sort());
  });

  test("the command line writes the same text", () => {
    const run = Bun.spawnSync([process.execPath, join(ROOT, "scripts/manifest.ts"), join(ROOT, "test/fixtures/manifest-states.css")], { stdout: "pipe" });
    expect(run.exitCode).toBe(0);
    const out = JSON.parse(run.stdout.toString()) as Manifest;
    expect(out.generated_from.file).toBe("manifest-states.css");
    expect(out.props).toEqual(buildManifest(fixture("manifest-states.css")).props);
  });
});

// A second reader of the sheet, on purpose: plain text scanning, no PostCSS. If the two disagree, one is wrong.
function scanNames(css: string): { defined: Set<string>; conditions: Set<string> } {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const defined = new Set<string>();
  const conditions = new Set<string>();
  for (const match of text.matchAll(/\[style\*=(["'])([^"']*?):\1\]/g)) {
    let start = match.index!;
    while (start > 0 && !"{};".includes(text[start - 1])) start--;
    let depth = 0;
    for (const ch of text.slice(start, match.index)) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
    }
    (depth > 0 ? conditions : defined).add(match[2]);
  }
  return { defined, conditions };
}

function scanRootTokens(css: string): Set<string> {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found = new Set<string>();
  for (const block of text.matchAll(/(?:^|[{};]\s*)(?::root|html)(?:\[[^\]]*\]|:[\w-]+(?:\([^)]*\))?)*\s*\{([^{}]*)\}/g)) {
    for (const decl of block[1].matchAll(/(?:^|[;\s])(--[\w-]+)\s*:/g)) {
      if (!decl[1].startsWith("--_")) found.add(decl[1]);
    }
  }
  return found;
}

function runBuild(cwd: string, dist: string) {
  return Bun.spawnSync([process.execPath, "run", "build.ts"], { cwd, env: { ...process.env, STARTR_DIST: dist }, stdout: "pipe", stderr: "pipe" });
}

describe("built sheet", () => {
  const temp: string[] = [];
  let css = "";
  let log = "";
  let written = "";
  let m: Manifest;
  let sheet: ReturnType<typeof scanNames>;

  beforeAll(() => {
    let dist = process.env.MANIFEST_DIST ?? "";
    if (!dist) {
      dist = mkdtempSync(join(tmpdir(), "startr-manifest-"));
      temp.push(dist);
      const build = runBuild(ROOT, dist);
      log = build.stdout.toString() + build.stderr.toString();
      if (build.exitCode !== 0) {
        throw new Error(`the build failed, so there is nothing to check (another stream may be mid-edit):\n${log}`);
      }
    }
    css = readFileSync(join(dist, "startr.css"), "utf8");
    written = readFileSync(join(dist, "props.json"), "utf8");
    m = JSON.parse(written) as Manifest;
    sheet = scanNames(css);
  }, BUILD_TIMEOUT);

  afterAll(() => {
    for (const dir of temp) rmSync(dir, { recursive: true, force: true });
  });

  test("the build writes props.json from the sheet it just wrote, and it is the manifest byte for byte", () => {
    expect(written).toBe(formatManifest(buildManifest(css, { file: "startr.css" })));
    expect(m.generated_from).toEqual({ file: "startr.css", sha256: createHash("sha256").update(css).digest("hex") });
  });

  test("only the full sheet gets a manifest: the build log names props.json once", () => {
    if (!log) return; // MANIFEST_DIST skips the build, so there is no log
    expect(log.match(/^props\.json: /gm)?.length).toBe(1);
    expect(log).not.toContain("props.json skipped");
  });

  test("every name in the sheet is in the manifest", () => {
    // A name that is not a custom property is no prop; it must be reported, on its own or as the stem of a tier name.
    const reported = (name: string) => m.warnings.some((w) => w.startsWith(`invalid-name: ${name.replace(/-(?:xs|sm|md|lg|xl|pt)$/, "")} `) || w.startsWith(`invalid-name: ${name} `));
    const unknown = [...sheet.defined].filter((name) => (name.startsWith("--") ? !resolveName(m, name) : !reported(name)));
    expect(unknown).toEqual([]);
  });

  test("every manifest prop has a rule, for the bare name and for each tier and state", () => {
    const missing: string[] = [];
    for (const [name, entry] of Object.entries(m.props)) {
      const names = [...(entry.requires_suffix ? [] : [name]), ...entry.tiers.map((tier) => `${name}-${tier}`), ...entry.states.map((state) => `${name}-${state}`)];
      if (names.length === 0) missing.push(`${name} has no rule at all`);
      for (const variant of names) if (!sheet.defined.has(variant)) missing.push(variant);
      if (entry.requires_suffix && sheet.defined.has(name)) missing.push(`${name} is marked requires_suffix but has a bare rule`);
    }
    expect(missing).toEqual([]);
  });

  test("the names the manifest can spell are exactly the names the sheet defines", () => {
    expect(allNames(m)).toEqual([...sheet.defined].filter((name) => name.startsWith("--")).sort());
  });

  test("tokens are the custom properties the sheet declares on :root", () => {
    expect(Object.keys(m.tokens).sort()).toEqual([...scanRootTokens(css)].sort());
  });

  test("known collisions are flagged", () => {
    for (const [name, properties] of Object.entries(KNOWN_COLLISIONS)) {
      expect(m.props[name]?.collision, name).toEqual(properties);
    }
  });

  test("no other name collides", () => {
    const flagged = Object.keys(m.props).filter((name) => m.props[name].collision);
    expect(flagged.sort()).toEqual(Object.keys(KNOWN_COLLISIONS).sort());
  });

  test("the deprecation table is the plan's, and the sheet's entries carry it", () => {
    expect(DEPRECATED).toEqual(DEPRECATED_TABLE);
    for (const [old, replacement] of Object.entries(DEPRECATED_TABLE)) {
      if (sheet.defined.has(old)) expect(m.props[old]?.deprecated, old).toBe(replacement);
    }
    const flagged = Object.keys(m.props).filter((name) => m.props[name].deprecated);
    expect(flagged.every((name) => name in DEPRECATED_TABLE)).toBe(true);
  });

  test("every name in the old grammar is in the table", () => {
    const old = Object.keys(m.props).filter((name) => /^--hvr-/.test(name) || /-hvr$/.test(name));
    expect(old.filter((name) => !(name in DEPRECATED_TABLE))).toEqual([]);
  });

  test("each replacement exists in the sheet (reported; MANIFEST_STRICT=1 makes it fail)", () => {
    const present = Object.entries(DEPRECATED_TABLE).filter(([old]) => m.props[old]);
    const missing = present.filter(([, replacement]) => !sheet.defined.has(replacement));
    console.log(`[manifest] deprecated names with a replacement in the sheet: ${present.length - missing.length} of ${present.length}`);
    if (missing.length > 0) {
      console.warn(`[manifest] ${missing.length} deprecated names have no replacement in the sheet yet:\n${missing.map(([old, replacement]) => `  ${old} -> ${replacement}`).join("\n")}`);
    }
    if (process.env.MANIFEST_STRICT === "1") expect(missing).toEqual([]);
  });

  test("known props read as the sheet defines them", () => {
    expect(m.props["--bg"]).toMatchObject({ properties: ["background"], kind: "prop" });
    expect(m.props["--px"]).toMatchObject({ properties: ["padding-inline-end", "padding-inline-start"], kind: "prop" });
    expect(m.props["--levitate"]?.kind).toBe("helper");
    expect(m.props["--us"]?.properties).toEqual(["user-select"]);
  });

  test("the generator found nothing wrong with the sheet", () => {
    const empty = m.warnings.filter((warning) => warning.startsWith("empty-rule"));
    if (empty.length > 0) console.warn(`[manifest] ${empty.join("\n[manifest] ")}`);
    expect(m.warnings.filter((warning) => !warning.startsWith("empty-rule"))).toEqual([]);
  });

  test("the schema is stable", () => {
    expect(Object.keys(m)).toEqual(["version", "generated_from", "breakpoints", "props", "tokens", "warnings"]);
    expect(m.version).toBe(1);
    expect(Object.keys(m.generated_from)).toEqual(["file", "sha256"]);
    expect(m.generated_from.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(m.props)).toEqual(Object.keys(m.props).sort());
    expect(Object.keys(m.tokens)).toEqual(Object.keys(m.tokens).sort());
    for (const [tier, px] of Object.entries(m.breakpoints)) {
      expect(TIERS as readonly string[]).toContain(tier);
      expect(tier).not.toBe("pt");
      expect(Number.isFinite(px)).toBe(true);
    }
    const seen = new Set<string>();
    for (const [name, entry] of Object.entries(m.props)) {
      expect(name).toMatch(/^--[\w-]+$/);
      for (const key of Object.keys(entry)) seen.add(key);
      expect(Object.keys(entry), name).toEqual(ENTRY_KEY_ORDER.filter((key) => key in entry));
      expect(entry.properties.length === new Set(entry.properties).size, name).toBe(true);
      expect(entry.properties, name).toEqual([...entry.properties].sort());
      expect(["prop", "helper"]).toContain(entry.kind);
      expect(entry.tiers, name).toEqual(TIERS.filter((tier) => entry.tiers.includes(tier)));
      expect(entry.states, name).toEqual(STATES.filter((state) => entry.states.includes(state)));
      if ("requires_suffix" in entry) expect(entry.requires_suffix).toBe(true);
      for (const read of entry.reads ?? []) {
        expect(read, name).toMatch(/^--(?!_)[\w-]+$/);
        expect(resolveName(m, read) ?? m.tokens[read], `${name} reads ${read}, which is a prop or a token`).toBeFalsy();
      }
      if ("collision" in entry) expect(entry.collision!.length).toBeGreaterThan(1);
      if ("deprecated" in entry) expect(entry.deprecated).toMatch(/^--[\w-]+$/);
    }
    expect([...seen].filter((key) => !ENTRY_KEY_ORDER.includes(key))).toEqual([]);
    for (const [name, token] of Object.entries(m.tokens)) {
      expect(name).toMatch(/^--(?!_)[\w-]+$/);
      expect(Object.keys(token)).toEqual(["type"]);
      expect(["color", "length", "number", "other"]).toContain(token.type);
    }
  });
});

describe("build.ts", () => {
  test("a manifest step that fails warns, drops any stale props.json, and leaves the CSS build whole", () => {
    const tree = mkdtempSync(join(tmpdir(), "startr-manifest-broken-"));
    try {
      cpSync(join(ROOT, "src"), join(tree, "src"), { recursive: true });
      cpSync(join(ROOT, "build.ts"), join(tree, "build.ts"));
      symlinkSync(join(ROOT, "node_modules"), join(tree, "node_modules"));
      mkdirSync(join(tree, "scripts"));
      writeFileSync(join(tree, "scripts/manifest.ts"), 'throw new Error("manifest is broken on purpose");\n');
      const dist = join(tree, "out");
      mkdirSync(dist);
      writeFileSync(join(dist, "props.json"), '{"stale":true}\n');
      const build = runBuild(tree, dist);
      const output = build.stdout.toString() + build.stderr.toString();
      expect(build.exitCode, output).toBe(0);
      expect(output).toContain("props.json skipped");
      expect(output).toContain("Build complete!");
      for (const file of ["startr.css", "startr.min.css", "startr-base.css", "startr-helpers.css", "startr-utilities.css"]) {
        expect(existsSync(join(dist, file)), file).toBe(true);
      }
      expect(existsSync(join(dist, "props.json")), "a props.json from an older build must not survive").toBe(false);
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  }, BUILD_TIMEOUT);
});
