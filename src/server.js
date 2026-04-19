require('dotenv').config();

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
});

const express = require('express');
const app = express();
const whatsappClient = require("./services/whatsapp");
const { getRepos } = require("./services/githubService");

global.lastQR = null;
global.isReady = false;

app.use(express.json());

// Root route
app.get("/", (req, res) => {
  res.send("OpenClaw Agent is live");
});

app.get('/health', (req, res) => {
  // Always return 200 — never let this fail on Railway
  res.status(200).json({ 
    status: 'ok', 
    ready: global.isReady,
    project: "OpenClaw Agent"
  });
});

app.get('/qr', (req, res) => {
  if (!global.lastQR) {
    return res.send(`
      <html>
        <body style="background:#000;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column">
          <h2>No QR yet</h2>
          <p>Wait 30 seconds and refresh</p>
        </body>
      </html>
    `);
  }
  res.send(`
    <html>
      <body style="background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0">
        <h2 style="color:#fff;font-family:sans-serif">Scan with WhatsApp</h2>
        <img src="${global.lastQR}" style="width:300px;height:300px"/>
        <p style="color:#888;font-family:sans-serif;font-size:12px;margin-top:20px">Refresh if expired</p>
      </body>
    </html>
  `);
});

// Test route
app.get("/status", (req, res) => {
  res.json({
    server: "active",
    whatsapp: global.isReady ? "ready" : "initializing"
  });
});

const PORT = process.env.PORT || 5050;
const server = app.listen(PORT, () => {
  console.log(`OpenClaw running on port ${PORT}`);
  
  // Delay WhatsApp init by 3 seconds so Railway confirms server is up first
  setTimeout(() => {
    whatsappClient.initialize()
      .then(() => { 
        global.isReady = true; 
        console.log("WhatsApp Client initialization sequence started");
      })
      .catch(err => console.error('WhatsApp init failed:', err.message));
  }, 3000);

  // GitHub Test
  getRepos().then((repos) => {
    console.log("Repos:", repos.map(r => r.name));
  });
});

server.keepAliveTimeout = 120000;