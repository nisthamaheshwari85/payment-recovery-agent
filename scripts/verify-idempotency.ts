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

import { razorpay } from '../src/lib/razorpay';
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
  console.log('🔒 VERIFYING TASK 3: PAYMENT LINK CREATION IDEMPOTENCY');
  console.log('================================================================\n');

  const testTxId = `tx_idem_${Date.now()}`;
  const attemptNum = 1;

  // TEST 1: Direct client idempotency verification
  console.log('--- TEST 1: Direct createPaymentLink Idempotency Check ---');
  const params = {
    amount: 1999,
    customerName: 'Ananya Roy',
    customerPhone: '+91 99887 76655',
    customerEmail: 'ananya@example.com',
    description: `Recovery attempt for ${testTxId}`,
    transactionId: testTxId,
    attemptNumber: attemptNum,
  };

  const firstCall = await razorpay.createPaymentLink(params);
  assert(firstCall.link !== null, 'First payment link creation succeeded');
  const firstLinkId = firstCall.link?.id;
  const firstShortUrl = firstCall.link?.short_url;
  console.log(`First Link Created: ID=${firstLinkId}, URL=${firstShortUrl}`);

  // Immediate second call with identical (transactionId + attemptNumber)
  const secondCall = await razorpay.createPaymentLink(params);
  assert(secondCall.link !== null, 'Second payment link call succeeded');
  const secondLinkId = secondCall.link?.id;
  const secondShortUrl = secondCall.link?.short_url;
  console.log(`Second Link Returned: ID=${secondLinkId}, URL=${secondShortUrl}`);

  assert(
    firstLinkId === secondLinkId,
    `Idempotent match: Link ID ${firstLinkId} === ${secondLinkId}`
  );
  assert(
    firstShortUrl === secondShortUrl,
    `Idempotent match: Short URL ${firstShortUrl} === ${secondShortUrl}`
  );

  // TEST 2: Concurrent/Double-Click Simulation on Recovery Action
  console.log('\n--- TEST 2: Double-Click Rapid Succession Recovery Action ---');
  const doubleClickTxId = `tx_dblclick_${Date.now()}`;
  const doubleClickTx: Transaction = {
    id: doubleClickTxId,
    razorpay_payment_id: `pay_dbl_${Date.now()}`,
    amount: 2999,
    customer_id: 'cust_idem_test',
    channel: 'checkout_web',
    failure_bucket: 'upi_timeout',
    failure_reason_raw: 'Bank UPI switch failure',
    recoverability_score: 88,
    status: 'failed',
    retry_payment_link: `https://rzp.io/i/init_${Date.now()}`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await db.createTransaction(doubleClickTx);

  // Trigger same recovery action twice in rapid succession (simulating network retry / double-click)
  const [res1, res2] = await Promise.all([
    executeRecoveryOutreach(doubleClickTxId),
    executeRecoveryOutreach(doubleClickTxId),
  ]);

  console.log(`Result 1 Payment Link ID: ${res1.attempt?.razorpay_payment_link_id}`);
  console.log(`Result 2 Payment Link ID: ${res2.attempt?.razorpay_payment_link_id}`);

  // Both should reference the exact same underlying Razorpay payment link
  assert(
    res1.attempt?.razorpay_payment_link_id === res2.attempt?.razorpay_payment_link_id,
    'Both concurrent attempts share the exact same idempotent payment link ID'
  );

  assert(
    res1.attempt?.retry_payment_link === res2.attempt?.retry_payment_link,
    'Both concurrent attempts share the exact same idempotent short URL'
  );

  console.log('\n================================================================');
  console.log('🎉 TASK 3 VERIFICATION COMPLETE: IDEMPOTENCY FULLY ENFORCED!');
  console.log('================================================================');
}

main().catch((err) => {
  console.error('Fatal error in idempotency verification:', err);
  process.exit(1);
});
