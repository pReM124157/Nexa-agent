const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: "openclaw-personal"
  }),
  puppeteer: {
    headless: true,
    ignoreHTTPSErrors: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage"
    ]
  }
});

client.on("qr", (qr) => {
  console.log("QR_RECEIVED");
  // Save QR string to file
  fs.writeFileSync(path.join(__dirname, "qr.txt"), qr);

  // Also print it for the logs
  console.log("\nScan this QR with WhatsApp:\n");
  qrcode.generate(qr, { small: true });
});

client.on("authenticated", () => {
  console.log("AUTHENTICATED");
});

client.on("ready", () => {
  console.log("READY");
  process.exit(0);
});

client.on("auth_failure", (msg) => {
  console.error("AUTH_FAILURE", msg);
  process.exit(1);
});

console.log("Initializing client...");
client.initialize();
