/**
 * STEP 2: Controlled Execution Layer - Contact Resolver
 * 
 * ONLY responsibility: Resolve recipient name to phone number
 * NEVER does: guessing, memory-based resolution, normalization of intent
 * 
 * Single source of truth for contact lookups.
 */

const fs = require("fs");
const path = require("path");

const CONTACTS_PATH = path.join(__dirname, "../../data/contacts.json");

/**
 * Internal: Normalize for storage/lookup ONLY
 */
function normalize(name) {
  return name.toLowerCase().trim();
}

/**
 * Internal: Get raw contacts from file
 */
function getContactsRaw() {
  try {
    if (fs.existsSync(CONTACTS_PATH)) {
      const contacts = JSON.parse(fs.readFileSync(CONTACTS_PATH, "utf-8"));
      // Ensure all keys are lowercase for consistency
      const normalized = {};
      for (const [key, value] of Object.entries(contacts)) {
        normalized[normalize(key)] = value;
      }
      return normalized;
    }
  } catch (err) {
    console.error("[Resolver] Error reading contacts:", err);
  }
  return {};
}

/**
 * STEP 2 CORE: Resolve recipient name to phone number
 * 
 * EXACT MATCH ONLY - No fuzzy matching by default
 * Fuzzy matching requires explicit confirmation flow
 * 
 * Input: recipient name as written by user (from parseIntent)
 * Output: { name, number, confidence } OR null
 * 
 * Rules:
 * - If recipient is null/empty → return null
 * - EXACT match (case-insensitive) → return with confidence 1.0
 * - No partial/substring matches (too risky)
 * - Ambiguous cases → return null
 */
function resolveContact(recipientName) {
  // Guard: Empty recipient
  if (!recipientName || typeof recipientName !== "string") {
    console.log("[Resolver] Empty recipient, cannot resolve");
    return null;
  }

  const contacts = getContactsRaw();
  const input = normalize(recipientName);

  // EXACT MATCH ONLY
  if (contacts[input]) {
    console.log(`[Resolver] ✅ Exact match: "${recipientName}" → ${contacts[input]}`);
    return {
      name: input,
      number: contacts[input],
      confidence: 1.0
    };
  }

  // No match at all
  console.log(`[Resolver] ❌ Not found: "${recipientName}"`);
  return null;
}

/**
 * Get all contacts (for debugging/info only)
 */
function getAllContacts() {
  return getContactsRaw();
}

/**
 * Save a contact (used only during contact management, not during execution)
 */
function saveContact(name, number) {
  try {
    const contacts = getContactsRaw();
    const cleanName = normalize(name);
    
    // Basic validation: number should be 10-12 digits
    const numOnly = (number || "").replace(/\D/g, "");
    if (numOnly.length < 10 || numOnly.length > 12) {
      console.error("[Resolver] Invalid phone number:", number);
      return false;
    }

    contacts[cleanName] = numOnly.length === 10 ? "91" + numOnly : numOnly;
    fs.writeFileSync(CONTACTS_PATH, JSON.stringify(contacts, null, 2));
    console.log(`[Resolver] ✅ Saved: ${cleanName} → ${contacts[cleanName]}`);
    return true;
  } catch (err) {
    console.error("[Resolver] Error saving contact:", err);
    return false;
  }
}

module.exports = {
  resolveContact,      // MAIN EXPORT: Use this for execution
  getAllContacts,      // For debugging
  saveContact          // For contact management
};
