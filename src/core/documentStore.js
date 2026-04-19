/**
 * STEP 3: Document Store - Clean, Simple, Reliable
 * 
 * Single source of truth for document storage.
 * One latest document per chat.
 * Always text-based (never raw binary).
 */

// In-memory store: chatId → { text, timestamp }
const store = {};

/**
 * Save a document for a chat
 * 
 * Always overwrites previous document (no stacking).
 * Only stores text content.
 */
function saveDocument(chatId, text) {
  if (!chatId || !text) {
    console.error("[DocStore] Invalid save: chatId or text missing");
    return false;
  }

  store[chatId] = {
    text: text,
    timestamp: Date.now(),
    size: text.length
  };

  console.log(`[DocStore] ✅ Saved (${chatId}): ${text.length} chars`);
  return true;
}

/**
 * Get the last document for a chat
 * 
 * Returns text content OR null (NEVER undefined).
 */
function getLastDocument(chatId) {
  if (!chatId) {
    return null;
  }

  const doc = store[chatId];
  if (!doc || !doc.text) {
    console.log(`[DocStore] ❌ No document found (${chatId})`);
    return null;
  }

  console.log(`[DocStore] ✅ Retrieved (${chatId}): ${doc.text.length} chars`);
  return doc.text;
}

/**
 * Clear a document (for testing/cleanup)
 */
function clearDocument(chatId) {
  if (store[chatId]) {
    delete store[chatId];
    console.log(`[DocStore] Cleared (${chatId})`);
    return true;
  }
  return false;
}

/**
 * Get document metadata (for debugging)
 */
function getDocumentMetadata(chatId) {
  const doc = store[chatId];
  if (!doc) {
    return null;
  }
  return {
    timestamp: doc.timestamp,
    size: doc.size,
    age: Date.now() - doc.timestamp
  };
}

module.exports = {
  saveDocument,        // Primary export: save document
  getLastDocument,     // Primary export: retrieve document
  clearDocument,       // For cleanup
  getDocumentMetadata  // For debugging
};
