function calculateScore(issues, files) {
  let score = 100;

  const severityPenalties = {
    critical: 25,
    high: 10,
    medium: 4,
    low: 1,
  };

  const totalLinesAdded = files.reduce((sum, f) => sum + f.additions, 0);

  // Deduct points for each issue
  issues.forEach((issue) => {
    score -= severityPenalties[issue.severity] || 2;
  });

  // Small penalty for large PRs
  if (totalLinesAdded > 200) {
    score -= 5;
  }

  // Bonus/Penalty for Test files
  const hasTestChanges = files.some(
    (f) =>
      f.path.includes("test") ||
      f.path.includes("spec") ||
      f.path.includes("__tests__")
  );

  // Large code change without any corresponding test file changes is a red flag
  if (!hasTestChanges && totalLinesAdded > 50) {
    score -= 15;
  } else if (hasTestChanges) {
    score += 5; // Small bonus for including tests
  }

  // Ensure score is between 0 and 100
  return Math.max(0, Math.min(100, Math.round(score)));
}

module.exports = { calculateScore };
