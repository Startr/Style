const syntaxHighlight = require("@11ty/eleventy-plugin-syntaxhighlight");

module.exports = function (eleventyConfig) {

  let options = {
    html: true,
    breaks: true,
    linkify: true,
  };

  // Syntax Highlighting
  eleventyConfig.addPlugin(syntaxHighlight, {
    preAttributes: {
      tabindex: 0, // Optional, for keyboard navigation
    },
    codeAttributes: {
      "data-lang": "{language}", // Add custom attributes
    },
  });
  eleventyConfig.addTransform("addPreStyles", function (content, outputPath) {
    if (outputPath.endsWith(".html")) {
      return content.replace(/<pre/g, '<pre style="--shadow-soft: 4; --levitate-hvr:4; --br:0.4rem; --mb: 0"');
    }
    return content;
  });

  // set directories to pass through to the dist directory
  eleventyConfig.addPassthroughCopy({ static: "/" });
  // /startr.css is static/startr.css, written by `make core_publish` from the
  // core build (core no longer tracks dist/, so the subtree carries none).
  // The core subtree is CSS source, not site content: its docs, tests and
  // fixtures hold Jinja and Liquid examples that would stop the build. Its two
  // public pages are served as plain files at their existing URLs, styled by
  // the published build at the relative paths they link (dist/startr.min.css).
  eleventyConfig.ignores.add("style-core/**");
  eleventyConfig.addPassthroughCopy({
    "style-core/index.html": "/style-core/index.html",
    "style-core/theme-creator.html": "/style-core/theme-creator/index.html",
    "static/startr.css": "/style-core/dist/startr.min.css",
  });
  // A second key for the same file: passthrough copies are keyed by source path.
  eleventyConfig.addPassthroughCopy({ "./static/startr.css": "/style-core/theme-creator/dist/startr.min.css" });
  // include run folder for passing users scripts that can be called with curl
  eleventyConfig.addPassthroughCopy({ run: "/run" });
  // Copy any .jpg file to `_site`, via Glob pattern
  // Keeps the same directory structure.
  eleventyConfig.addPassthroughCopy("**/*.jpg");
  eleventyConfig.addPassthroughCopy("**/*.gif");
  eleventyConfig.addPassthroughCopy("**/*.avif");
  eleventyConfig.addPassthroughCopy({ "static/favicon": "/" });

  eleventyConfig.addCollection("excludeFolders", (collection) => {
    return collection.getAll().filter((item) => {
      return !item.inputPath.includes("/_");
    });
  });

  return {
    markdownTemplateEngine: "njk",
  };
};
