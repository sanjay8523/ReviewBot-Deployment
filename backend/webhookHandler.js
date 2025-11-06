const { Octokit } = require("@octokit/rest");
const { createAppAuth } = require("@octokit/auth-app"); // NEW Import
const { parseDiff } = require("./utils/diffParser");
const { analyzeStaticIssues } = require("./analyzers/staticAnalyzer");
const { analyzeSecurityIssues } = require("./analyzers/securityAnalyzer");
const { analyzeComplexity } = require("./analyzers/complexityAnalyzer");
const { performAIReview } = require("./analyzers/aiReviewer");
const { calculateScore } = require("./utils/scoring");

// --- Centralized Octokit Initialization for App Authentication ---

// Function to generate a time-limited Octokit client for the specific repository
async function getInstallationOctokit(installationId) {
  let privateKey = process.env.GITHUB_PRIVATE_KEY;

  // NOTE: GITHUB_PRIVATE_KEY contains the contents of the .pem file, passed via Railway's environment variable.

  if (!privateKey || !process.env.GITHUB_APP_ID) {
    throw new Error(
      "GitHub App credentials (APP_ID or PRIVATE_KEY) are missing. Cannot authenticate."
    );
  }

  const auth = createAppAuth({
    appId: process.env.GITHUB_APP_ID,
    privateKey: privateKey,
    installationId: installationId,
  });

  const installationAuthentication = await auth({ type: "installation" });

  return new Octokit({
    auth: installationAuthentication.token,
  });
}

// --- Main Handler Function ---

async function handlePullRequestEvent(payload) {
  const { repository, pull_request } = payload;
  const owner = repository.owner.login;
  const repo = repository.name;
  const prNumber = pull_request.number;
  // CRUCIAL: Get the ID of the installation that triggered the event
  const installationId = payload.installation.id;

  // Initialize Octokit using the installation ID to get the necessary permissions
  const octokit = await getInstallationOctokit(installationId);

  console.log(`\n📊 Analyzing PR #${prNumber} in ${owner}/${repo}`);
  console.log(`🔗 ${pull_request.html_url}`);

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
        if (file.additions > 500) return { ...file, content: null };

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
        octokit,
        owner,
        repo,
        prNumber,
        pull_request.head.sha,
        allIssues
      );
    }

    // Step 7: Post summary comment
    const score = calculateScore(allIssues, reviewableFiles);
    // Note: The PUBLIC_LINK environment variable should be set to your GitHub App's installation link
    await postSummaryComment(octokit, owner, repo, prNumber, allIssues, score);

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

// NOTE: The utility functions (postReviewComments, postSummaryComment, formatIssueComment,
// getScoreEmoji, getTopConcerns, getRecommendation) remain the same except that
// postSummaryComment now references the PUBLIC_LINK env variable.

async function postReviewComments(
  octokit,
  owner,
  repo,
  prNumber,
  commitSha,
  issues
) {
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

async function postSummaryComment(
  octokit,
  owner,
  repo,
  prNumber,
  issues,
  score
) {
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

  // Use the public GitHub App link for the footer
  const publicLink =
    process.env.PUBLIC_LINK ||
    `https://github.com/apps/${
      process.env.GITHUB_APP_NAME || "sanjay-reviewbot"
    }`;

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
<sub>🤖 Powered by [Sanjay-ReviewBot](${publicLink})</sub>
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
