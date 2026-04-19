const fs = require("fs");
const path = require("path");

const MEMORY_FILE = path.join(__dirname, "../../data/chat_memory.json");
const WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const data = fs.readFileSync(MEMORY_FILE, "utf-8");
      return data ? JSON.parse(data) : {};
    }
  } catch (err) {
    console.error("Error loading chat memory:", err);
  }
  return {};
}

function saveMemory(data) {
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error saving chat memory:", err);
  }
}

/**
 * Adds a message to the chat's sliding window memory.
 */
function addMessageToMemory(chatId, role, content) {
  const db = loadMemory();
  const now = Date.now();

  if (!db[chatId]) {
    db[chatId] = {
      messages: [],
      metadata: {
        recentRecipients: [],
        recentDocuments: [],
        actionStack: []
      }
    };
  } else if (Array.isArray(db[chatId])) {
    db[chatId] = {
      messages: db[chatId],
      metadata: {
        recentRecipients: [],
        recentDocuments: [],
        actionStack: []
      }
    };
  }

  // Ensure metadata structure for v2
  if (!db[chatId].metadata) db[chatId].metadata = {};
  if (!Array.isArray(db[chatId].metadata.recentRecipients)) db[chatId].metadata.recentRecipients = [];
  if (!Array.isArray(db[chatId].metadata.recentDocuments)) db[chatId].metadata.recentDocuments = [];
  if (!Array.isArray(db[chatId].metadata.actionStack)) db[chatId].metadata.actionStack = [];

  db[chatId].messages.push({
    role,
    content,
    timestamp: now
  });

  // Keep only the last 2 hours
  db[chatId].messages = db[chatId].messages.filter(m => now - m.timestamp < WINDOW_MS);

  // Keep only last 20 messages for focused intelligence
  if (db[chatId].messages.length > 20) {
    db[chatId].messages = db[chatId].messages.slice(-20);
  }

  saveMemory(db);
}

/**
 * Pushes an item to a specific stack in metadata (limit 5, unique).
 */
function pushToStack(chatId, key, item) {
  const db = loadMemory();
  if (!db[chatId]) addMessageToMemory(chatId, "system", "init");
  
  const metadata = db[chatId].metadata;
  if (!Array.isArray(metadata[key])) metadata[key] = [];
  
  // UNIQUE PUSH: Remove existing if duplicate
  const itemStr = typeof item === "string" ? item : JSON.stringify(item);
  metadata[key] = metadata[key].filter(existing => {
    const existingStr = typeof existing === "string" ? existing : JSON.stringify(existing);
    return existingStr !== itemStr;
  });

  // Add to end of stack
  metadata[key].push({
    ...item,
    timestamp: Date.now()
  });
  
  // Rotate (keep last 5)
  if (metadata[key].length > 5) {
    metadata[key] = metadata[key].slice(-5);
  }
  
  metadata.lastUpdated = Date.now();
  saveMemory(db);
}

/**
 * Updates flat metadata fields (e.g. pendingAction).
 */
function updateChatMetadata(chatId, update) {
  const db = loadMemory();
  if (!db[chatId]) {
    db[chatId] = { messages: [], metadata: {} };
  }
  
  db[chatId].metadata = {
    ...db[chatId].metadata,
    ...update,
    lastUpdated: Date.now()
  };
  
  saveMemory(db);
}

/**
 * Pops the last item from a stack (Undo support).
 */
function popFromStack(chatId, key) {
  const db = loadMemory();
  const chat = db[chatId];
  if (!chat || !chat.metadata || !Array.isArray(chat.metadata[key])) return null;
  
  const item = chat.metadata[key].pop();
  saveMemory(db);
  return item;
}

/**
 * Retrieves metadata for a chat.
 */
function getChatMetadata(chatId) {
  const db = loadMemory();
  const chat = db[chatId];
  if (!chat || !chat.metadata) return {};
  
  // Expire metadata after 2 hours (General history)
  // Note: pendingAction might have its own expiration check in whatsapp.js
  if (chat.metadata.lastUpdated && Date.now() - chat.metadata.lastUpdated > WINDOW_MS) {
    return {
      recentRecipients: [],
      recentDocuments: [],
      actionStack: []
    };
  }
  
  return chat.metadata;
}

/**
 * Retrieves the context for the AI, prioritizing user roles.
 */
function getChatContext(chatId) {
  const db = loadMemory();
  const now = Date.now();

  const chat = db[chatId];
  if (!chat || !chat.messages) return [];

  const freshMessages = chat.messages.filter(m => now - m.timestamp < WINDOW_MS);
  
  // PRIORITIZATION: Keep last 15 messages
  const contextLimit = 15;
  const context = freshMessages.slice(-contextLimit);
  
  return context.map(m => ({
    role: m.role,
    content: m.content
  }));
}

module.exports = {
  addMessageToMemory,
  getChatContext,
  pushToStack,
  popFromStack,
  updateChatMetadata,
  getChatMetadata
};
