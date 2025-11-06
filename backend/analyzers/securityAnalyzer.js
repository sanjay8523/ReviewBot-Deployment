async function analyzeSecurityIssues(files) {
  const issues = [];

  const securityPatterns = [
    {
      pattern: /eval\s*\(/gi,
      title: "Dangerous eval() usage",
      description:
        "Using `eval()` can execute arbitrary code and is a major security risk. Avoid it entirely.",
      severity: "critical",
      documentation:
        "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/eval#never_use_eval!",
    },
    {
      pattern: /(?:SELECT|INSERT|UPDATE|DELETE).*?[`'"]\s*\+\s*\w+/gi,
      title: "Possible SQL Injection",
      description:
        "String concatenation in SQL queries can lead to SQL injection. Use parameterized queries instead.",
      severity: "critical",
      suggestion:
        'Use prepared statements:\nconst query = "SELECT * FROM users WHERE id = ?";\ndb.execute(query, [userId]);',
      documentation: "https://owasp.org/www-community/attacks/SQL_Injection",
    },
    {
      pattern: /innerHTML\s*=\s*[^'"`]/gi,
      title: "XSS vulnerability via innerHTML",
      description:
        "Setting innerHTML with unsanitized user input can lead to XSS attacks. Use textContent or sanitize input.",
      severity: "high",
      suggestion:
        "element.textContent = userInput; // Safe\n// OR use a library like DOMPurify.sanitize(userInput)",
      documentation: "https://owasp.org/www-community/attacks/xss/",
    },
    {
      pattern: /password.*?=.*?['"`]\w+['"`]/gi,
      title: "Hardcoded password detected",
      description:
        "Passwords should never be hardcoded. Use environment variables or secure vaults.",
      severity: "critical",
      suggestion: "const password = process.env.DB_PASSWORD;",
      documentation:
        "https://owasp.org/www-project-top-ten/2017/A3_2017-Sensitive_Data_Exposure",
    },
    {
      pattern: /api[_-]?key.*?=.*?['"`][A-Za-z0-9]{20,}['"`]/gi,
      title: "Exposed API key",
      description:
        "API keys or sensitive tokens should be stored in environment variables, not directly in code.",
      severity: "critical",
      suggestion: "const apiKey = process.env.API_KEY;",
    },
    {
      pattern: /Math\.random\(\)/gi,
      title: "Weak randomness for security",
      description:
        "Math.random() is not cryptographically secure. Use `crypto.randomBytes()` or similar for security purposes (e.g., tokens).",
      severity: "medium",
      suggestion:
        'const crypto = require("crypto");\nconst token = crypto.randomBytes(32).toString("hex");',
    },
    {
      pattern: /exec\s*\(/gi,
      title: "Command injection risk",
      description:
        "Using `exec()` with user input can lead to command injection. Sanitize input or use safer alternatives like `spawn`.",
      severity: "critical",
      documentation:
        "https://owasp.org/www-community/attacks/Command_Injection",
    },
    {
      pattern: /\.\.\/|\.\.\\(?!node_modules)/gi,
      title: "Path traversal pattern",
      description:
        "Path traversal (../) in file paths can expose sensitive files. Validate and sanitize paths using `path.resolve()` or similar.",
      severity: "high",
      documentation: "https://owasp.org/www-community/attacks/Path_Traversal",
    },
  ];

  for (const file of files) {
    if (!file.content) continue;

    const lines = file.content.split("\n");

    lines.forEach((line, index) => {
      securityPatterns.forEach((pattern) => {
        if (pattern.pattern.test(line)) {
          issues.push({
            path: file.path,
            line: index + 1,
            severity: pattern.severity,
            category: "security",
            title: pattern.title,
            description: pattern.description,
            suggestion: pattern.suggestion,
            documentation: pattern.documentation,
            language: file.language,
          });
        }
      });
    });
  }

  console.log(`  🔒 Security Analysis: ${issues.length} issues`);
  return issues;
}

module.exports = { analyzeSecurityIssues };
