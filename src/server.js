require("dotenv").config();
console.log("SERPER_API_KEY:", process.env.SERPER_API_KEY ? "FOUND" : "MISSING");
const express = require("express");

const whatsappClient = require("./services/whatsapp");
const { getRepos } = require("./services/githubService");

const app = express();


app.use(express.json());

const PORT = process.env.PORT || 5050;

// Initialize WhatsApp client
whatsappClient.initialize();

// Root route
app.get("/", (req, res) => {
  res.send("OpenClaw Agent is live");
});

// Health check route
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "running",
    project: "OpenClaw Agent",
    phase: "Day 1 Foundation + WhatsApp Setup"
  });
});

// Test route
app.get("/status", (req, res) => {
  res.json({
    server: "active",
    whatsapp: "initializing"
  });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`OpenClaw running on http://127.0.0.1:${PORT}`);

  // GitHub Test
  getRepos().then((repos) => {
    console.log("Repos:", repos.map(r => r.name));
  });
});