import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contrast, hslToRgb, luminance, mixSrgb, over, parseColor, parseRgba, resolve, token, tokens, type RGB } from "./wcag";

// The contrast helper behind the colour tests. Known answers first, so a wrong
// formula cannot pass the tests that lean on it.

const variables = readFileSync(join(import.meta.dir, "..", "src/variables.css"), "utf8");
const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];

describe("contrast", () => {
  test("black on white is 21:1, a colour on itself 1:1", () => {
    expect(contrast(BLACK, WHITE)).toBeCloseTo(21, 5);
    expect(contrast(WHITE, BLACK)).toBeCloseTo(21, 5);
    expect(contrast([120, 40, 200], [120, 40, 200])).toBeCloseTo(1, 10);
  });
  test("the AA line sits between #767676 (4.54) and #777777 (4.48) on white", () => {
    expect(contrast([0x76, 0x76, 0x76], WHITE)).toBeCloseTo(4.54, 2);
    expect(contrast([0x77, 0x77, 0x77], WHITE)).toBeCloseTo(4.48, 2);
  });
  test("luminance of the primaries", () => {
    expect(luminance(WHITE)).toBeCloseTo(1, 10);
    expect(luminance(BLACK)).toBe(0);
    expect(luminance([255, 0, 0])).toBeCloseTo(0.2126, 4);
    expect(luminance([0, 255, 0])).toBeCloseTo(0.7152, 4);
    expect(luminance([0, 0, 255])).toBeCloseTo(0.0722, 4);
  });
});

describe("colour parsing", () => {
  test("hsl", () => {
    expect(hslToRgb(0, 0, 100)).toEqual([255, 255, 255]);
    expect(hslToRgb(0, 0, 15).map(Math.round)).toEqual([38, 38, 38]);
    expect(hslToRgb(0, 100, 50).map(Math.round)).toEqual([255, 0, 0]);
    expect(hslToRgb(240, 100, 50).map(Math.round)).toEqual([0, 0, 255]);
  });
  test("what Chrome serializes", () => {
    expect(parseColor("rgb(116, 116, 116)")).toEqual([116, 116, 116]);
    expect(parseColor("rgba(1, 2, 3, 0.5)")).toEqual([1, 2, 3]);
    expect(parseColor("color(srgb 1 0.5 0)")).toEqual([255, 127.5, 0]);
    expect(parseColor("#0066ff")).toEqual([0, 102, 255]);
    expect(() => parseColor("oklch(0.5 0.1 20)")).toThrow();
  });
  test("an sRGB mix normalises its weights", () => {
    expect(mixSrgb(BLACK, 50, WHITE, 50)).toEqual([127.5, 127.5, 127.5]);
    expect(mixSrgb(BLACK, 35, WHITE, 35)).toEqual([127.5, 127.5, 127.5]);
    expect(mixSrgb(BLACK, 100, WHITE, 0)).toEqual(BLACK);
  });
});

describe("colours with alpha", () => {
  test("parseRgba reads rgba(), rgb() and color(srgb)", () => {
    expect(parseRgba("rgba(0, 0, 0, 0)")).toEqual([0, 0, 0, 0]);
    expect(parseRgba("rgba(1, 2, 3, 0.83)")).toEqual([1, 2, 3, 0.83]);
    expect(parseRgba("rgb(1 2 3 / 50%)")).toEqual([1, 2, 3, 0.5]);
    expect(parseRgba("rgb(9, 8, 7)")).toEqual([9, 8, 7, 1]);
    expect(parseRgba("color(srgb 1 0 0 / 0.25)")).toEqual([255, 0, 0, 0.25]);
  });
  test("over paints a translucent colour on an opaque one", () => {
    expect(over([0, 0, 0, 0.5], WHITE)).toEqual([127.5, 127.5, 127.5]);
    expect(over([10, 20, 30, 0], [200, 200, 200])).toEqual([200, 200, 200]);
    expect(over([10, 20, 30, 1], [200, 200, 200])).toEqual([10, 20, 30]);
  });
});

describe("the resolver reads variables.css", () => {
  test("the base white and black, through two levels of var()", () => {
    expect(token(variables, "light", "--background")).toEqual([255, 255, 255]);
    expect(token(variables, "light", "--black").map(Math.round)).toEqual([38, 38, 38]);
  });
  test("the dark block overrides the named colours and everything derived re-resolves", () => {
    const light = token(variables, "light", "--background");
    const dark = token(variables, "dark", "--background");
    expect(dark).not.toEqual(light);
    expect(luminance(dark)).toBeLessThan(0.02);
    // --color-7 is not touched by the dark block: it is the white that stays white.
    expect(token(variables, "dark", "--color-7")).toEqual([255, 255, 255]);
    expect(token(variables, "dark", "--white")).not.toEqual([255, 255, 255]);
  });
  test("a mix with unlike weights", () => {
    const map = tokens(variables, "light");
    const got = resolve("color-mix(in srgb, var(--black) 60%, var(--white) 40%)", map);
    expect(got.map((v) => Math.round(v))).toEqual([125, 125, 125]);
  });
  test("what it cannot read is an error, not a guess", () => {
    expect(() => resolve("oklch(0.5 0.1 20)", new Map())).toThrow();
    expect(() => resolve("var(--nope)", new Map())).toThrow(/not defined/);
  });
});
