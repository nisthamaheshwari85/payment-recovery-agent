import fs from 'fs';
import path from 'path';

// Auto-load .env.local
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

import { validateTransactionalCompliance } from '../src/lib/guardrails';
import { executeRecoveryOutreach } from '../src/lib/agent';
import { db } from '../src/lib/db';
import { Transaction } from '../src/lib/types';

function assert(condition: boolean, description: string) {
  if (condition) {
    console.log(`✅ PASS: ${description}`);
  } else {
    console.error(`❌ FAIL: ${description}`);
    process.exit(1);
  }
}

async function main() {
  console.log('================================================================');
  console.log('📜 VERIFYING TASK 1: TRAI DLT TRANSACTIONAL COMPLIANCE');
  console.log('================================================================\n');

  // TEST 1: Promotional text MUST be rejected
  console.log('--- TEST 1: Rejecting Promotional / Marketing Copy ---');
  const promoSample1 = 'Namaste! Use coupon code SAVE5 for 5% discount on checkout: https://rzp.io/i/123';
  const promoCheck1 = validateTransactionalCompliance(promoSample1);
  assert(!promoCheck1.isCompliant, 'Correctly flags coupon and discount language');
  assert(promoCheck1.classification === 'promotional_rejected', 'Classified as promotional_rejected');
  console.log(`Matched violations: ${promoCheck1.violations.join(', ')}`);

  const promoSample2 = 'Hurry up! Special offer expires in 10 minutes, grab now: https://rzp.io/i/456';
  const promoCheck2 = validateTransactionalCompliance(promoSample2);
  assert(!promoCheck2.isCompliant, 'Correctly flags urgency and offer expires language');
  console.log(`Matched violations: ${promoCheck2.violations.join(', ')}`);

  // TEST 2: Transactional text MUST be approved
  console.log('\n--- TEST 2: Approving Clean Transactional Copy ---');
  const txSample =
    'Namaste Aarav! Dekha aapka ₹1299 ka payment UPI network timeout ki wajah se complete nahi ho paya. Direct retry kar sakte hain: https://rzp.io/i/test (Reply STOP to opt out)';
  const txCheck = validateTransactionalCompliance(txSample);
  assert(txCheck.isCompliant, 'Clean recovery message passes compliance check');
  assert(txCheck.classification === 'transactional', 'Classified as transactional');

  // TEST 3: End-to-end agent outreach stores message_category: 'transactional'
  console.log('\n--- TEST 3: End-to-End Agent Execution Stores message_category: "transactional" ---');
  const testTxId = `tx_dlt_test_${Date.now()}`;
  const testTx: Transaction = {
    id: testTxId,
    razorpay_payment_id: 'pay_dlt_test_001',
    amount: 1999,
    customer_id: 'cust_dlt_test',
    channel: 'checkout_web',
    failure_bucket: 'upi_timeout',
    failure_reason_raw: 'Bank NPCI gateway timeout',
    recoverability_score: 85,
    status: 'failed',
    retry_payment_link: 'https://rzp.io/i/test_dlt_link',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await db.createTransaction(testTx);
  const result = await executeRecoveryOutreach(testTxId);

  assert(result.success === true, 'Recovery outreach succeeded');
  assert(result.attempt !== undefined, 'Recovery attempt was created');
  assert(
    result.attempt?.message_category === 'transactional',
    `Recovery attempt has message_category = "${result.attempt?.message_category}"`
  );
  assert(
    result.attempt?.guardrail_checks?.dlt_compliance_checked === true,
    'Guardrail check recorded dlt_compliance_checked = true'
  );

  const messageSent = result.attempt?.message_sent || '';
  const finalCheck = validateTransactionalCompliance(messageSent);
  assert(
    finalCheck.isCompliant,
    `Live generated message is 100% compliant with zero promotional language: "${messageSent}"`
  );

  console.log('\n================================================================');
  console.log('🎉 TASK 1 VERIFICATION COMPLETE: ALL DLT CHECKS PASSED!');
  console.log('================================================================');
}

main().catch((err) => {
  console.error('Fatal error in DLT verification:', err);
  process.exit(1);
});
