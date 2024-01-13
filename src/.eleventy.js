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

  eleventyConfig.addCollection("excludeFolders", (collection) => {
    return collection.getAll().filter((item) => {
      return !item.inputPath.includes("/_");
    });
  });

  return {
    markdownTemplateEngine: "njk"
  };
};

