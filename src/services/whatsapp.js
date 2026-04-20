process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

const { default: makeWASocket, useMultiFileAuthState, Browsers } = require('@whiskeysockets/baileys');
const { DisconnectReason, downloadMediaMessage } = require("@whiskeysockets/baileys");
const pino = require("pino");
const QRCode = require("qrcode");
const { connectDB, mongoose } = require('../db');
const axios = require("axios");

// Mongoose connection moved to initialize()

const { startReminderScheduler } = require("../utils/reminderScheduler");
const { askLLM, planTasks, parseIntent, validateConfidence } = require("./llmService");
const { getRepos, getRepoFiles } = require("./githubService");
const { sendPushoverAlert } = require("./notificationService");
const { resolveContact, getAllContacts } = require("../core/resolver");
const { saveDocument, getLastDocument } = require("../core/documentStore");
const { searchWeb } = require("../core/webSearch");
const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const Tesseract = require("tesseract.js");
const sharp = require("sharp");
const { exec } = require("child_process");
const { addMessageToMemory, getChatContext, pushToStack, popFromStack, updateChatMetadata, getChatMetadata } = require("../utils/chatMemory");

const HIGH_RISK_ACTIONS = ["send_message", "send_file"];

// Ensure temp and auth directories exist
const TEMP_DIR = path.join(__dirname, "../../temp");
const AUTH_DIR = path.join(__dirname, "../../.wwebjs_auth");

[TEMP_DIR, AUTH_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const AUTO_REPLY_STATE_PATH = path.join(__dirname, "../../data/auto_reply_state.json");
const SIX_HOURS = 6 * 60 * 60 * 1000;
const COMMAND_NUMBER = "919321762299";
const SELF_CHAT = "919321762299@c.us";
const CONTACTS_PATH = path.join(__dirname, "../../data/contacts.json");
console.log("CONTACT FILE PATH:", CONTACTS_PATH);
const CHAT_MEMORY_PATH = path.join(__dirname, "../../data/chat_memory.json");
const PDF_MEMORY_PATH = path.join(__dirname, "../../data/pdf_memory.json");
const PRIORITY_CONTACTS_PATH = path.join(__dirname, "../../data/priority_contacts.json");
const MAX_HISTORY = 20;

function isSensitiveQuery(text) {
  const t = text.toLowerCase();
  const patterns = [
    // Relationships
    "girlfriend", "boyfriend", "partner", "dating", "love life",
    "who does prem like", "who does he like", "crush", "relationship",
    "who do you love", "who is prem dating",
    "prem like", "prem loves", "prem's girlfriend", 
    "prem's son", "prem's daughter", "prem's relationship",
    "prem ka crush",
    
    // Physical
    "weight", "height", "body", "how tall", "how heavy",
    
    // Private contacts
    "who do you talk", "who does prem talk", "who messaged",
    "who did prem message", "contacts", "friends list",
    "who is prem chatting", "chat history", "recent chats",
    
    // Financial
    "bank", "income", "salary", "money", "card", "account",
    
    // Security
    "password", "api key", "token", "secret", "env",
    
    // Personal habits
    "personality", "nature", "character", "personal life",
    "private", "what does prem do", "daily routine",
    "where does prem live", "address", "location"
  ];
  return patterns.some(p => new RegExp(p).test(t));
}


function normalizeNumber(input) {
  if (!input) return null;
  // Remove all non-digit characters (spaces, +, -, etc.)
  let num = input.replace(/\D/g, "");

  // If it starts with 91 and is 12 digits, it's already normalized
  if (num.startsWith("91") && num.length === 12) {
    return num;
  }

  // If it's a 10-digit number, prepend 91
  if (num.length === 10 && /^[6-9]/.test(num)) {
    return "91" + num;
  }

  return null;
}

function isValidPhone(number) {
  // We use normalizeNumber now, so this is just a final check
  const normalized = normalizeNumber(number);
  return normalized !== null;
}

function normalize(name) {
  return name.toLowerCase().trim();
}

function resolveContactName(input, contacts) {
  if (!input) return null;
  const name = normalize(input);

  // 1. Exact match
  if (contacts[name]) return name;

  // 2. Partial match (e.g., "ja" matches "jainam" or "jainam bhai" matches "jainam")
  const match = Object.keys(contacts).find(k =>
    k.includes(name) || name.includes(k)
  );

  return match || null;
}

function getContacts() {
  try {
    if (fs.existsSync(CONTACTS_PATH)) {
      const contacts = JSON.parse(fs.readFileSync(CONTACTS_PATH, "utf-8"));
      // Migration/Normalization: Ensure all keys are lowercase
      const normalizedContacts = {};
      for (const [key, value] of Object.entries(contacts)) {
        normalizedContacts[key.toLowerCase().trim()] = value;
      }
      return normalizedContacts;
    }
  } catch (err) {
    console.error("Error reading contacts:", err);
  }
  return {};
}

function saveContact(name, number) {
  try {
    const contacts = getContacts();
    const cleanName = normalize(name);
    const cleanNumber = normalizeNumber(number);

    if (!cleanNumber) {
      return false;
    }

    // 🔥 ALWAYS OVERWRITE (Allows updates and enforces normalization)
    contacts[cleanName] = cleanNumber;
    fs.writeFileSync(CONTACTS_PATH, JSON.stringify(contacts, null, 2));

    console.log("SUCCESSFULLY SAVED:", cleanName, cleanNumber);
    return cleanName;
  } catch (err) {
    console.error("Error saving contact:", err);
    return false;
  }
}

function getAutoReplyState() {
  try {
    if (fs.existsSync(AUTO_REPLY_STATE_PATH)) {
      return JSON.parse(fs.readFileSync(AUTO_REPLY_STATE_PATH, "utf-8"));
    }
  } catch (err) {
    console.error("Error reading auto-reply state:", err);
  }
  return {};
}

function saveAutoReplyState(state) {
  try {
    fs.writeFileSync(AUTO_REPLY_STATE_PATH, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error("Error saving auto-reply state:", err);
  }
}

function getPDFMemory(chatId) {
  try {
    if (fs.existsSync(PDF_MEMORY_PATH)) {
      const memory = JSON.parse(fs.readFileSync(PDF_MEMORY_PATH, "utf-8"));
      return memory[chatId] || null;
    }
  } catch (err) {
    console.error("Error reading PDF memory:", err);
  }
  return null;
}

function savePDFMemory(chatId, text) {
  try {
    let memory = {};
    if (fs.existsSync(PDF_MEMORY_PATH)) {
      const raw = fs.readFileSync(PDF_MEMORY_PATH, "utf-8");
      memory = raw ? JSON.parse(raw) : {};
    }
    memory[chatId] = text;
    fs.writeFileSync(PDF_MEMORY_PATH, JSON.stringify(memory, null, 2));
  } catch (err) {
    console.error("Error saving PDF memory:", err);
  }
}

async function extractPDFText(filePath) {
  const buffer = fs.readFileSync(filePath);

  // STEP 1: Try Text-based extraction (Fast/Primary)
  try {
    const data = await pdfParse(buffer);
    if (data.text && data.text.trim().length > 100) {
      console.log("✅ [PDF] Text-based extraction successful.");
      return data.text.trim();
    }
  } catch (e) {
    console.log("[-] pdf-parse failed, falling back to OCR...");
  }

  // STEP 2: OCR Fallback (Multi-page)
  console.log("🧠 [PDF] Starting multi-page OCR conversion...");

  const prefix = path.join(TEMP_DIR, `page_${Date.now()}`);

  try {
    // Convert PDF → images (pdftoppm)
    await runCommand(`pdftoppm -png "${filePath}" "${prefix}"`);

    // Get all generated page images
    const files = fs.readdirSync(TEMP_DIR)
      .filter(f => f.startsWith(path.basename(prefix)) && f.endsWith(".png"))
      .sort();

    if (files.length === 0) {
      throw new Error("No images generated from PDF");
    }

    // 🔥 Safety Limit: Max 5 pages for OCR
    const processingFiles = files.slice(0, 5);
    console.log(`[OCR] Processing ${processingFiles.length} pages (Limit: 5).`);

    let fullText = "";

    // OCR Each Page sequentially
    for (const file of processingFiles) {
      const imgPath = path.join(TEMP_DIR, file);
      console.log(`[OCR] Reading page: ${file}`);

      const { data: { text } } = await Tesseract.recognize(
        imgPath,
        "eng",
        {
          logger: m => {
            if (m.status === "recognizing text" && Math.round(m.progress * 100) % 50 === 0) {
              console.log(`[OCR] ${file} progress: ${Math.round(m.progress * 100)}%`);
            }
          }
        }
      );

      fullText += text + "\n";

      // Cleanup image immediately
      if (fs.existsSync(imgPath)) {
        fs.unlinkSync(imgPath);
      }
    }

    // Cleanup any remaining pages above the limit
    files.forEach(f => {
      const p = path.join(TEMP_DIR, f);
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch { }
      }
    });

    return fullText.trim();
  } catch (ocrErr) {
    console.error("OCR Pipeline Failed:", ocrErr);
    return null;
  }
}

function runCommand(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (err, stdout, stderr) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}

function getPriorityContacts() {
  try {
    if (fs.existsSync(PRIORITY_CONTACTS_PATH)) {
      return JSON.parse(fs.readFileSync(PRIORITY_CONTACTS_PATH, "utf-8"));
    }
  } catch (err) {
    console.error("Error reading priority contacts:", err);
  }
  return {};
}

const URGENT_KEYWORDS = [
  "urgent",
  "asap",
  "call now",
  "emergency",
  "important",
  "immediately",
  "right now",
  "please call",
  "need help",
  "critical"
];

function classifyMessage(text, sender, priorityContacts) {
  const lower = text.toLowerCase();
  const isUrgent = URGENT_KEYWORDS.some(keyword => lower.includes(keyword));
  const isPrioritySender = Object.values(priorityContacts).includes(sender);

  if (isUrgent) return "urgent";
  if (isPrioritySender) return "high";
  return "normal";
}

// LEGACY HISTORY REMOVED - Using chatMemory.js

/**
 * Strips context-leaking phrases to maintain agentic silence.
 */
function sanitizeNexaResponse(text) {
  if (!text) return text;
  let sanitized = text
    .replace(/(as|per|like)\s+(you|we)\s+(mentioned|said|discussed)(.*?)(earlier|previously|before)\s*/gi, "")
    .replace(/you\s+asked\s+(me\s+)?to\s+(.*?)\s+earlier\s*/gi, "")
    .replace(/based\s+on\s+our\s+previous\s+conversation\s*/gi, "")
    .replace(/mentioned\s+previously\s*/gi, "")
    .trim();

  // Ensure response maintains polite tone
  if (sanitized && sanitized.length > 0) {
    const lower = sanitized.toLowerCase();
    // If response includes negation or inability, ensure it's polite
    if ((lower.includes("don't know") || lower.includes("can't") || lower.includes("unable") || lower.includes("cannot"))
      && !lower.includes("sorry") && !lower.includes("unfortunately") && !lower.includes("i'm afraid")) {
      sanitized = "I apologize, but " + sanitized.charAt(0).toLowerCase() + sanitized.slice(1);
    }
  }

  return sanitized;
}

/**
 * Validates if a string part contains a legitimate command intent.
 */
function isValidIntent(part) {
  const p = part.toLowerCase();
  return /\b(send|tell|say|message|ask|save|summarize|read|analyze|undo|rollback)\b/.test(p);
}

/**
 * Splits text into safe chunks without breaking sentences like "eat and sleep".
 */
function controlledSplitter(text) {
  if (!text) return [];
  // Split by "and then", "then", or newline
  const parts = text.split(/\b(?:and then|then)\b|\n/i);
  return parts.map(p => p.trim()).filter(p => p.length > 0 && isValidIntent(p));
}

/**
 * Resolves pronouns in v3 (Confidence-aware).
 */
function resolvePronounV3(chatId, input, type) {
  const metadata = getChatMetadata(chatId);
  const val = (input || "").toLowerCase();

  if (type === "recipient") {
    const stack = metadata.recentRecipients || [];
    if (["them", "him", "her", "that person", "this person"].includes(val)) {
      return { value: stack.at(-1), confidence: 0.7 }; // Stack match
    }
    if (val.includes("previous")) {
      return { value: stack.at(-2), confidence: 0.8 }; // Explicit stack match
    }
  }

  if (type === "document") {
    const stack = metadata.recentDocuments || [];
    if (["it", "that", "the file", "the document"].includes(val)) {
      return { value: stack.at(-1), confidence: 0.7 }; // Stack match
    }
    if (val.includes("previous")) {
      return { value: stack.at(-2), confidence: 0.8 }; // Explicit stack match
    }
  }

  return { value: null, confidence: 0 };
}

/**
 * Sanitizes step types using hard keyword rules to prevent LLM misclassification.
 */
function normalizeStepType(step) {
  const text = (step.content || step.recipient || "").toLowerCase();
  const type = (step.type || "").toLowerCase();

  if (text.includes("summarize") || text.includes("summary") || text.includes("analyze")) {
    return "summarize_pdf";
  }
  if (type === "send_file" || type === "send_message") {
    return type;
  }
  return type;
}

/**
 * Normalizes a single step from the planner (Stack/Name resolution).
 */
function normalizeStep(step, chatId, contacts) {
  const out = { ...step };
  out.type = normalizeStepType(step);

  let recipientConf = out.recipient ? (resolveContactName(out.recipient, contacts) ? 1.0 : 0.4) : 0;
  let docConf = step.type === "send_file" ? 0.5 : 1.0;

  // Resolve Recipient
  const resRecipient = resolvePronounV3(chatId, step.recipient, "recipient");
  if (resRecipient.value && resRecipient.confidence > recipientConf) {
    out.recipient = resRecipient.value.name || resRecipient.value;
    recipientConf = resRecipient.confidence;
    out.usesMemory = true;
  }
  out.finalRecipient = resolveContactName(out.recipient, contacts);

  // Resolve File
  if (step.type === "send_file" || step.type === "summarize_pdf") {
    const resDoc = resolvePronounV3(chatId, step.fileRef || "it", "document");
    if (resDoc.value) {
      out.fileMeta = resDoc.value;
      docConf = resDoc.confidence;
      out.usesMemory = true;
    } else {
      docConf = 0; // Explicit fail if missing
    }
  }

  out.confidence = Math.min(recipientConf, docConf);
  return out;
}



const ALLOWED_NUMBERS = [
  "919321762299", // you
  "919870781079", // mummy
  "917738266248"  // deep chaudhari
];


let client;
let socket = null;
let schedulerStarted = false;
let isInitializing = false;
let reconnectTimer = null;
let baileysAuthState = null;
let saveCredsHandler = null;
const sentMessagesCache = new Map();
const outboundQueue = [];
let processingOutboundQueue = false;
let reconnecting = false;
let reconnectAttempts = 0;
let shutdownHooksBound = false;
let reconnectDelayMs = 3000;
let isShuttingDown = false;
let cleanupCounter = 0;

const BAILEYS_LOGGER = pino({ level: process.env.BAILEYS_LOG_LEVEL || "error" });
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const SEND_DELAY_MS = 100;
const MAX_QUEUE_SIZE = 100;
const MAX_SEND_ATTEMPTS = 2;
const MAX_MESSAGE_CHARS = 5000;
const DEDUPE_TTL_MS = 10 * 60 * 1000;

function toBaileysJid(id = "") {
  if (!id) return id;
  if (id.endsWith("@c.us")) return id.replace("@c.us", "@s.whatsapp.net");
  if (id.endsWith("@lid")) return id.replace("@lid", "@lid.whatsapp.net");
  return id;
}

function fromBaileysJid(jid = "") {
  if (!jid) return jid;
  const normalized = jid.replace(/:\d+@/, "@");
  if (normalized.endsWith("@s.whatsapp.net")) return normalized.replace("@s.whatsapp.net", "@c.us");
  if (normalized.endsWith("@lid.whatsapp.net")) return normalized.replace("@lid.whatsapp.net", "@lid");
  return normalized;
}

async function processOutboundQueue() {
  if (processingOutboundQueue) return;
  processingOutboundQueue = true;
  try {
    while (outboundQueue.length > 0) {
      const job = outboundQueue.shift();
      let sent = null;
      let lastErr = null;

      for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
        try {
          sent = await socket.sendMessage(job.chatId, job.payload, job.options || {});
          break;
        } catch (err) {
          lastErr = err;
          console.error(`Send failed (attempt ${attempt}/${MAX_SEND_ATTEMPTS}):`, err.message);
          if (attempt < MAX_SEND_ATTEMPTS) {
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }
      }

      if (sent) {
        job.resolve(sent);
      } else {
        job.reject(lastErr || new Error("Send failed"));
      }

      await new Promise((resolve) => setTimeout(resolve, SEND_DELAY_MS));
    }
  } finally {
    processingOutboundQueue = false;
  }
}

function enqueueSend(chatId, payload, options = {}) {
  return new Promise((resolve, reject) => {
    if (outboundQueue.length >= MAX_QUEUE_SIZE) {
      reject(new Error("Outbound queue overflow"));
      return;
    }
    outboundQueue.push({ chatId, payload, options, resolve, reject });
    processOutboundQueue().catch((err) => {
      console.error("Outbound queue failure:", err.message);
    });
  });
}

function getInnerMessage(messageNode = {}) {
  return (
    messageNode.ephemeralMessage?.message ||
    messageNode.viewOnceMessage?.message ||
    messageNode.viewOnceMessageV2?.message ||
    messageNode.viewOnceMessageV2Extension?.message ||
    messageNode
  );
}

function getMessageType(content = {}) {
  return Object.keys(content)[0];
}

function extractBody(content = {}) {
  const msg = getInnerMessage(content);
  if (!msg || typeof msg !== "object") return "";

  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.documentMessage?.caption ||
    msg.buttonsResponseMessage?.selectedButtonId ||
    msg.buttonsResponseMessage?.selectedDisplayText ||
    msg.listResponseMessage?.title ||
    msg.templateButtonReplyMessage?.selectedDisplayText ||
    ""
  );
}

function extractContextInfo(content = {}) {
  const msg = getInnerMessage(content);
  const type = getMessageType(msg);
  if (!type) return null;
  return msg[type]?.contextInfo || null;
}

function extractMediaNode(content = {}) {
  const msg = getInnerMessage(content);
  return (
    msg.imageMessage ||
    msg.videoMessage ||
    msg.documentMessage ||
    msg.audioMessage ||
    msg.stickerMessage ||
    null
  );
}

function hasMedia(content = {}) {
  return !!extractMediaNode(content);
}

function pushSentMessage(chatId, key) {
  const arr = sentMessagesCache.get(chatId) || [];
  arr.push({ key, at: Date.now() });
  if (arr.length > 200) arr.shift();
  sentMessagesCache.set(chatId, arr);
}

function createSentMessageHandle(chatId, key) {
  const targetJid = toBaileysJid(chatId);
  return {
    id: { _serialized: key?.id || `msg_${Date.now()}` },
    key,
    async edit(text) {
      if (!socket) throw new Error("WhatsApp socket is not connected");
      try {
        if (this.key?.id) {
          await enqueueSend(targetJid, { delete: this.key });
        }
      } catch (err) {
        console.warn("[Baileys] edit delete fallback:", err.message);
      }
      const payload = typeof text === "string" ? { text } : text;
      const sent = await enqueueSend(targetJid, payload);
      pushSentMessage(chatId, sent.key);
      this.id = { _serialized: sent.key?.id || this.id._serialized };
      this.key = sent.key;
      return this;
    },
    async delete() {
      if (!socket || !this.key?.id) return false;
      await enqueueSend(targetJid, { delete: this.key });
      return true;
    }
  };
}

function buildMediaPayload(media, options = {}) {
  const mime = media.mimetype || "";
  const buffer = Buffer.from(media.data || "", "base64");
  if (buffer.length > MAX_MEDIA_BYTES) {
    throw new Error("File too large");
  }
  const payload = {};

  if (mime.startsWith("image/")) payload.image = buffer;
  else if (mime.startsWith("video/")) payload.video = buffer;
  else payload.document = buffer;

  payload.mimetype = mime || "application/octet-stream";
  if (options.caption) payload.caption = options.caption;
  return payload;
}

function createClientWrapper() {
  return {
    async sendMessage(chatId, content, options = {}) {
      if (!socket) throw new Error("WhatsApp socket is not connected");
      const targetJid = toBaileysJid(chatId);

      let payload;
      if (typeof content === "string") {
        payload = { text: content };
      } else if (content && content.mimetype && content.data) {
        payload = buildMediaPayload(content, options);
      } else if (content && typeof content === "object") {
        payload = content;
      } else {
        throw new Error("Unsupported sendMessage payload");
      }

      const sent = await enqueueSend(targetJid, payload, options);
      pushSentMessage(chatId, sent.key);
      return createSentMessageHandle(chatId, sent.key);
    },

    async getChatById(chatId) {
      return {
        fetchMessages: async ({ limit = 20 } = {}) => {
          const cached = sentMessagesCache.get(chatId) || [];
          return cached
            .slice(-Math.max(1, limit))
            .reverse()
            .map((entry) => createSentMessageHandle(chatId, entry.key));
        }
      };
    }
  };
}

function adaptMessage(baileysMsg) {
  if (!baileysMsg?.key?.remoteJid) return null;
  const chatId = fromBaileysJid(baileysMsg.key.remoteJid);
  const contextInfo = extractContextInfo(baileysMsg.message || {});
  const mediaNode = extractMediaNode(baileysMsg.message || {});
  const msgId = baileysMsg.key.id || `${chatId}_${Date.now()}`;
  const sourceKey = {
    ...baileysMsg.key,
    remoteJid: toBaileysJid(chatId)
  };
  const outboundChatJid = toBaileysJid(chatId);

  return {
    body: extractBody(baileysMsg.message || {}),
    from: chatId,
    author: fromBaileysJid(contextInfo?.participant || baileysMsg.key.participant || ""),
    fromMe: !!baileysMsg.key.fromMe,
    hasMedia: hasMedia(baileysMsg.message || {}),
    id: { _serialized: msgId },
    reply: async (text) => {
      const payload = typeof text === "string" ? { text } : text;
      const sent = await enqueueSend(outboundChatJid, payload, { quoted: baileysMsg });
      pushSentMessage(chatId, sent.key);
      return createSentMessageHandle(chatId, sent.key);
    },
    react: async (emoji) => {
      if (!socket) throw new Error("WhatsApp socket is not connected");
      return enqueueSend(outboundChatJid, {
        react: { text: emoji, key: sourceKey }
      });
    },
    downloadMedia: async () => {
      if (!mediaNode) return null;
      const buffer = await downloadMediaMessage(
        baileysMsg,
        "buffer",
        {},
        { logger: BAILEYS_LOGGER, reuploadRequest: socket.updateMediaMessage }
      );
      if (!buffer) return null;
      if (buffer.length > MAX_MEDIA_BYTES) {
        throw new Error("File too large");
      }
      if (buffer.length > 2 * 1024 * 1024) {
        return {
          mimetype: mediaNode.mimetype || "application/octet-stream",
          data: null,
          note: "file too large for base64 inline transport"
        };
      }
      return {
        mimetype: mediaNode.mimetype || "application/octet-stream",
        data: Buffer.from(buffer).toString("base64")
      };
    },
    getQuotedMessage: async () => {
      if (!contextInfo?.quotedMessage || !contextInfo?.stanzaId) return null;
      const quotedKey = {
        id: contextInfo.stanzaId,
        remoteJid: contextInfo.remoteJid || toBaileysJid(chatId),
        participant: contextInfo.participant,
        fromMe: fromBaileysJid(contextInfo.participant || "") === fromBaileysJid(socket?.user?.id || "")
      };
      return adaptMessage({
        key: quotedKey,
        message: contextInfo.quotedMessage,
        messageTimestamp: baileysMsg.messageTimestamp
      });
    },
    getContact: async () => {
      const senderJid = fromBaileysJid(contextInfo?.participant || baileysMsg.key.participant || baileysMsg.key.remoteJid);
      return { number: (senderJid.split("@")[0] || "").replace(/\D/g, "") };
    }
  };
}

function scheduleReconnect(delayMs = 3000) {
  if (isShuttingDown) return;
  if (reconnecting) return;
  if (reconnectAttempts >= 5) {
    console.error("Too many reconnect attempts. Exiting process for clean restart.");
    process.exit(1);
  }
  const nextDelay = Math.min(delayMs || reconnectDelayMs, 30000);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnecting = true;
  reconnectAttempts += 1;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      await startSocket();
      reconnecting = false;
      reconnectDelayMs = 3000;
    } catch (err) {
      console.error("Reconnect failed:", err.message);
      reconnecting = false;
      reconnectDelayMs = Math.min(nextDelay * 2, 30000);
      scheduleReconnect(reconnectDelayMs);
    }
  }, nextDelay);
}

async function startSocket() {
  if (socket) {
    try {
      socket.ev.removeAllListeners("connection.update");
      socket.ev.removeAllListeners("messages.upsert");
      socket.ev.removeAllListeners("creds.update");
      if (typeof socket.end === "function") {
        socket.end(new Error("socket-restart"));
      }
    } catch (err) {
      console.warn("Previous socket cleanup warning:", err.message);
    }
  }

  const sock = makeWASocket({
    auth: baileysAuthState,
    browser: Browsers.macOS("Chrome"),
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 10000,
    printQRInTerminal: true
  });
  socket = sock;

  sock.ev.on("creds.update", saveCredsHandler);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        global.lastQR = await QRCode.toDataURL(qr);
        console.log("QR available at /qr endpoint");
      } catch (err) {
        console.error("QR image generation failed:", err.message);
      }
    }

    if (connection === "open") {
      global.isReady = true;
      global.lastQR = null;
      reconnectAttempts = 0;
      if (!schedulerStarted) {
        startReminderScheduler(client);
        schedulerStarted = true;
        console.log("Reminder scheduler started");
      }
      console.log("✅ Nexa is ready ✅");
    }

    if (connection === "close") {
      global.isReady = false;
      const statusCode =
        lastDisconnect?.error?.output?.statusCode ||
        lastDisconnect?.error?.data?.statusCode ||
        null;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;
      console.log("❌ Client disconnected:", statusCode || "unknown");

      if (isLoggedOut) {
        reconnectDelayMs = 3000;
        console.log("Session logged out. Waiting for new QR authentication.");
        scheduleReconnect(1000);
        return;
      }

      scheduleReconnect(reconnectDelayMs);
    }
  });

  sock.ev.on("messages.upsert", ({ messages }) => {
    for (const msg of messages || []) {
      if (!msg?.message) continue;
      if (msg.key?.remoteJid === "status@broadcast") continue;

      const adapted = adaptMessage(msg);
      if (!adapted) continue;
      if (!adapted.body && !adapted.hasMedia) continue;
      handleMessage(adapted).catch((err) => {
        console.error("Message handling error:", err.message);
      });
    }
  });
}

function bindShutdownHooks() {
  if (shutdownHooksBound) return;
  shutdownHooksBound = true;

  const flushAndExit = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    try {
      if (saveCredsHandler) {
        await saveCredsHandler();
      }
      console.log(`Graceful shutdown complete (${signal})`);
    } catch (err) {
      console.error("Shutdown persistence failed:", err.message);
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", async () => {
    await flushAndExit("SIGINT");
  });
  process.on("SIGTERM", async () => {
    await flushAndExit("SIGTERM");
  });
}

async function initialize() {
  if (isInitializing) return;
  isInitializing = true;
  global.lastQR = null;

  try {
    await connectDB();
    const { state, saveCreds } = await useMultiFileAuthState("auth");
    baileysAuthState = state;
    saveCredsHandler = saveCreds;

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Mongo DB not ready in time")), 10000);
      const check = () => {
        if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
          clearTimeout(timeout);
          resolve();
          return;
        }
        setTimeout(check, 100);
      };
      check();
    });

    client = createClientWrapper();
    await startSocket();
    bindShutdownHooks();
  } finally {
    isInitializing = false;
  }
}

const processedMessages = new Map();

// ================================================================
// 4-LAYER ARCHITECTURE: MESSAGE HANDLER
// ================================================================

const handleMessage = async (message) => {
  // STEP 0: Deduplication Gate (Prevents double-firing for contacts)
  const msgId = message.id?._serialized;
  if (!msgId) return;
  const now = Date.now();
  const existing = processedMessages.get(msgId);
  if (existing && now - existing < DEDUPE_TTL_MS) return;
  processedMessages.set(msgId, now);
  cleanupCounter += 1;
  if (cleanupCounter % 50 === 0) {
    for (const [id, ts] of processedMessages.entries()) {
      if (now - ts > DEDUPE_TTL_MS) processedMessages.delete(id);
    }
  }

  try {
    const rawBody = (message.body || "").trim();
    const safeBody = rawBody.length > MAX_MESSAGE_CHARS ? rawBody.slice(0, MAX_MESSAGE_CHARS) : rawBody;
    if (!safeBody && !message.hasMedia) return;

    const text = safeBody.toLowerCase();
    const isOwner = message.fromMe;
    const isMention = text.includes("@nexa");

    // STEP 1: Logging & Initial Metadata
    console.log(`[Incoming] From: ${message.from} | Body: ${safeBody.slice(0, 50)}`);

    const chatId = message.from;

    // STEP 2: Logic Gating
    // 2a: Owner must mention @nexa to avoid self-reply loops
    if (isOwner && !isMention) {
      return; // Silent skip for owner's non-bot messages
    }

    console.log("🔥 MESSAGE RECEIVED:", safeBody);

    // 2b: Allowed Chat Types (Direct, Groups, and LIDs)
    const isAllowedChat = chatId.endsWith("@c.us") || chatId.endsWith("@lid") || chatId.endsWith("@g.us");
    if (!isAllowedChat) {
      console.log(`SKIPPED: Unsupported chat type (${chatId})`);
      return;
    }

    // Check auto-reply state
    const autoReplyState = getAutoReplyState();
    const autoReplyTimestamp = autoReplyState[chatId];
    const isAutoReplyActive = autoReplyTimestamp && (Date.now() - autoReplyTimestamp < SIX_HOURS);

    // STEP 3: Require @nexa mention or active auto-reply
    if (!isMention && !isAutoReplyActive) {
      console.log(`[Skip] No mention/auto-reply. Chat: ${chatId}`);
      return;
    }

    // Clean text for processing
    const cleanText = safeBody.replace(/@nexa/gi, "").trim();
    const cleanTextLower = cleanText.toLowerCase();

    console.log("🚀 PROCESSING:", cleanText);

    // Extract sender info
    let senderNumber;
    try {
      const contact = await message.getContact();
      senderNumber = contact.number;
    } catch (err) {
      senderNumber = (message.author || message.from || "").split("@")[0];
    }

    const normalizedSender = normalizeNumber(senderNumber);
    console.log("SENDER:", normalizedSender);
    const isAuthorized = ALLOWED_NUMBERS.includes(normalizedSender);

    // Validate sender authorization
    const contacts = getContacts();
    const isContact = Object.values(contacts).includes(normalizedSender);

    if (!isOwner && !isContact && !ALLOWED_NUMBERS.includes(normalizedSender)) {
      console.log("BLOCKED:", normalizedSender);
      return;
    }

    console.log("AUTHORIZED:", normalizedSender);

    // ================================================================
    // PRIVACY FIREWALL (block sensitive requests for ALL users)
    // ================================================================
    if (isSensitiveQuery(cleanText)) {
      console.log("🔒 SENSITIVE QUERY BLOCKED for:", normalizedSender);
      await message.reply("I'm not able to share personal information. 🔒");
      return;
    }


    // ================================================================
    // HANDLE PENDING CONFIRMATIONS (if owner is waiting on yes/no)
    // ================================================================
    const metadata = getChatMetadata(chatId);
    const isConfirmationReply = /^(yes|no|confirm|cancel|y|n|do it)$/i.test(text);

    if ((isOwner || isAuthorized) && metadata.pendingAction) {
      const isExpired = Date.now() - metadata.pendingAction.createdAt > 60000;
      if (!isExpired && isConfirmationReply) {
        const reply = text.toLowerCase();
        if (reply === "yes" || reply === "confirm" || reply === "y" || reply === "do it") {
          const currentPlan = metadata.pendingAction.plan || [metadata.pendingAction.data];
          updateChatMetadata(chatId, { pendingAction: null });
          await processPlan(chatId, currentPlan, message);
          return;
        } else if (reply === "no" || reply === "cancel" || reply === "n") {
          updateChatMetadata(chatId, { pendingAction: null });
          console.log("ABOUT TO REPLY");
          await message.reply("✅ Understood! I've cancelled that action.");
          return;
        }
      } else if (isExpired) {
        updateChatMetadata(chatId, { pendingAction: null });
      }
    }

    // STEP 2: Clear pending state on new commands (prevents old bugs)
    if (!isConfirmationReply) {
      updateChatMetadata(chatId, { pendingAction: null });
    }


    // ================================================================
    // STEP 3: MEDIA DETECTION + DOCUMENT STORAGE (clean, reliable)
    // ================================================================

    // STEP 3.1: Detect media (direct message OR quoted message)
    let mediaSource = null;
    if (message.hasMedia) {
      mediaSource = message;
    } else {
      const quoted = await message.getQuotedMessage().catch(() => null);
      if (quoted && quoted.hasMedia) {
        mediaSource = quoted;
      }
    }

    // STEP 3.2: If media detected, handle it
    if (mediaSource && (isOwner || isAuthorized)) {
      try {
        const media = await mediaSource.downloadMedia().catch(() => null);
        if (!media) {
          console.log("[DocStore] Media download failed");
          // Don't reply - silent failure
          // Continue processing user message normally
        } else if (!media.data) {
          console.log("[DocStore] Media too large for in-memory handling");
          await message.reply("The file is too large to process in memory. Please send a smaller file.");
          return;
        } else if (media.mimetype.includes("pdf")) {
          // PDF detected - extract and store
          console.log("[DocStore] PDF detected, extracting text...");
          const tempPath = path.join(TEMP_DIR, `doc_${Date.now()}.pdf`);
          fs.writeFileSync(tempPath, Buffer.from(media.data, "base64"));

          try {
            const extractedText = await extractPDFText(tempPath);
            if (extractedText && extractedText.trim().length > 0) {
              // Save to document store
              saveDocument(chatId, extractedText);
              console.log("[DocStore] ✅ PDF stored and ready for summarize");
            } else {
              console.log("[DocStore] PDF extraction returned empty text");
              await message.reply("PDF was received, but I couldn't extract text from it.");
              return;
            }
          } catch (e) {
            console.error("[DocStore] PDF extraction error:", e);
            await message.reply("Could not read PDF. Please try a different file.");
            return;
          } finally {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          }
        } else if (media.mimetype.startsWith("image/")) {
          // Image detected - OCR
          console.log("[DocStore] Image detected, will use OCR if summarize requested");
          // Don't process automatically - wait for user command
          // Continue to process user message
        } else {
          console.log("[DocStore] Other media type:", media.mimetype);
          // Other media - ignore for now
        }
      } catch (e) {
        console.error("[DocStore] Media handling error:", e);
        // Don't reply - continue processing
      }
    }

    // Record message in memory
    addMessageToMemory(chatId, "user", safeBody);

    // --- INTENT ROUTING (SINGLE VS MULTI-STEP) ---
    const isMultiStep = cleanTextLower.includes(" and ") || cleanTextLower.includes(" then ");
    let statusMsg = null;

    if (isMultiStep) {
      console.log("🧩 MULTI-STEP DETECTED. PLANNING...");
      statusMsg = await message.reply("Planning your request... 🧠");
      
      const plan = await planTasks(cleanText);
      if (!plan.steps || plan.steps.length === 0) {
        await statusMsg.edit("I understood the request but couldn't create a safe plan. Could you clarify?");
        return;
      }

      await statusMsg.edit(`Executing ${plan.steps.length} steps... ⚡`);

      for (const step of plan.steps) {
        // Map planner step back to executeIntent format
        const stepIntent = {
          intent: step.intent,
          confidence: step.confidence,
          recipient: step.recipient,
          content: step.content,
          query: step.query,
          budget: step.budget,
          task: step.task,
          data: step.data
        };
        
        const success = await executeIntent(stepIntent, message, chatId, statusMsg);
        if (!success) break; // Stop if a step fails
      }
      return;
    }

    // --- SINGLE INTENT FAST-PATH ---
    const parsedIntent = await parseIntent(cleanText);
    
    if (parsedIntent && parsedIntent.intent && parsedIntent.intent !== "none") {
      try {
        if (parsedIntent.intent === "web_search") {
          statusMsg = await message.reply("Searching the web... 🛍️");
        }
        await executeIntent(parsedIntent, message, chatId, statusMsg);
        return;
      } catch (err) {
        console.error("[SinglePath] Execution Error:", err.message);
        // Fallback to conversation on execution failure
      }
    }

    // Default: Conversation fallback
    const result = await askLLM(cleanText);
    await message.reply(sanitizeNexaResponse(result));


    // ================================================================
    // OWNER COMMAND: AUTO-REPLY TOGGLE
    // ================================================================
    if ((isOwner || isAuthorized) && isMention && text.includes("auto-reply")) {
      const match = text.match(/auto-reply (on|off)( for (.+))?/i);
      if (match) {
        const action = match[1].toLowerCase();
        const targetName = match[3];
        let targetId = chatId;

        if (targetName) {
          const resolvedName = resolveContactName(targetName, contacts);
          if (resolvedName && contacts[resolvedName]) {
            targetId = `${contacts[resolvedName]}@c.us`;
          } else {
            console.log("ABOUT TO REPLY");
            return await message.reply(`I apologize, but I couldn't find that contact. Could you please check your contact list? 😊`);
          }
        }

        if (action === "on") {
          autoReplyState[targetId] = Date.now();
          saveAutoReplyState(autoReplyState);
          console.log("ABOUT TO REPLY");
          return await message.reply(`✅ Thank you! Auto-reply is now enabled for ${targetName || "this chat"} for the next 6 hours.`);
        } else {
          delete autoReplyState[targetId];
          saveAutoReplyState(autoReplyState);
          console.log("ABOUT TO REPLY");
          return await message.reply(`✅ Done! Auto-reply has been disabled for ${targetName || "this chat"}.`);
        }
      }
    }

    // ================================================================
    // LAYER 2: TASK DETECTION (ALL task intents go through single entrypoint)
    // ================================================================

    // A. PDF ANALYSIS - Detected task, uses single entrypoint
    if (cleanTextLower.includes("pdf") && (cleanTextLower.includes("analyze") || cleanTextLower.includes("summarize"))) {
      console.log("[Step2] PDF ANALYSIS DETECTED");
      await message.react("⏳");
      const statusMsg = await message.reply("Analyzing document... ⏳");

      // Parse intent
      const parsedIntent = await parseIntent(cleanText);
      if (!parsedIntent || parsedIntent.intent === "none") {
        await statusMsg.edit("I'm not sure what you'd like me to do. Could you be more specific?");
        return;
      }

      // Execute through single entrypoint
      await executeIntent(parsedIntent, message, chatId, statusMsg);
      return;
    }

    // B. SIMPLE QUESTIONS - Direct LLM, no planner
    if (cleanText.length < 150 && cleanTextLower.includes("?")) {
      console.log("[Step2] SIMPLE QUESTION DETECTED:", cleanText);
      const history = getChatContext(chatId);
      console.log(`[SimpleChat] Context length: ${history.length} msgs`);
      const aiReply = await askLLM(cleanText, "", history);
      const sanitized = sanitizeNexaResponse(aiReply);
      addMessageToMemory(chatId, "assistant", sanitized);
      console.log("[SimpleChat] Successfully generated reply. Sending...");
      await message.reply(sanitized);
      return;
    }

    // ================================================================
    // LAYER 3: TASK MODE (PLANNER-BASED MULTI-STEP)
    // ================================================================
    const isUndoTrigger = cleanTextLower === "undo" || cleanTextLower === "rollback";
    const isTaskIntentTrigger = isUndoTrigger || /^(send|tell|say|message|ask|save|summarize|read|analyze)\b/i.test(cleanTextLower) || /\b(send|tell|say|message|ask|save|summarize|read|analyze)\b.*\b(to|me|this|that|last|previous)\b/i.test(cleanTextLower);

    if ((isOwner || isAuthorized) && isTaskIntentTrigger) {
      if (isUndoTrigger) {
        await message.reply("Rolling back last action... ⏳");
        await handleUndo(chatId, message);
        return;
      }

      console.log("[Step2] TASK INTENT DETECTED");
      await message.react("⏳");
      const statusMsg = await message.reply("Got your request — working on it. 🚀");

      // STEP 4: Split into steps (max 2)
      const steps = splitSteps(cleanText);

      if (!steps) {
        await statusMsg.edit("Too many steps. Keep it simple (max 2).");
        return;
      }

      // Execute each step
      for (let i = 0; i < steps.length; i++) {
        const stepText = steps[i];
        console.log(`[Planner] Step ${i + 1}/${steps.length}: ${stepText}`);

        const parsedIntent = await parseIntent(stepText);

        if (!parsedIntent || parsedIntent.intent === "none") {
          await statusMsg.edit("Couldn't understand one of the steps.");
          return;
        }

        const result = await executeIntent(parsedIntent, message, chatId, statusMsg);
        if (!result) {
          // Stop on first failure
          console.log(`[Planner] ❌ Step ${i + 1} failed, stopping`);
          return;
        }

        // Small delay to ensure clean sequencing (avoid race conditions)
        await new Promise(res => setTimeout(res, 300));
      }

      console.log(`[Planner] ✅ All ${steps.length} step(s) completed`);
      return;
    }

    // ================================================================
    // LAYER 4: FALLBACK CHAT (DEFAULT)
    // ================================================================
    console.log(`[Fallback] Reached chat fallback for: "${cleanText}"`);
    const history = getChatContext(chatId);
    let systemContext = "";

    if (cleanTextLower.match(/\b(repo|repository)\b/)) {
      const { getRepos } = require("./githubService");
      const repos = await getRepos();
      systemContext = `User's repos: ${repos.map(r => r.name).join(", ")}. `;
    }

    const aiReply = await askLLM(cleanText, systemContext, history);
    const sanitized = sanitizeNexaResponse(aiReply);
    addMessageToMemory(chatId, "assistant", sanitized);
    console.log("ABOUT TO REPLY");
    await message.reply(sanitized);

  } catch (error) {
    console.error("FATAL MESSAGE ERROR:", error);
  }
};

/**
 * Helper to identify task intents.
 */
function isTaskIntent(text) {
  return /send|tell|say|message|ask|save|summarize|read|analyze|undo|rollback/i.test(text);
}

/**
 * STEP 2: Controlled Execution Layer (Strict Discipline)
 * 
 * Execution Flow: input → parsedIntent → validate → resolve → execute → respond
 * 
 * NEVER:
 * - Mix intent parsing with execution
 * - Guess or assume values
 * - Use memory for contact resolution
 * - Execute with partial data
 */
async function processPlan(chatId, steps, message, statusMsg = null) {
  const results = [];
  const totalSteps = steps.length;

  for (let i = 0; i < totalSteps; i++) {
    const step = steps[i];

    // STEP 1: VALIDATE - Check that intent is clear
    if (!step.intent || step.intent === "none") {
      results.push(`Step ${i + 1}: Unclear intent ❌`);
      const errorText = "I'm not sure what you'd like me to do. Could you be more specific?";
      if (statusMsg) await statusMsg.edit(errorText); else await message.reply(errorText);
      break;
    }

    // STEP 2: VALIDATE - Check that action type is safe
    if (!["send_message", "send_file", "summarize_pdf"].includes(step.type)) {
      results.push(`Step ${i + 1}: Unknown action ❌`);
      break;
    }

    // STEP 3: TYPE-SPECIFIC VALIDATION
    let executeSuccess = false;

    if (step.type === "send_message") {
      // Guard 1: recipient required
      if (!step.recipient) {
        const errorText = "Who should I send this message to?";
        if (statusMsg) await statusMsg.edit(errorText); else await message.reply(errorText);
        results.push(`Step ${i + 1}: Missing recipient ❌`);
        break;
      }
      // Guard 2: content required
      if (!step.content) {
        const errorText = "What should I send?";
        if (statusMsg) await statusMsg.edit(errorText); else await message.reply(errorText);
        results.push(`Step ${i + 1}: Missing content ❌`);
        break;
      }
      // Execute
      try {
        executeSuccess = await executeStep(step, message, statusMsg, chatId);
      } catch (e) {
        console.error("[Step2] send_message error:", e);
        executeSuccess = false;
      }
    }
    else if (step.type === "send_file") {
      // Guard 1: recipient required
      if (!step.recipient) {
        const errorText = "Who should I send this file to?";
        if (statusMsg) await statusMsg.edit(errorText); else await message.reply(errorText);
        results.push(`Step ${i + 1}: Missing recipient ❌`);
        break;
      }
      // Execute
      try {
        executeSuccess = await executeStep(step, message, statusMsg, chatId);
      } catch (e) {
        console.error("[Step2] send_file error:", e);
        executeSuccess = false;
      }
    }
    else if (step.type === "summarize_pdf") {
      // Guard 1: document required
      const doc = getLastDocument(chatId);
      if (!doc) {
        const errorText = "No PDF found. Please send a document or reply to one to summarize.";
        if (statusMsg) await statusMsg.edit(errorText); else await message.reply(errorText);
        results.push(`Step ${i + 1}: Missing PDF ❌`);
        break;
      }
      // Execute
      try {
        executeSuccess = await executeStep(step, message, statusMsg, chatId);
      } catch (e) {
        console.error("[Step2] summarize_pdf error:", e);
        executeSuccess = false;
      }
    }

    // Report result
    if (executeSuccess) {
      results.push(`Step ${i + 1}: ${step.type.replace("_", " ")} ✅`);
    } else {
      results.push(`Step ${i + 1}: Failed ❌`);
      break;
    }
  }

  // Final Reporting
  const finalReport = `Task Status:\n${results.join("\n")}`;
  if (statusMsg) {
    await statusMsg.edit(`✅ Done!\n\n${finalReport}`);
  } else {
    await message.reply(finalReport);
  }
}

/**
 * Checks if the exact action was performed in the last 30s.
 */
function isDuplicateAction(chatId, step) {
  const meta = getChatMetadata(chatId);
  const stack = meta.actionStack || [];
  if (stack.length === 0) return false;
  const last = stack.at(-1);
  const now = Date.now();

  return (now - last.timestamp < 30000) &&
    last.type === step.type &&
    last.targetName === step.finalRecipient &&
    last.content === step.content;
}

/**
 * STEP 2: Strict schema validation before execution
 * 
 * Ensures intent object is valid and safe to execute.
 */
function validateIntent(intent) {
  const allowed = ["send_message", "send_file", "summarize_pdf", "web_search", "task_execution", "none"];

  if (!intent) {
    return { ok: false, error: "Invalid request." };
  }

  if (!intent.intent || !allowed.includes(intent.intent)) {
    return { ok: false, error: "Invalid request." };
  }

  return { ok: true };
}

/**
 * STEP 4: Minimal safe planner - Split message into at most 2 steps
 * 
 * Rules:
 * - Max 2 steps only
 * - No memory guessing
 * - Split only on "and" or "and then"
 * - Each step must have a command verb
 * - Each step is independent
 */
function splitSteps(text) {
  // Split first on "and then" (strong split), then on "and"
  const parts = text
    .split(/\band then\b/i)
    .flatMap(p => p.split(/\band\b/i))
    .map(p => p.trim())
    .filter(p => p && p.length > 2);

  // Only accept split if BOTH parts look like commands (contain action verb)
  if (parts.length === 2) {
    const hasVerb = (s) => /(send|tell|say|message|ask|summarize|read|analyze|save)/i.test(s);
    if (!hasVerb(parts[0]) || !hasVerb(parts[1])) {
      // One part doesn't have a verb → treat as single step
      return [text];
    }
    return parts;
  }

  if (parts.length > 2) {
    return null; // Too many steps
  }

  return parts; // 0 or 1 part
}

/**
 * STEP 2: Single entrypoint for all task execution
 * 
 * Flow: validate → resolve → execute → respond
 * NO alternate paths, NO bypass logic
 */
async function executeIntent(parsedIntent, message, chatId, statusMsg = null) {
  // STEP 1: Confidence & Auto-Repair Gate
  const confidence = validateConfidence(parsedIntent);
  console.log("🔴 CONFIDENCE VALUE:", confidence);
  const rawBody = (message.body || "").replace(/@nexa/gi, "").trim().slice(0, MAX_MESSAGE_CHARS);

  // Smart Retry: Auto-repair if intent is "none"
  if (parsedIntent.intent === "none" || !parsedIntent.intent) {
    console.log("[AutoRepair] Low confidence/None intent. Triggering smart retry...");
    const retryRaw = await askLLM(
      `Re-evaluate this request and extract intent more strictly:\n"${rawBody}"`,
      "Return valid JSON intent only with a confidence score. Schemes: send_message, web_search, task_execution. No explanations."
    );
    try {
      const retryParsed = JSON.parse(retryRaw);
      if (retryParsed && retryParsed.intent !== "none") {
        console.log(`[AutoRepair] Success: ${retryParsed.intent}`);
        return await executeIntent(retryParsed, message, chatId, statusMsg);
      }
    } catch (e) {
      console.warn("[AutoRepair] Failed to parse retry response.");
    }
  }

  // Confidence rejection
  if (confidence < 0.6) {
    const reply = "I want to make sure I get this right — could you clarify what you'd like me to do?";
    if (statusMsg) await statusMsg.edit(reply); else await message.reply(reply);
    return false;
  }

  // STEP 2: Validate schema
  const validation = validateIntent(parsedIntent);
  if (!validation.ok) {
    const reply = "I'm not sure what you'd like me to do. Could you be more specific?";
    if (statusMsg) await statusMsg.edit(reply); else await message.reply(reply);
    return false;
  }

  // STEP 3: Handle "none" intent (Final fallback after retry)
  if (parsedIntent.intent === "none") {
    const reply = "I'm not sure what you'd like me to do. Could you be more specific?";
    if (statusMsg) await statusMsg.edit(reply); else await message.reply(reply);
    return false;
  }

  // STEP 3: Type-specific execution with double guards
  if (parsedIntent.intent === "send_message") {
    // Double guard 1: Both recipient and content required
    if (!parsedIntent.recipient || !parsedIntent.content) {
      const reply = "Who should I send this to and what should I say?";
      if (statusMsg) await statusMsg.edit(reply); else await message.reply(reply);
      return false;
    }

    // Resolve contact
    const resolved = resolveContact(parsedIntent.recipient);
    if (!resolved) {
      const reply = `Contact not found: "${parsedIntent.recipient}". Could you check the name?`;
      if (statusMsg) await statusMsg.edit(reply); else await message.reply(reply);
      return false;
    }

    // Execute
    try {
      const targetChatId = `${resolved.number}@c.us`;
      if (statusMsg) await statusMsg.edit(`Polishing message for ${resolved.name}... ✍️`);

      const polished = await askLLM(
        `Rewrite for ${resolved.name}: "${parsedIntent.content}"`,
        `Polished message for ${resolved.name}. Ensure it's courteous, professional, and respectful.`
      );
      const sanitized = sanitizeNexaResponse(polished);

      const sent = await client.sendMessage(targetChatId, `${sanitized}\n\n_Sent via Nexa_`);
      pushToStack(chatId, "actionStack", {
        type: "send_message",
        timestamp: Date.now(),
        targetId: targetChatId,
        targetName: resolved.name,
        messageId: sent.id._serialized,
        content: parsedIntent.content
      });

      console.log(`[executeIntent] ✅ Message sent to ${resolved.name}`);
      return true;
    } catch (e) {
      console.error(`[executeIntent] send_message error:`, e);
      if (statusMsg) await statusMsg.edit(`Error: ${e.message}`);
      return false;
    }
  }

  if (parsedIntent.intent === "send_file") {
    // Double guard 1: Recipient required
    if (!parsedIntent.recipient) {
      const reply = "Who should I send this file to?";
      if (statusMsg) await statusMsg.edit(reply); else await message.reply(reply);
      return false;
    }

    // Resolve contact
    const resolved = resolveContact(parsedIntent.recipient);
    if (!resolved) {
      const reply = `Contact not found: "${parsedIntent.recipient}". Could you check the name?`;
      if (statusMsg) await statusMsg.edit(reply); else await message.reply(reply);
      return false;
    }

    const targetChatId = `${resolved.number}@c.us`;

    // Double guard 2: Media must exist
    try {
      const quoted = await message.getQuotedMessage().catch(() => null);
      const media = (message.hasMedia) ? await message.downloadMedia() : (quoted && quoted.hasMedia ? await quoted.downloadMedia() : null);
      if (!media) {
        const errorMsg = `Please reply to the file specifically to forward it to ${resolved.name}.`;
        if (statusMsg) await statusMsg.edit(errorMsg); else await message.reply(errorMsg);
        return false;
      }
      if (!media.data) {
        const errorMsg = "This file is too large to forward in memory. Please share a smaller file.";
        if (statusMsg) await statusMsg.edit(errorMsg); else await message.reply(errorMsg);
        return false;
      }

      // Execute
      const sent = await client.sendMessage(targetChatId, media, { caption: "Sent via Nexa" });
      pushToStack(chatId, "actionStack", {
        type: "send_file",
        timestamp: Date.now(),
        targetId: targetChatId,
        targetName: resolved.name,
        messageId: sent.id._serialized
      });

      console.log(`[executeIntent] ✅ File sent to ${resolved.name}`);
      return true;
    } catch (e) {
      console.error(`[executeIntent] send_file error:`, e);
      if (statusMsg) await statusMsg.edit(`Error: ${e.message}`);
      return false;
    }
  }

  if (parsedIntent.intent === "summarize_pdf") {
    try {
      // STEP 3: Get document from document store
      const docText = getLastDocument(chatId);
      if (!docText) {
        const reply = "No PDF found. Please send a document to summarize.";
        if (statusMsg) await statusMsg.edit(reply); else await message.reply(reply);
        return false;
      }

      // Execute
      if (statusMsg) await statusMsg.edit("Analyzing document... ⏳");
      const summary = await askLLM(
        `Summarize this document: ${docText.slice(0, 15000)}`,
        `Be Nexa, Prem's expert assistant. Provide 3-5 key takeaways in a professional and helpful manner. Always maintain a courteous tone.`
      );

      await message.reply(sanitizeNexaResponse(summary));
      console.log(`[executeIntent] ✅ PDF summarized (${docText.length} chars)`);
      return true;
    } catch (e) {
      console.error(`[executeIntent] summarize_pdf error:`, e);
      if (statusMsg) await statusMsg.edit(`Error: ${e.message}`);
      return false;
    }
  }

  if (parsedIntent.intent === "web_search") {
    try {
      const query = parsedIntent.content || parsedIntent.query;
      const budget = parsedIntent.budget;
      
      const getPriceNumber = (price) => {
        if (!price) return Infinity;
        const num = parseInt(String(price).replace(/[^0-9]/g, ""));
        return isNaN(num) ? Infinity : num;
      };

      const fullQuery = budget ? `${query} under ${budget}` : query;
      
      let results = await searchWeb(fullQuery);

      if (budget) {
        results = results.filter(r => getPriceNumber(r.price) <= budget);
        console.log(`🧠 FILTERED RESULTS (under ${budget}):`, results.length);
      }

      if (!results || results.length === 0) {
        const msg = budget ? `No results under ₹${budget}.` : `No results found.`;
        try {
          if (statusMsg) await statusMsg.edit(msg);
          else await message.reply(msg);
        } catch (e) {
          await message.reply(msg);
        }
        return true;
      }

      // --- VALUE SCORING LOGIC (BEST PICK) ---
      // Score = (Rating * 0.4) + (Log10(Reviews) * 0.2) - (PriceFactor * 0.4)
      const scoredResults = results.map(r => {
        const price = getPriceNumber(r.price);
        const rating = parseFloat(r.rating) || 0;
        const reviews = parseInt(r.reviews) || 0;
        
        // Normalize price for scoring (assume max 50k for scaling)
        const priceFactor = Math.min(price / 50000, 1);
        const reviewScore = reviews > 0 ? Math.min(Math.log10(reviews) / 4, 1) : 0;
        
        const score = (rating / 5 * 0.4) + (reviewScore * 0.2) + ((1 - priceFactor) * 0.4);
        return { ...r, score };
      });

      const bestChoice = [...scoredResults].sort((a, b) => b.score - a.score)[0];

      let reply = `🛍️ Top results for "${query}":\n\n`;
      results.slice(0, 3).forEach((r, i) => {
        const isBestMatch = r.link === bestChoice.link;
        const priceText = r.price || "N/A";
        const ratingText = r.rating ? `⭐ ${r.rating} (${r.reviews})` : "No ratings";
        
        reply += `${i + 1}. ${r.title}\n💰 ${priceText} | ${r.source}\n${ratingText}\n🔗 ${r.link}\n${isBestMatch ? "⭐ BEST VALUE PICK\n" : ""}\n`;
      });

      console.log("🚀 SENDING FINAL AGGREGATED REPLY");
      try {
        if (statusMsg) await statusMsg.edit(reply);
        else await message.reply(reply);
      } catch (e) {
        await message.reply(reply);
      }
      return true;
    } catch (err) {
      console.error("WEB SEARCH ERROR:", err);
      const errMsg = "⚠️ Failed to fetch results. Try again.";
      try {
        if (statusMsg) await statusMsg.edit(errMsg);
        else await message.reply(errMsg);
      } catch (e) {
        await message.reply(errMsg);
      }
    }
  }

  if (parsedIntent.intent === "task_execution") {
    // Block simple math/questions from hitting n8n
    const simpleQuery = /divide|multiply|add|subtract|calculate|what is|how much|convert/i;
    if (simpleQuery.test(rawBody)) {
      const result = await askLLM(rawBody, "Answer directly and briefly. No fluff.");
      await message.reply(sanitizeNexaResponse(result));
      return true;
    }

    try {
      const payload = {
        meta: {
          source: "whatsapp",
          chatId,
          sender: message.from,
          timestamp: Date.now()
        },
        task: parsedIntent.task,
        data: parsedIntent.data
      };
      
      // Fire-and-forget
      callN8n(payload);
      
      if (statusMsg) {
        await statusMsg.edit("⚡ Executing your request...");
      } else {
        await message.reply("⚡ Executing your request...");
      }
      return true;
    } catch (err) {
      console.error("[TaskExecution] Failed:", err.message);
      const failMsg = "Something went wrong while triggering the task.";
      if (statusMsg) await statusMsg.edit(failMsg);
      else await message.reply(failMsg);
      return false;
    }
  }

  return false;
}

async function callN8n(payload) {
  try {
    const axios = require("axios"); // Redundant check but safe
    await axios.post(process.env.N8N_WEBHOOK_URL, payload, {
      timeout: parseInt(process.env.N8N_TIMEOUT_MS) || 3000
    });
    return true;
  } catch (err) {
    console.error("[n8n] ERROR:", err.message);
    return false;
  }
}

/**
 * STEP 2: Individual action executor (Strict execution with resolver)
 * 
 * Execution Flow: validate → resolve → execute → respond
 * 
 * NEVER execute with partial data.
 * NEVER try to recover from missing values.
 * Use resolver ONLY for contact lookup.
 */
async function executeStep(step, message, statusMsg = null, chatId) {
  try {
    if (step.type === "send_message") {
      // Guard: Recipient must exist
      if (!step.recipient) {
        return false;
      }
      // Guard: Content must exist
      if (!step.content) {
        return false;
      }

      // STEP 1: RESOLVE - Convert recipient name to phone number
      const resolved = resolveContact(step.recipient);
      if (!resolved) {
        const errorMsg = `Contact not found: "${step.recipient}". Could you check the name?`;
        if (statusMsg) await statusMsg.edit(errorMsg); else await message.reply(errorMsg);
        return false;
      }

      const targetChatId = `${resolved.number}@c.us`;

      // STEP 2: EXECUTE - Polish and send message
      if (statusMsg) await statusMsg.edit(`Polishing message for ${resolved.name}... ✍️`);
      const polished = await askLLM(
        `Rewrite for ${resolved.name}: "${step.content}"`,
        `Polished message for ${resolved.name}. Ensure it's courteous, professional, and respectful.`
      );
      const sanitized = sanitizeNexaResponse(polished);

      const sent = await client.sendMessage(targetChatId, `${sanitized}\n\n_Sent via Nexa_`);
      pushToStack(chatId, "actionStack", {
        type: step.type,
        timestamp: Date.now(),
        targetId: targetChatId,
        targetName: resolved.name,
        messageId: sent.id._serialized,
        content: step.content
      });

      console.log(`[Step2] ✅ Message sent to ${resolved.name}`);
      return true;
    }

    else if (step.type === "send_file") {
      // Guard: Recipient must exist
      if (!step.recipient) {
        return false;
      }

      // STEP 1: RESOLVE - Convert recipient name to phone number
      const resolved = resolveContact(step.recipient);
      if (!resolved) {
        const errorMsg = `Contact not found: "${step.recipient}". Could you check the name?`;
        if (statusMsg) await statusMsg.edit(errorMsg); else await message.reply(errorMsg);
        return false;
      }

      const targetChatId = `${resolved.number}@c.us`;

      // STEP 2: VALIDATE - Media must be available
      const quoted = await message.getQuotedMessage().catch(() => null);
      const media = (message.hasMedia) ? await message.downloadMedia() : (quoted && quoted.hasMedia ? await quoted.downloadMedia() : null);
      if (!media) {
        const errorMsg = `Please reply to the file specifically to forward it to ${resolved.name}.`;
        if (statusMsg) await statusMsg.edit(errorMsg); else await message.reply(errorMsg);
        return false;
      }
      if (!media.data) {
        const errorMsg = "This file is too large to forward in memory. Please share a smaller file.";
        if (statusMsg) await statusMsg.edit(errorMsg); else await message.reply(errorMsg);
        return false;
      }

      // STEP 3: EXECUTE - Send file
      const sent = await client.sendMessage(targetChatId, media, { caption: "Sent via Nexa" });
      pushToStack(chatId, "actionStack", {
        type: step.type,
        timestamp: Date.now(),
        targetId: targetChatId,
        targetName: resolved.name,
        messageId: sent.id._serialized
      });

      console.log(`[Step2] ✅ File sent to ${resolved.name}`);
      return true;
    }

    else if (step.type === "summarize_pdf") {
      // STEP 3: Get document from document store
      const docText = getLastDocument(chatId);
      if (!docText) {
        return false;
      }

      // STEP 2: EXECUTE - Summarize
      if (statusMsg) await statusMsg.edit("Analyzing document... ⏳");
      const summary = await askLLM(
        `Summarize this document: ${docText.slice(0, 15000)}`,
        `Be Nexa, Prem's expert assistant. Provide 3-5 key takeaways in a professional and helpful manner. Always maintain a courteous tone.`
      );

      await message.reply(sanitizeNexaResponse(summary));
      console.log(`[Step2] ✅ PDF summarized`);
      return true;
    }

    return false;
  } catch (e) {
    console.error(`[Step2] Execution error in ${step.type}:`, e);
    if (statusMsg) await statusMsg.edit(`Error: ${e.message}`);
    return false;
  }
}

async function handleUndo(chatId, message) {
  const lastAction = popFromStack(chatId, "actionStack");
  if (!lastAction) return message.reply("No recent action to undo.");

  try {
    const targetChat = await client.getChatById(lastAction.targetId);
    const msgs = await targetChat.fetchMessages({ limit: 5 });
    const targetMsg = msgs.find(m => m.id._serialized === lastAction.messageId);
    if (targetMsg) {
      await targetMsg.delete(true);
      await message.reply(`Undone: Rollback of ${lastAction.type} success. 🔙`);
    } else {
      throw new Error("Msg not found");
    }
  } catch (e) {
    await message.reply("Correction: Please ignore the previous message from Nexa. (Physical recall failed). ⚠️");
  }
}

module.exports = { initialize, getClient: () => client };
