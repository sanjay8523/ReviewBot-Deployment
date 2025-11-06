const parseDiff = require("parse-diff");
const path = require("path");

function parseDiffData(diffString) {
  const files = parseDiff(diffString);

  return files
    .map((file) => {
      const filePath = file.to !== "/dev/null" ? file.to : file.from;
      if (!filePath || filePath === "/dev/null") return null;

      const changedLines = [];

      file.chunks.forEach((chunk) => {
        chunk.changes.forEach((change) => {
          if (change.type === "add" || change.type === "normal") {
            // ln2 is the line number in the new file, critical for GitHub comments
            changedLines.push({
              lineNumber: change.ln2,
              content: change.content.substring(1).trim(),
              type: change.type,
            });
          }
        });
      });

      return {
        path: filePath,
        additions: file.additions,
        deletions: file.deletions,
        changedLines,
        language: detectLanguage(filePath),
      };
    })
    .filter((f) => f !== null);
}

function detectLanguage(filename) {
  const ext = path.extname(filename).toLowerCase().substring(1);

  const languageMap = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    java: "java",
    go: "go",
    rs: "rust",
    php: "php",
    rb: "ruby",
    swift: "swift",
    kt: "kotlin",
    cs: "csharp",
    json: "json",
    yml: "yaml",
    yaml: "yaml",
    md: "markdown",
  };

  return languageMap[ext] || "unknown";
}

module.exports = { parseDiff: parseDiffData };
