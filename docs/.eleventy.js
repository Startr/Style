module.exports = function(eleventyConfig) {
  let options = {
    html: true,
    breaks: true,
    linkify: true
  };

  eleventyConfig.setLibrary("md", markdownIt(options));
};

module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ static: "/"  })
  return {
    markdownTemplateEngine: "njk"
  };
};

