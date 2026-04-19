require('dotenv').config();

const { Client, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');
const qrcode = require('qrcode-terminal');

async function startClient() {
  try {
    // 1. Connect MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connected ✅');

    // 2. Create store
    const store = new MongoStore({ mongoose });
    // 3. Create WhatsApp client
    const client = new Client({
      authStrategy: new RemoteAuth({
        store,
        backupSyncIntervalMs: 60000
      }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ]
      }
    });
    // 4. QR Code
    client.on('qr', qr => {
      console.log('Scan QR Code:');
      qrcode.generate(qr, { small: true });
    });
    // 5. Events
    client.on('authenticated', () => {
      console.log('Authenticated ✅');
    });
    client.on('remote_session_saved', () => {
      console.log('Session saved to MongoDB ✅');
    });
    client.on('ready', () => {
      console.log('Nexa is ready ✅');
    });
    client.on('disconnected', (reason) => {
      console.log('Disconnected:', reason);
    });
    // 6. Message listener (basic test)
    client.on('message', async msg => {
      if (msg.body === 'ping') {
        await msg.reply('pong');
      }
    });
    // 7. Start client
    await client.initialize();

  } catch (err) {
    console.error('Client error:', err);
  }
}

module.exports = { startClient };
