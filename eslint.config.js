/**
 * @file Root ESLint 9 flat config. First-pass, warn-only lint surface for the
 * plain-JS server/tooling code (client and mcp/ already have their own
 * TypeScript build pipelines and are out of scope here — see SHA-168).
 * Every rule is a warning, not an error, so this never fails a build; it only
 * surfaces signal. Do not add "error" severities or auto-fix existing
 * violations in this pass — ratchet file-by-file in follow-ups instead.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

const js = require("@eslint/js");
const globals = require("globals");

// `recommended` ships every rule at "error". Downgrade all of them to "warn"
// (preserving each rule's own options, if any) so this first pass is
// warn-only end to end, per SHA-168 — no violation in the existing codebase
// should fail a build.
const recommendedAsWarnings = Object.fromEntries(
  Object.entries(js.configs.recommended.rules).map(([name, setting]) => {
    if (Array.isArray(setting)) return [name, ["warn", ...setting.slice(1)]];
    return [name, "warn"];
  })
);

module.exports = [
  {
    ignores: [
      "node_modules/**",
      "**/node_modules/**",
      "client/**",
      "desktop/**",
      "vscode-extension/**",
      "mcp/**",
      // Separate subproject with its own package.json/tooling — same
      // treatment as client/desktop/mcp/vscode-extension above.
      "monitoring/**",
      // Not server/, scripts/, or root-level — outside the documented scope
      // (see server/README.md "Linting").
      "bin/**",
      "data/**",
      // Static site assets, browser-context (window/document/self globals),
      // no relation to the server/scripts Node tooling this pass covers.
      "wiki/**",
      "sw.js",
      "**/dist/**",
      "**/build/**",
      "**/*.min.js",
      ".claude/**",
    ],
  },
  {
    files: ["**/*.js", "**/*.cjs", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...recommendedAsWarnings,
      "no-unused-vars": "warn",
    },
  },
  {
    // .mjs is always an ES module regardless of package.json's "type" field —
    // the base block above sets sourceType: "commonjs" for the whole *.js/
    // *.cjs/*.mjs glob, which would misparse import/export syntax in an .mjs
    // file. No .mjs file exists in the linted scope today, but the override
    // keeps the config correct if/when one is added.
    files: ["**/*.mjs"],
    languageOptions: {
      sourceType: "module",
    },
  },
  {
    // Node ops process (hook install, token repair, shutdown) legitimately
    // logs to stdout/stderr throughout — see CLAUDE.md.
    files: ["server/**/*.js", "scripts/**/*.js"],
    rules: {
      "no-console": "off",
    },
  },
];
