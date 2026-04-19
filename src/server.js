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

// QR endpoint for easier scanning
app.get('/qr', (req, res) => {
  if (!global.lastQR) {
    return res.send('<h2 style="color:white;background:black;padding:20px">No QR yet. Wait 30 seconds and refresh.</h2>');
  }
  res.send(`
    <html>
      <body style="background:#000;display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;margin:0">
        <h2 style="color:white;font-family:sans-serif">Scan with WhatsApp</h2>
        <img src="${global.lastQR}" style="width:300px;height:300px"/>
      </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`OpenClaw running on port ${PORT}`);

  // GitHub Test
  getRepos().then((repos) => {
    console.log("Repos:", repos.map(r => r.name));
  });
});