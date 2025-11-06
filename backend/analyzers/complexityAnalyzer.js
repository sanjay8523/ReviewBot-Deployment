async function analyzeComplexity(files) {
  const issues = [];
  const MAX_FUNCTION_LENGTH = 50;
  const MAX_NESTING_INDENT = 10;
  const MAX_COMPLEXITY = 10;
  const CHECK_WINDOW = 30;

  for (const file of files) {
    if (!file.content) continue;

    const lines = file.content.split("\n");

    // 1. Deeply nested code check
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("/*")) return;

      const indentationMatch = line.match(/^(\s*)/);
      const indentation = indentationMatch ? indentationMatch[1].length : 0;

      if (indentation > MAX_NESTING_INDENT) {
        issues.push({
          path: file.path,
          line: index + 1,
          severity: "medium",
          category: "quality",
          title: "Deeply nested code",
          description: `This code has high nesting. Consider refactoring to improve readability and maintainability.`,
          suggestion:
            "Extract nested logic into separate functions or use early returns to reduce nesting.",
          language: file.language,
        });
      }
    });

    // 2. Detect large functions (simple brace counter)
    const functionStartPattern =
      /function\s+\w+\s*\(|const\s+\w+\s*=\s*(?:async\s*)?\(|=>\s*{/g;
    let functionStart = -1;
    let braceCount = 0;

    lines.forEach((line, index) => {
      if (functionStartPattern.test(line)) {
        functionStart = index;
        braceCount =
          (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
      } else if (functionStart !== -1) {
        braceCount +=
          (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;

        if (braceCount === 0) {
          const functionLength = index - functionStart;

          if (functionLength > MAX_FUNCTION_LENGTH) {
            issues.push({
              path: file.path,
              line: functionStart + 1,
              severity: "medium",
              category: "quality",
              title: "Function too long",
              description: `This function is ${functionLength} lines long (Max: ${MAX_FUNCTION_LENGTH}). It violates the Single Responsibility Principle.`,
              suggestion:
                "Break down this function into smaller, single-responsibility functions.",
              language: file.language,
            });
          }

          functionStart = -1;
        }
      }
    });

    // 3. Excessive cyclomatic complexity (simple decision point count)
    const complexityMarkers =
      /\b(if|else|while|for|switch|case|catch|try|\?\?|\|\||&&)\b/g;
    let complexity = 0;
    let lineStart = 0;

    lines.forEach((line, index) => {
      const matches = line.match(complexityMarkers);
      if (matches) {
        complexity += matches.length;
      }

      if (index - lineStart >= CHECK_WINDOW || index === lines.length - 1) {
        if (complexity > MAX_COMPLEXITY) {
          issues.push({
            path: file.path,
            line: lineStart + 1,
            severity: "high",
            category: "quality",
            title: "High cyclomatic complexity",
            description: `This code section has high complexity (${complexity} decision points in ${
              index - lineStart
            } lines). It is hard to test and maintain.`,
            suggestion:
              "Reduce nested conditionals, extract complex logic into functions, or use Polymorphism/Strategy patterns.",
            language: file.language,
          });
        }
        complexity = 0;
        lineStart = index + 1;
      }
    });
  }

  console.log(`  📊 Complexity Analysis: ${issues.length} issues`);
  return issues;
}

module.exports = { analyzeComplexity };
