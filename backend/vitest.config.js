const { defineConfig } = require("vitest/config");

module.exports = defineConfig({
  test: {
    include: ["**/*.test.js", "../shared/**/*.test.js"],
    exclude: ["**/node_modules/**"],
    globals: true,
  },
});
