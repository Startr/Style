module.exports = function (eleventyConfig) {
  let options = {
    html: true,
    breaks: true,
    linkify: true
  };

  eleventyConfig.setLibrary("md", markdownIt(options));
};

module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ static: "/" });
  // Copy any .jpg file to `_site`, via Glob pattern
  // Keeps the same directory structure.
  eleventyConfig.addPassthroughCopy("**/*.jpg");
  eleventyConfig.addPassthroughCopy("**/*.gif");
  eleventyConfig.addPassthroughCopy("**/*.avif");
  return {
    markdownTemplateEngine: "njk"
  };
};

