import { Glob } from "bun";
import postcss from "postcss";
import postcssImport from "postcss-import";
import postcssInlineSvg from "postcss-inline-svg";
import postcssMixins from "postcss-mixins";
import postcssNested from "postcss-nested";
import postcssCombineMediaQuery from "postcss-combine-media-query";
import autoprefixer from "autoprefixer";
import cssnano from "cssnano";
import { basename, join } from "path";

const srcDir = "src/builds";
// STARTR_DIST lets parallel builds and checks write somewhere other than dist/.
const destDir = process.env.STARTR_DIST ?? "dist";

// The published sheet's first line, kept byte-identical: consumers that
// vendor the sheet (Trellis scripts/vendor_kit.py) find the font faces
// through exactly this import. Added after the transform pass, because
// postcss-import would try to resolve it.
const FONT_IMPORT = "url('/fonts/Nunito-Sans.css')";
const FONT_ENTRIES = new Set(["startr", "startr-base"]);
const fontBanner = (name: string) => ({
  postcssPlugin: "startr-font-banner",
  Once(root: postcss.Root) {
    if (FONT_ENTRIES.has(name)) {
      root.prepend(postcss.atRule({ name: "import", params: FONT_IMPORT }));
    }
  },
});

// Source comments explain the source; the sheet consumers load does not need
// them. The unminified sheet is what AI-UI and Trellis link, so they cost
// every page about 6 KB gzipped. /*! … */ comments (licences) stay.
const stripComments = {
  postcssPlugin: "startr-strip-comments",
  Once(root: postcss.Root) {
    root.walkComments((comment) => {
      if (!comment.text.startsWith("!")) comment.remove();
    });
  },
};

// Ensure dist directory exists
await Bun.write(join(destDir, ".keep"), "");
const fs = await import("fs");
fs.unlinkSync(join(destDir, ".keep"));

// Gather all CSS entry files
const entryFiles: string[] = [];
const glob = new Glob("*.css");
for await (const file of glob.scan(srcDir)) {
  entryFiles.push(join(srcDir, file));
}

if (entryFiles.length === 0) {
  console.error("No CSS entry files found in", srcDir);
  process.exit(1);
}

// PostCSS processors
const transformPlugins = [
  postcssImport(),
  postcssInlineSvg(),
  postcssMixins(),
  postcssNested(),
];

// Its own pass, after the mixins have expanded. postcss-combine-media-query is
// a PostCSS 7 plugin: run in the same pass, PostCSS 8 calls it before the
// mixin step, so it lifts the raw @media blocks out of `@define-mixin svar-mq`
// and every breakpoint rule ships as a literal `[style*="$(var)-sm:"]`.
const combinePlugins = [
  postcssCombineMediaQuery(),
];

const prefixPlugins = [
  autoprefixer({ env: "legacy" }),
];

const minifyPlugins = [
  cssnano({
    preset: [
      "default",
      {
        svgo: {
          floatPrecision: 0,
        },
      },
    ],
  }),
];

for (const entry of entryFiles) {
  const name = basename(entry, ".css");
  const css = await Bun.file(entry).text();

  // Step 1: Transform (import, svg, mixins, vars, nesting)
  const expanded = await postcss(transformPlugins).process(css, {
    from: entry,
    to: join(destDir, `${name}.css`),
    map: { inline: false },
  });

  // Step 2: Combine media queries, now that the mixins have produced them,
  // drop source comments, and put the font import back on line one
  const transformed = await postcss([...combinePlugins, stripComments, fontBanner(name)]).process(expanded.css, {
    from: join(destDir, `${name}.css`),
    to: join(destDir, `${name}.css`),
    map: {
      prev: expanded.map.toJSON(),
      inline: false,
    },
  });

  // Step 3: Autoprefix
  const prefixed = await postcss(prefixPlugins).process(transformed.css, {
    from: join(destDir, `${name}.css`),
    to: join(destDir, `${name}.css`),
    map: {
      prev: transformed.map.toJSON(),
      inline: false,
    },
  });

  // Write unminified CSS + sourcemap
  await Bun.write(join(destDir, `${name}.css`), prefixed.css);
  await Bun.write(join(destDir, `${name}.css.map`), prefixed.map.toString());

  // The prop manifest: every inline prop, tier, state and token, read back from
  // the sheet just written. Only the full sheet gets one. A failure here warns
  // and moves on: the CSS build never depends on the manifest.
  if (name === "startr") {
    try {
      const { buildManifest, formatManifest } = await import("./scripts/manifest.ts");
      const manifest = buildManifest(prefixed.css, { file: `${name}.css` });
      await Bun.write(join(destDir, "props.json"), formatManifest(manifest));
      const props = Object.keys(manifest.props).length;
      const helpers = Object.values(manifest.props).filter((p) => p.kind === "helper").length;
      console.log(`props.json: ${props} props (${helpers} helpers), ${Object.keys(manifest.tokens).length} tokens`);
      for (const warning of manifest.warnings) console.warn(`  props.json warning: ${warning}`);
    } catch (error) {
      console.warn("props.json skipped:", error);
      // A props.json left by an older build would describe a different sheet.
      try {
        fs.rmSync(join(destDir, "props.json"), { force: true });
      } catch {}
    }
  }

  // Step 4: Minify
  const minified = await postcss(minifyPlugins).process(prefixed.css, {
    from: join(destDir, `${name}.css`),
    to: join(destDir, `${name}.min.css`),
    map: {
      prev: prefixed.map.toJSON(),
      inline: false,
    },
  });

  // Write minified CSS + sourcemap
  await Bun.write(join(destDir, `${name}.min.css`), minified.css);
  await Bun.write(join(destDir, `${name}.min.css.map`), minified.map.toString());

  // Report sizes
  const fullSize = new Blob([prefixed.css]).size;
  const minSize = new Blob([minified.css]).size;
  const gzipped = Bun.gzipSync(new TextEncoder().encode(minified.css));
  console.log(
    `${name}.css: ${(fullSize / 1024).toFixed(1)}KB → ${(minSize / 1024).toFixed(1)}KB min → ${(gzipped.length / 1024).toFixed(1)}KB gz`
  );
}

console.log("\nBuild complete!");
