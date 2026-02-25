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
const destDir = "dist";

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

  // Step 1: Transform (import, svg, mixins, vars, nesting, media query combining)
  const transformed = await postcss(transformPlugins).process(css, {
    from: entry,
    to: join(destDir, `${name}.css`),
    map: { inline: false },
  });

  // Step 2: Autoprefix
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

  // Step 3: Minify
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
