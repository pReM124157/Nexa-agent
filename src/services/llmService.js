const Groq = require("groq-sdk");

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

const NEXA_SYSTEM_PROMPT = `You are Nexa, Prem's personal AI assistant.

STRICT RULES:
- Answer ONLY what is asked. Nothing more.
- No extra explanation unless asked.
- No suggestions unless asked.
- No "Is there anything else I can help you with?"
- No "Certainly!", "Of course!", "Great question!"
- No corporate speak. No filler words.
- Keep every reply as short as possible.
- If it's a math question — just give the answer. Example: "12"
- If it's a factual question — one sentence max.
- If it's a task — confirm it's done. Nothing else.
- Never reveal anything about Prem's personal life.

You are sharp, minimal, and direct. Like a calculator that can talk.`;

async function askLLM(prompt, systemContext = "", history = []) {
  try {
    const messages = [
      {
        role: "system",
        content: `${NEXA_SYSTEM_PROMPT}\n${systemContext}`
      },
      ...history,
      {
        role: "user",
        content: prompt
      }
    ];

    const completion =
      await groq.chat.completions.create({
        messages,
        model: "llama-3.3-70b-versatile"
      });

    console.log(`[LLM] Raw Response: ${completion.choices[0].message.content.substring(0, 100)}${completion.choices[0].message.content.length > 100 ? '...' : ''}`);
    return completion.choices[0].message.content;
  } catch (error) {
    console.error("GROQ ERROR:", error);
    return "Sorry, I am unable to answer right now.";
  }
}


/**
 * STEP 1: Master Prompt - Intent Parser (No Contact Resolution)
 * 
 * Extracts ONLY intent and recipient as written by user.
 * Does NOT resolve contacts, guess phone numbers, or use memory.
 * Single source of truth for intent extraction.
 */
async function parseIntent(prompt) {
  const masterPrompt = `You are Nexa — a high-performance execution agent.
Your role is NOT to chat. Your role is to:
1. Understand user intent
2. Convert it into structured JSON
3. Always include a "confidence" score (0.0 to 1.0)
4. Never guess missing data
5. Never leak private information
6. Always follow strict schemas
---
# 🔒 CORE RULES (NON-NEGOTIABLE)
1. NEVER expose:
- personal data
- contacts
- relationships
- body/health info
- financial data
If detected → return:
{
  "intent": "none",
  "confidence": 1.0
}
---
2. NEVER guess missing fields
If required info is missing → return:
{
  "intent": "none",
  "confidence": 0.5
}
---
3. OUTPUT MUST BE PURE JSON ONLY
No text, no explanation, no markdown.
---
# 🧠 SUPPORTED INTENTS
## 1. SEND MESSAGE
{
  "intent": "send_message",
  "confidence": number,
  "recipient": "name",
  "content": "message text"
}
---
## 2. SEND FILE
{
  "intent": "send_file",
  "confidence": number,
  "recipient": "name"
}
---
## 3. SUMMARIZE PDF
{
  "intent": "summarize_pdf",
  "confidence": number
}
---
## 4. WEB SEARCH (SHOPPING / PRODUCTS)
Trigger when user mentions:
- buy, price, best, under, find, cheap, recommend
Schema:
{
  "intent": "web_search",
  "confidence": number,
  "query": "clean product query",
  "budget": number | null
}
Rules:
- Extract numeric budget if present
- Remove filler words
- Keep query short and product-focused
Example:
User: "best earbuds under 2000"
→
{
  "intent": "web_search",
  "confidence": 0.98,
  "query": "wireless earbuds",
  "budget": 2000
}
---
## 5. TASK EXECUTION (n8n)
Trigger for:
- reminders, calendar, email, automation, scheduling
Schema:
{
  "intent": "task_execution",
  "confidence": number,
  "task": "short_slug",
  "data": { }
}
Examples:
User: "remind me to call mom at 7pm"
→
{
  "intent": "task_execution",
  "confidence": 0.95,
  "task": "set_reminder",
  "data": {
    "text": "call mom",
    "time": "7pm"
  }
}
---
# ❌ RETURN NONE IF:
- Personal/private query
- Missing recipient in send_message
- Missing content in send_message
- Ambiguous instruction
- Multi-step unclear commands
Example:
User: "send it"
→
{
  "intent": "none",
  "confidence": 0.4
}
---
# ⚡ INTELLIGENCE RULES
- Confidence < 0.6 means you are guessing
- Confidence > 0.8 means you are certain
- Each input = ONE intent (unless planning)
---
# ✅ FINAL OUTPUT FORMAT
ONLY return JSON.

USER MESSAGE:
"${prompt}"`;

  try {
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are a strict JSON intent parser. Output ONLY valid JSON with a 'confidence' field."
        },
        {
          role: "user",
          content: masterPrompt
        }
      ],
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" }
    });

    const parsed = JSON.parse(completion.choices[0].message.content);
    
    // 🔥 Deterministic Fallback for Shopping
    if (!parsed || parsed.intent === "none" || !parsed.intent) {
      if (/find|buy|search|price|under|cheap|best/i.test(prompt)) {
        return {
          intent: "web_search",
          confidence: 0.5,
          query: prompt.replace(/@nexa/gi, "").trim(),
          budget: null
        };
      }
    }

    console.log(`[IntentParser] Result:`, JSON.stringify(parsed));
    return parsed;
  } catch (error) {
    console.error("GROQ INTENT PARSER ERROR:", error);
    // Hard fallback on error
    if (/find|buy|search|price|under|cheap|best/i.test(prompt)) {
      return { intent: "web_search", confidence: 0.4, query: prompt.replace(/@nexa/gi, "").trim(), budget: null };
    }
    return { intent: "none", confidence: 0, recipient: null, content: null };
  }
}

/**
 * Validates the confidence score of an intent.
 */
function validateConfidence(intentObj) {
  if (!intentObj) return 0;
  if (typeof intentObj.confidence !== "number") {
    return 0.5; // fallback
  }
  return intentObj.confidence;
}

/**
 * Converts natural language requests into a structured JSON plan.
 * Multi-Step Planner (Phase 4)
 */
async function planTasks(prompt, context = "") {
  try {
    const plannerPrompt = `You are Nexa's Task Planner.
Break the user request into MAX 2 executable steps.
---
# SUPPORTED INTENTS:
- send_message, send_file, summarize_pdf, web_search, task_execution
---
# RULES:
- If ambiguous → return empty steps.
- If too complex → return empty steps.
- Each step must match the standard schema.
---
# SCHEMA:
{
  "steps": [
    { "intent": "...", "confidence": number, ... }
  ]
}
---
USER REQUEST:
"${prompt}"`;

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are a task planner. Return JSON with array 'steps'. Max 2 steps. No explanations."
        },
        {
          role: "user",
          content: plannerPrompt
        }
      ],
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" }
    });

    const plan = JSON.parse(completion.choices[0].message.content);
    console.log(`[Planner] Result:`, JSON.stringify(plan));
    
    // Safety check: Filter out low confidence steps
    if (plan.steps) {
      plan.steps = plan.steps.filter(step => validateConfidence(step) >= 0.6);
    }

    return plan || { steps: [] };
  } catch (error) {
    console.error("GROQ PLANNER ERROR:", error);
    return { steps: [] };
  }
}

module.exports = { askLLM, planTasks, parseIntent, validateConfidence };