const { Octokit } = require("@octokit/rest");
const { parseDiff } = require("./utils/diffParser");
const { analyzeStaticIssues } = require("./analyzers/staticAnalyzer");
const { analyzeSecurityIssues } = require("./analyzers/securityAnalyzer");
const { analyzeComplexity } = require("./analyzers/complexityAnalyzer");
const { performAIReview } = require("./analyzers/aiReviewer");
const { calculateScore } = require("./utils/scoring");

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

async function handlePullRequestEvent(payload) {
  const { repository, pull_request } = payload;
  const owner = repository.owner.login;
  const repo = repository.name;
  const prNumber = pull_request.number;

  console.log(`\n📊 Analyzing PR #${prNumber} in ${owner}/${repo}`);

  try {
    // Step 1: Get PR diff
    const { data: diffData } = await octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
      mediaType: { format: "diff" },
    });

    // Step 2: Parse diff to extract changed files and lines
    const changedFiles = parseDiff(diffData);
    if (changedFiles.length === 0) {
      console.log("⏭️ No code changes detected");
      return;
    }

    // Step 3: Get file contents for analysis
    const filesWithContent = await Promise.all(
      changedFiles.map(async (file) => {
        if (file.additions > 500) return { ...file, content: null }; // Skip huge files

        try {
          const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: file.path,
            ref: pull_request.head.sha,
          });

          const content = Buffer.from(data.content, "base64").toString("utf-8");
          return { ...file, content };
        } catch (error) {
          console.log(`⚠️ Could not fetch ${file.path}: ${error.message}`);
          return { ...file, content: null };
        }
      })
    );

    const reviewableFiles = filesWithContent.filter((f) => f.content);

    // Step 4: Run all analyzers in parallel
    console.log("🔍 Running analysis...");
    const [staticIssues, securityIssues, complexityIssues, aiReviews] =
      await Promise.all([
        analyzeStaticIssues(reviewableFiles),
        analyzeSecurityIssues(reviewableFiles),
        analyzeComplexity(reviewableFiles),
        performAIReview(reviewableFiles, changedFiles),
      ]);

    // Step 5: Combine all issues
    const allIssues = [
      ...staticIssues,
      ...securityIssues,
      ...complexityIssues,
      ...aiReviews,
    ];

    // Step 6: Post review comments (Inline)
    if (allIssues.length > 0) {
      await postReviewComments(
        owner,
        repo,
        prNumber,
        pull_request.head.sha,
        allIssues
      );
    }

    // Step 7: Post summary comment
    const score = calculateScore(allIssues, reviewableFiles);
    await postSummaryComment(owner, repo, prNumber, allIssues, score);

    console.log("✅ Review completed successfully!");
  } catch (error) {
    console.error("❌ Error analyzing PR:", error);
    try {
      await octokit.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: `## ⚠️ ReviewBot Error\n\nSorry, I encountered an error while analyzing this PR:\n\`\`\`\n${error.message}\n\`\`\``,
      });
    } catch (commentError) {
      console.error("Failed to post error comment:", commentError);
    }
  }
}

// --- Helper Functions for GitHub Comments ---

async function postReviewComments(owner, repo, prNumber, commitSha, issues) {
  const comments = issues
    .filter((issue) => issue.line && issue.path)
    .map((issue) => ({
      path: issue.path,
      line: issue.line,
      body: formatIssueComment(issue),
    }));

  const commentsToPost = comments.slice(0, 30);

  if (commentsToPost.length === 0) {
    console.log("💬 No inline comments to post");
    return;
  }

  try {
    await octokit.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      commit_id: commitSha,
      event: "COMMENT",
      comments: commentsToPost,
    });
    console.log(`💬 Posted ${commentsToPost.length} inline comments`);
  } catch (error) {
    console.error("Failed to post review comments:", error.message);
  }
}

async function postSummaryComment(owner, repo, prNumber, issues, score) {
  const critical = issues.filter((i) => i.severity === "critical").length;
  const high = issues.filter((i) => i.severity === "high").length;
  const medium = issues.filter((i) => i.severity === "medium").length;
  const low = issues.filter((i) => i.severity === "low").length;

  const riskLevel =
    critical > 0
      ? "🔴 HIGH"
      : high > 0
      ? "🟠 MEDIUM"
      : medium > 0
      ? "🟡 LOW"
      : "🟢 MINIMAL";

  const summary = `
## 🤖 ReviewBot Analysis Summary

**Overall Score:** ${score}/100 ${getScoreEmoji(score)}
**Risk Level:** ${riskLevel}

### 📊 Issues Found
${critical > 0 ? `- 🔴 **${critical} Critical** (Security/Breaking)` : ""}
${high > 0 ? `- 🟠 **${high} High** (Important fixes needed)` : ""}
${medium > 0 ? `- 🟡 **${medium} Medium** (Should address)` : ""}
${low > 0 ? `- ⚪ **${low} Low** (Suggestions)` : ""}
${issues.length === 0 ? "✅ No issues found! Great work! 🎉" : ""}

### 🎯 Top Concerns
${getTopConcerns(issues)}

### 📝 Recommendation
${getRecommendation(score, critical, high)}

---
<sub>🤖 Powered by ReviewBot</sub>
  `.trim();

  try {
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: summary,
    });
    console.log("📝 Posted summary comment");
  } catch (error) {
    console.error("Failed to post summary:", error.message);
  }
}

function formatIssueComment(issue) {
  const icons = { critical: "🔴", high: "🟠", medium: "🟡", low: "⚪" };
  const categories = {
    security: "🔒 SECURITY",
    bug: "🐛 BUG",
    performance: "⚡ PERFORMANCE",
    quality: "💡 CODE QUALITY",
    style: "🎨 STYLE",
  };

  let comment = `${icons[issue.severity]} **${
    categories[issue.category] || issue.category.toUpperCase()
  }:** ${issue.title}\n\n`;
  comment += `${issue.description}\n\n`;

  if (issue.suggestion) {
    comment += `**💡 Suggested Fix:**\n\`\`\`${issue.language || ""}\n${
      issue.suggestion
    }\n\`\`\`\n\n`;
  }

  if (issue.documentation) {
    comment += `📚 [Learn more](${issue.documentation})\n`;
  }

  return comment;
}

function getScoreEmoji(score) {
  if (score >= 90) return "🌟";
  if (score >= 70) return "👍";
  if (score >= 50) return "⚠️";
  return "🚨";
}

function getTopConcerns(issues) {
  const topIssues = issues
    .filter((i) => i.severity === "critical" || i.severity === "high")
    .slice(0, 5);

  if (topIssues.length === 0) {
    return "✅ No major concerns detected!";
  }

  return topIssues
    .map((i) => `- **${i.path}:${i.line}** - ${i.title} (${i.severity})`)
    .join("\n");
}

function getRecommendation(score, critical, high) {
  if (critical > 0) {
    return "🚨 **Do not merge** - Critical issues must be resolved first.";
  }
  if (high > 0) {
    return "⚠️ **Review carefully** - High priority issues should be addressed.";
  }
  if (score >= 80) {
    return "✅ **Looks good to merge** - Minor issues can be addressed later.";
  }
  return "👍 **Approved** - Code quality looks great!";
}

module.exports = { handlePullRequestEvent };
