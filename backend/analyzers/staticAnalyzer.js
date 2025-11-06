const { ESLint } = require("eslint");

async function analyzeStaticIssues(files) {
  const issues = [];

  for (const file of files) {
    // Only run ESLint for JavaScript files
    if (!file.content || file.language !== "javascript") continue;

    try {
      // Basic ESLint configuration applied programmatically
      const eslint = new ESLint({
        useEslintrc: false,
        overrideConfig: {
          env: { browser: true, node: true, es2021: true },
          parserOptions: { ecmaVersion: "latest", sourceType: "module" },
          rules: {
            // High Severity Errors
            "no-undef": "error",
            eqeqeq: ["error", "always"],
            "no-eval": "error",
            "no-implied-eval": "error",
            semi: ["error", "always"],

            // Medium/Low Severity Warnings
            "no-unused-vars": "warn",
            "no-console": ["warn", { allow: ["warn", "error"] }],
            quotes: ["warn", "single"],
            "no-var": "warn",
            "prefer-const": "warn",
          },
        },
      });

      const results = await eslint.lintText(file.content, {
        filePath: file.path,
      });

      results.forEach((result) => {
        result.messages.forEach((msg) => {
          let severity = "low";
          if (msg.severity === 2) severity = "high";

          issues.push({
            path: file.path,
            line: msg.line,
            severity,
            category: "style",
            title: `Static Analysis: ${msg.message}`,
            description: `ESLint rule: \`${msg.ruleId}\``,
            language: "javascript",
          });
        });
      });
    } catch (error) {
      console.error(`ESLint error for ${file.path}:`, error.message);
    }
  }

  console.log(`  🔍 Static Analysis: ${issues.length} issues`);
  return issues;
}

module.exports = { analyzeStaticIssues };
