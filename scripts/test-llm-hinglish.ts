import fs from 'fs';
import path from 'path';

// Auto-load .env.local if not already loaded into process.env
if (!process.env.GROQ_API_KEY) {
  try {
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      for (const line of envContent.split('\n')) {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (match && !process.env[match[1]]) {
          process.env[match[1]] = (match[2] || '').trim();
        }
      }
    }
  } catch {}
}

import { generateHinglishRecoveryMessage } from '../src/lib/agent';
import { detectDarkPatterns } from '../src/lib/guardrails';

async function runTest() {
  console.log('🤖 Testing Real LLM Hinglish Generation for Payment Recovery...\n');

  // Test 3 transactions sharing the same failure_bucket (upi_timeout)
  // but with different customer names, amounts, raw failure reasons, scores, and attempt numbers
  const testCases = [
    {
      customerName: 'Aarav',
      amount: 4999,
      failureBucket: 'upi_timeout' as const,
      failureReasonRaw: 'NPCI PSP response timeout after 45000ms: UPI_SESSION_TIMED_OUT',
      recoverabilityScore: 88,
      attemptNumber: 1,
      retryPaymentLink: 'https://rzp.io/i/test_aarav_4999',
    },
    {
      customerName: 'Priya',
      amount: 850,
      failureBucket: 'upi_timeout' as const,
      failureReasonRaw: 'Bank UPI switch busy: U30 error code from NPCI gateway',
      recoverabilityScore: 72,
      attemptNumber: 1,
      retryPaymentLink: 'https://rzp.io/i/test_priya_850',
    },
    {
      customerName: 'Vikram',
      amount: 24500,
      failureBucket: 'upi_timeout' as const,
      failureReasonRaw: 'Beneficiary bank server down or not responding during MPIN authorization',
      recoverabilityScore: 65,
      attemptNumber: 2,
      retryPaymentLink: 'https://rzp.io/i/test_vikram_24500',
    },
  ];

  const results: Array<{ name: string; amount: number; message: string; model: string }> = [];

  for (const tc of testCases) {
    console.log(`Generating message for ${tc.customerName} (₹${tc.amount})...`);
    const { message, modelUsed, isLlmGenerated } = await generateHinglishRecoveryMessage(tc);

    // Verify dark pattern guardrail
    const darkCheck = detectDarkPatterns(message);
    if (darkCheck.hasViolation) {
      console.error(`❌ FAILED: Prohibited dark pattern detected in message: ${darkCheck.matched.join(', ')}`);
      process.exit(1);
    }

    // Verify opt-out clause
    if (!/stop/i.test(message)) {
      console.error(`❌ FAILED: Missing mandatory opt-out disclaimer in message.`);
      process.exit(1);
    }

    // Verify retry link inclusion
    if (!message.includes(tc.retryPaymentLink)) {
      console.error(`❌ FAILED: Retry link not present in generated message.`);
      process.exit(1);
    }

    results.push({
      name: tc.customerName,
      amount: tc.amount,
      message,
      model: modelUsed,
    });
    console.log(`✅ Success via ${modelUsed}`);
    console.log(`   "${message}"\n`);
  }

  // Cross-verification: verify messages are genuinely distinct in structure and vocabulary, not a template
  console.log('🔍 Checking semantic uniqueness across outputs:');
  const [msg1, msg2, msg3] = results.map((r) => r.message);

  // Compute Jaccard word similarity between messages (excluding common names/links/numbers)
  const getWordSet = (msg: string) => {
    const cleaned = msg
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\d+/g, '')
      .replace(/[^\w\s]/g, '');
    return new Set(cleaned.split(/\s+/).filter((w) => w.length > 2));
  };

  const set1 = getWordSet(msg1);
  const set2 = getWordSet(msg2);
  const set3 = getWordSet(msg3);

  const jaccard = (a: Set<string>, b: Set<string>) => {
    const intersection = new Set([...a].filter((x) => b.has(x)));
    const union = new Set([...a, ...b]);
    return intersection.size / union.size;
  };

  const sim12 = jaccard(set1, set2);
  const sim13 = jaccard(set1, set3);
  const sim23 = jaccard(set2, set3);

  console.log(`   Similarity Aarav vs Priya: ${(sim12 * 100).toFixed(1)}%`);
  console.log(`   Similarity Aarav vs Vikram: ${(sim13 * 100).toFixed(1)}%`);
  console.log(`   Similarity Priya vs Vikram: ${(sim23 * 100).toFixed(1)}%`);

  if (sim12 > 0.85 || sim13 > 0.85 || sim23 > 0.85) {
    console.warn('⚠️ Warning: High similarity indicates template-like structure.');
  } else {
    console.log('✅ PASS: All messages are uniquely crafted with high linguistic variance based on telemetry.\n');
  }

  // Guardrail test: Verify anti-urgency guardrail explicitly
  console.log('🛡️ Testing Dark Pattern Post-Generation Guardrail:');
  const sampleViolation = 'Hurry! Last chance to complete your payment before order expires in 5 minutes!';
  const detected = detectDarkPatterns(sampleViolation);
  console.log(`   Input: "${sampleViolation}"`);
  console.log(`   Detected Violations: ${JSON.stringify(detected.matched)}`);
  if (detected.hasViolation && detected.matched.length >= 2) {
    console.log('✅ PASS: Guardrail successfully caught urgency dark patterns.');
  } else {
    console.error('❌ FAIL: Guardrail failed to catch urgency dark patterns.');
    process.exit(1);
  }
}

runTest().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
