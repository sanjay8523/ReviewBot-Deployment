const Groq = require("groq-sdk");

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

async function performAIReview(files, changedFiles) {
  const issues = [];
  const MAX_AI_FILES = 3;

  // Filter for files with content, reasonable size, and supported languages
  const filesToReview = files
    .filter(
      (f) =>
        f.content &&
        f.content.split("\n").length > 5 &&
        f.content.length < 10000 &&
        ["javascript", "typescript", "python", "java"].includes(f.language)
    )
    .slice(0, MAX_AI_FILES);

  if (filesToReview.length === 0) {
    console.log("  🤖 AI Review: No suitable files for AI analysis");
    return issues;
  }

  console.log(
    `  🤖 AI Review: Analyzing ${filesToReview.length} file(s) with Groq...`
  );

  for (const file of filesToReview) {
    try {
      // Find the change context for the file
      const changedFile = changedFiles.find((cf) => cf.path === file.path);
      const changedLinesContext =
        changedFile?.changedLines
          .filter((cl) => cl.type === "add")
          .map((cl) => `Line ${cl.lineNumber}: ${cl.content}`)
          .join("\n") || "";

      if (!changedLinesContext) continue;

      const prompt = `You are an expert, strict, and highly technical code reviewer. Analyze the code changes in the "Changed Lines" section from the file "${
        file.path
      }".

File Language: ${file.language}

Changed Lines (Focus your review ONLY on these lines and their impact):
\`\`\`${file.language}
${changedLinesContext}
\`\`\`

Full File Context (only use this for broader context, don't review it directly):
\`\`\`${file.language}
${file.content.substring(0, 3000)}
\`\`\`

Provide a review in this exact, raw JSON format (no markdown, no preamble, just the raw JSON object):
{
  "issues": [
    {
      "line": <line number of the issue in the NEW code>,
      "severity": "critical|high|medium|low",
      "category": "bug|security|performance|quality|style",
      "title": "Brief, actionable issue title (e.g., Unhandled Promise Rejection)",
      "description": "Detailed explanation of the problem, its impact, and why it should be fixed.",
      "suggestion": "A concise code fix or refactoring advice if applicable"
    }
  ]
}

Focus strictly on **bugs, security vulnerabilities, and performance regressions**. If the code is good, return: \`{"issues": []}\`.`;

      const completion = await groq.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "llama-3.1-70b-versatile",
        temperature: 0.2,
        max_tokens: 1500,
        response_format: { type: "json_object" },
      });

      const response = completion.choices[0]?.message?.content;

      if (response) {
        const aiResult = JSON.parse(response);

        if (aiResult.issues && Array.isArray(aiResult.issues)) {
          aiResult.issues.forEach((issue) => {
            if (issue.line && issue.title) {
              issues.push({
                path: file.path,
                line: issue.line || 1,
                severity: issue.severity || "low",
                category: issue.category || "quality",
                title: `[AI] ${issue.title}`,
                description: issue.description || "AI-identified concern.",
                suggestion: issue.suggestion,
                language: file.language,
              });
            }
          });
        }
      }
    } catch (error) {
      console.error(`  ⚠️ AI review failed for ${file.path}:`, error.message);

      if (error.message.includes("rate_limit")) {
        console.log("  ⏳ Rate limit reached, skipping remaining AI reviews");
        break;
      }
    }
  }

  console.log(`  🤖 AI Review: ${issues.length} issues`);
  return issues;
}

module.exports = { performAIReview };
