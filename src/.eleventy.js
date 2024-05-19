const syntaxHighlight = require("@11ty/eleventy-plugin-syntaxhighlight");

module.exports = function (eleventyConfig) {
  let options = {
    html: true,
    breaks: true,
    linkify: true,
  };

  eleventyConfig.setLibrary("md", markdownIt(options));
};

module.exports = function (eleventyConfig) {
  // Syntax Highlighting
  eleventyConfig.addPlugin(syntaxHighlight);

  eleventyConfig.addTransform("addPreStyles", function (content, outputPath) {
    if (outputPath.endsWith(".html")) {
      return content.replace(/<pre/g, '<pre style="--shadow-soft: 4; --levitate-hvr:4; --br:0.4rem; --mb: 0"');
    }
    return content;
  });

  // set directories to pass through to the dist directory
  eleventyConfig.addPassthroughCopy({ static: "/" });
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
