require("dotenv").config();
const { Client, LocalAuth } = require("whatsapp-web.js");
const readline = require("readline");
const fs = require("fs");
const path = require("path");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log("\n🔐 WhatsApp Nexa Authentication Setup\n");
console.log("Choose authentication method:");
console.log("1) QR Code Scan (automatic)");
console.log("2) Use stored session (if available)\n");

rl.question("Select option (1-2): ", async (option) => {
  rl.close();

  if (option === "2") {
    // Check if saved session exists
    const sessionPath = path.join(__dirname, "../../.wwebjs_auth/session-openclaw-personal");
    if (fs.existsSync(sessionPath)) {
      console.log("✓ Found saved session. Using stored authentication...\n");
      authenticateWithSavedSession();
    } else {
      console.log("✗ No saved session found. Falling back to QR code...\n");
      authenticateWithQR();
    }
  } else {
    authenticateWithQR();
  }
});

function authenticateWithQR() {
  console.log("🔄 Starting WhatsApp authentication with QR code...\n");
  
  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: "openclaw-personal"
    }),
    puppeteer: {
      headless: true,
      ignoreHTTPSErrors: true,
      protocolTimeout: 180000,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage"
      ]
    }
  });

  client.on("qr", (qr) => {
    console.log("📱 Scan this QR code with WhatsApp on your phone:\n");
    require("qrcode-terminal").generate(qr, { small: true });
    console.log("\n⏳ Waiting for scan... (This will timeout in 60 seconds)\n");
  });

  client.on("authenticated", () => {
    console.log("✅ WhatsApp authenticated!\n");
  });

  client.on("ready", () => {
    console.log("🚀 WhatsApp connected successfully!");
    console.log("Session saved for future use.\n");
    process.exit(0);
  });

  client.on("auth_failure", (msg) => {
    console.error("❌ Auth failed:", msg);
    process.exit(1);
  });

  client.on("disconnected", () => {
    console.log("⚠️  WhatsApp disconnected");
  });

  // Timeout after 60 seconds
  setTimeout(() => {
    console.error("\n⏰ QR code expired. Please try again.");
    client.destroy();
    process.exit(1);
  }, 60000);

  client.initialize();
}

function authenticateWithSavedSession() {
  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: "openclaw-personal"
    }),
    puppeteer: {
      headless: true,
      ignoreHTTPSErrors: true,
      protocolTimeout: 180000,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage"
      ]
    }
  });

  client.on("ready", () => {
    console.log("🚀 WhatsApp reconnected with saved session!");
    process.exit(0);
  });

  client.on("auth_failure", () => {
    console.error("❌ Session expired. Please authenticate again with QR code.\n");
    process.exit(1);
  });

  client.initialize();
}
