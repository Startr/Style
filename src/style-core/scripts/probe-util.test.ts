import { describe, expect, test } from "bun:test";
import { parseCookie, parseLogin, parseViewport, parseWidths, slugify, splitArgs } from "./probe-util";

// The argument pieces the page probes share (tap-probe.ts, diff-probe.ts).

describe("parseViewport", () => {
  test("WIDTHxHEIGHT", () => {
    expect(parseViewport("390x844")).toEqual({ width: 390, height: 844 });
    expect(parseViewport(" 1280X800 ")).toEqual({ width: 1280, height: 800 });
  });
  test("anything else is null", () => {
    for (const bad of ["390", "390x", "x844", "390 844", "wide", "1x1", ""]) expect(parseViewport(bad)).toBeNull();
  });
});

describe("parseLogin and parseCookie split on the first separator", () => {
  test("a password may hold a colon; a cookie value may hold =", () => {
    expect(parseLogin("a@b.test:p:w")).toEqual({ email: "a@b.test", password: "p:w" });
    expect(parseCookie("sessionid=a=b==")).toEqual({ name: "sessionid", value: "a=b==" });
  });
  test("a missing separator, or an empty name, is null", () => {
    expect(parseLogin("nocolon")).toBeNull();
    expect(parseLogin(":pw")).toBeNull();
    expect(parseCookie("novalue")).toBeNull();
    expect(parseCookie("=v")).toBeNull();
  });
  test("an empty password and an empty cookie value are allowed", () => {
    expect(parseLogin("a@b.test:")).toEqual({ email: "a@b.test", password: "" });
    expect(parseCookie("flag=")).toEqual({ name: "flag", value: "" });
  });
});

describe("parseWidths", () => {
  test("a comma list", () => {
    expect(parseWidths("390,1280")).toEqual([390, 1280]);
    expect(parseWidths("768")).toEqual([768]);
    expect(parseWidths("390, 1280")).toEqual([390, 1280]);
  });
  test("anything else is null", () => {
    for (const bad of ["", "390,", ",390", "390;1280", "wide", "5"]) expect(parseWidths(bad)).toBeNull();
  });
});

describe("slugify", () => {
  test("host, port and path, no scheme and no query", () => {
    expect(slugify("http://localhost:8080/admin/settings?tab=1")).toBe("localhost-8080-admin-settings");
    expect(slugify("https://sage.is/")).toBe("sage-is");
  });
  test("a non-URL still gives a safe name, and it is bounded", () => {
    expect(slugify("???")).toBe("page");
    expect(slugify("https://x.test/" + "a".repeat(300)).length).toBeLessThanOrEqual(80);
  });
});

describe("splitArgs", () => {
  const split = (argv: string[]) => {
    const s = splitArgs(argv, ["--a", "--c"], ["--j"]);
    if ("error" in s) throw new Error(s.error);
    return s;
  };
  test("positionals, valued flags in order, boolean flags", () => {
    const s = split(["one", "--a", "1", "two", "--j", "--c", "x", "--c", "y"]);
    expect(s.positional).toEqual(["one", "two"]);
    expect(s.values.get("--a")).toEqual(["1"]);
    expect(s.values.get("--c")).toEqual(["x", "y"]);
    expect(s.flags.has("--j")).toBe(true);
  });
  test("a flag value may start with dashes or look like a flag", () => {
    expect(split(["--a", "--weird"]).values.get("--a")).toEqual(["--weird"]);
  });
  test("an unknown flag, and a valued flag with no value, are errors", () => {
    expect(splitArgs(["--z"], ["--a"], [])).toEqual({ error: "unknown flag --z" });
    expect(splitArgs(["--a"], ["--a"], [])).toEqual({ error: "--a needs a value" });
  });
});
