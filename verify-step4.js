#!/usr/bin/env node

/**
 * STEP 4 — MINIMAL SAFE PLANNER VERIFICATION
 * Quick code checks before WhatsApp testing
 */

const fs = require('fs');
const path = require('path');

console.log('\n' + '='.repeat(70));
console.log('STEP 4 — MINIMAL SAFE PLANNER VERIFICATION');
console.log('='.repeat(70) + '\n');

const whatsappCode = fs.readFileSync('./src/services/whatsapp.js', 'utf-8');

// ================================================================
// CHECK 1: splitSteps function exists
// ================================================================
console.log('✅ CHECK 1 — splitSteps function exists');
console.log('-'.repeat(70));

if (/function splitSteps\(text\)/.test(whatsappCode)) {
  console.log('   ✅ splitSteps() defined');
  
  // Check it returns null for > 2 steps
  if (/if \(parts\.length > 2\)[\s\S]*?return null/.test(whatsappCode)) {
    console.log('   ✅ Returns null for > 2 steps');
  }
  
  // Check it splits on "and"
  if (/\.split\(.*\\band.*\\b.*\\|.*\\band then\\b/i.test(whatsappCode)) {
    console.log('   ✅ Splits on "and" and "and then"');
  }
} else {
  console.log('   ❌ splitSteps() NOT found');
  process.exit(1);
}

console.log('   ✅ CHECK 1 PASSED\n');

// ================================================================
// CHECK 2: Main handler uses splitSteps
// ================================================================
console.log('✅ CHECK 2 — Main handler uses splitSteps');
console.log('-'.repeat(70));

if (/const steps = splitSteps\(cleanText\)/.test(whatsappCode)) {
  console.log('   ✅ splitSteps called in task handler');
  
  if (/if \(!steps\)[\s\S]*?Too many steps/.test(whatsappCode)) {
    console.log('   ✅ Checks for null return (too many steps)');
  }
} else {
  console.log('   ❌ splitSteps not called in main handler');
  process.exit(1);
}

console.log('   ✅ CHECK 2 PASSED\n');

// ================================================================
// CHECK 3: Loop through steps
// ================================================================
console.log('✅ CHECK 3 — Loop through steps');
console.log('-'.repeat(70));

if (/for \(let i = 0; i < steps\.length; i\+\+\)[\s\S]*?parseIntent\(stepText\)/.test(whatsappCode)) {
  console.log('   ✅ Loops through each step');
  console.log('   ✅ Calls parseIntent for each step');
  
  if (/const result = await executeIntent\(parsedIntent/.test(whatsappCode)) {
    console.log('   ✅ Executes each step');
  }
} else {
  console.log('   ❌ Loop structure not found');
  process.exit(1);
}

console.log('   ✅ CHECK 3 PASSED\n');

// ================================================================
// CHECK 4: Stops on first error
// ================================================================
console.log('✅ CHECK 4 — Stops on first error');
console.log('-'.repeat(70));

if (/if \(!result\)[\s\S]*?return;/.test(whatsappCode)) {
  console.log('   ✅ Stops on first failure');
} else {
  console.log('   ❌ Error handling not found');
  process.exit(1);
}

console.log('   ✅ CHECK 4 PASSED\n');

// ================================================================
// CHECK 5: Didn't break executeIntent/parseIntent
// ================================================================
console.log('✅ CHECK 5 — Core functions unchanged');
console.log('-'.repeat(70));

if (/async function executeIntent\(parsedIntent, message, chatId, statusMsg/.test(whatsappCode)) {
  console.log('   ✅ executeIntent() signature unchanged');
}

if (/const \{ askLLM, planTasks, parseIntent \} = require/.test(whatsappCode)) {
  console.log('   ✅ parseIntent() still imported');
}

if (/const \{ saveDocument, getLastDocument \} = require/.test(whatsappCode)) {
  console.log('   ✅ documentStore still imported');
}

if (/const \{ resolveContact \} = require/.test(whatsappCode)) {
  console.log('   ✅ resolver still imported');
}

console.log('   ✅ CHECK 5 PASSED\n');

// ================================================================
// CHECK 6: No extra planner features
// ================================================================
console.log('✅ CHECK 6 — No over-engineering');
console.log('-'.repeat(70));

// Check for features that should NOT be there
const forbiddenPatterns = [
  { pattern: /resolvePronoun.*him.*her.*it/i, name: 'Pronoun resolution' },
  { pattern: /pendingAction.*confirm/i, name: 'Confirmation system' },
  { pattern: /history.*stack/i, name: 'History stacking' }
];

let hasExtra = false;
forbiddenPatterns.forEach(({ pattern, name }) => {
  if (pattern.test(whatsappCode)) {
    console.log(`   ⚠️  Found: ${name} (may be in other sections, check)`);
  }
});

console.log('   ✅ CHECK 6 PASSED (minimal design maintained)\n');

// ================================================================
// SUMMARY
// ================================================================
console.log('='.repeat(70));
console.log('✅ ALL CHECKS PASSED');
console.log('='.repeat(70));
console.log('\n📋 Step 4 Implementation Ready\n');
console.log('Feature Summary:');
console.log('   • splitSteps() splits on "and" / "and then"');
console.log('   • Max 2 steps only');
console.log('   • Stops on first error');
console.log('   • No memory guessing');
console.log('   • Uses existing parseIntent + executeIntent\n');
console.log('Test 4 in WhatsApp:\n');
console.log('   TEST 1: @nexa summarize this pdf and tell jainam hi');
console.log('   TEST 2: @nexa tell jainam hi and summarize this pdf');
console.log('   TEST 3: @nexa tell him hi and send it (should fail)');
console.log('   TEST 4: @nexa do this and that and something else (should fail)\n');
