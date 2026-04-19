require('dotenv').config();
const { parseIntent } = require('./src/services/llmService');

(async () => {
  console.log("\n=== Testing Intent Parser with Web Search ===\n");
  
  // Test 1: Search query detection
  console.log("Test 1: 'find rcb jersey under 1000'");
  let result = await parseIntent("find rcb jersey under 1000");
  console.log("Result:", JSON.stringify(result, null, 2));
  console.log("");
  
  // Test 2: Search with different keyword
  console.log("Test 2: 'search best shoes under 2000'");
  result = await parseIntent("search best shoes under 2000");
  console.log("Result:", JSON.stringify(result, null, 2));
  console.log("");
  
  // Test 3: Regular send_message (should still work)
  console.log("Test 3: 'tell Jainam hello' (normal message)");
  result = await parseIntent("tell Jainam hello");
  console.log("Result:", JSON.stringify(result, null, 2));
  console.log("");

  console.log("✅ Intent parser tests complete!\n");
})().catch(err => {
  console.error("Test error:", err);
  process.exit(1);
});
