require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const fs = require("fs"); // Added fs to read the private key locally
const path = require("path"); // Added path
const { handlePullRequestEvent } = require("./webhookHandler");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to verify GitHub webhook signature
function verifyGitHubSignature(req, res, next) {
  const signature = req.headers["x-hub-signature-256"];
  const secret = process.env.GITHUB_WEBHOOK_SECRET;

  if (!signature || !secret) {
    console.log("⚠️ Missing signature or secret");
    if (process.env.NODE_ENV === "development") return next();
    return res.status(401).send("Unauthorized");
  }

  try {
    const hmac = crypto.createHmac("sha256", secret);
    const digest =
      "sha256=" + hmac.update(JSON.stringify(req.body)).digest("hex");

    if (signature !== digest) {
      console.log("❌ Invalid signature");
      return res.status(401).send("Invalid signature");
    }
  } catch (e) {
    console.error("Signature verification error:", e);
    return res.status(500).send("Verification error");
  }

  next();
}

// Parse JSON payloads
app.use(express.json());

// Health check endpoint
app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "ReviewBot",
    version: "1.0.0",
    uptime: process.uptime(),
  });
});

// GitHub webhook endpoint
app.post("/webhook", verifyGitHubSignature, async (req, res) => {
  const event = req.headers["x-github-event"];
  const payload = req.body;

  console.log(`\n📬 Received GitHub event: ${event}`);

  res.status(200).send("Webhook received");

  try {
    if (event === "pull_request") {
      const action = payload.action;

      if (["opened", "reopened", "synchronize"].includes(action)) {
        console.log(
          `🔍 Processing PR #${payload.pull_request.number} (${action})`
        );
        handlePullRequestEvent(payload).catch((error) => {
          console.error("❌ Error processing PR in background:", error);
        });
      } else {
        console.log(`⏭️ Skipping action: ${action}`);
      }
    } else if (event === "ping") {
      console.log("🏓 Ping received - webhook is configured correctly!");
    } else if (
      event === "installation" ||
      event === "installation_repositories"
    ) {
      console.log(`🔧 Installation event received: ${event}`);
    } else {
      console.log(`⏭️ Ignoring event: ${event}`);
    }
  } catch (error) {
    console.error("❌ Error processing webhook:", error);
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("💥 Server error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// Start server
app.listen(PORT, () => {
  // Check for GITHUB_PRIVATE_KEY setup
  const isKeySet =
    process.env.GITHUB_PRIVATE_KEY ||
    (process.env.GITHUB_PRIVATE_KEY_PATH &&
      fs.existsSync(process.env.GITHUB_PRIVATE_KEY_PATH));
  const authMethod = isKeySet
    ? "✅ GitHub App"
    : process.env.GITHUB_TOKEN
    ? "⚠️ Personal Token"
    : "❌ Missing Auth";

  console.log(`
╔═══════════════════════════════════════╗
║      🤖 ReviewBot is ONLINE! 🚀       ║
╚═══════════════════════════════════════╝

📡 Server running on port ${PORT}
🔗 Webhook URL: http://localhost:${PORT}/webhook
🎯 Ready to review code!

Environment:
  • Node: ${process.version}
  • Auth Method: ${authMethod}
  • Groq API Key: ${process.env.GROQ_API_KEY ? "✅ Set" : "❌ Missing"}
  • Webhook Secret: ${
    process.env.GITHUB_WEBHOOK_SECRET ? "✅ Set" : "❌ Missing"
  }
  `);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("\n👋 Shutting down gracefully...");
  process.exit(0);
});
