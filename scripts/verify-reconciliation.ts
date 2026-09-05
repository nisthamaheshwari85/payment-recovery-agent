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

import { db } from '../src/lib/db';
import { executeRecoveryOutreach } from '../src/lib/agent';
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
  console.log('🔄 VERIFYING TASK 2: RECONCILIATION CORRECTNESS & LINEAGE');
  console.log('================================================================\n');

  // Step 1: Record initial baseline metrics
  const initialAnalytics = await db.getAnalytics();
  const initialTxs = await db.getTransactions();
  const initialTxCount = initialTxs.length;
  const initialRecoveredRevenue = initialAnalytics.total_recovered_revenue;
  const initialRecoveredCount = initialAnalytics.recovered_count;

  console.log(`Baseline State: ${initialTxCount} transactions, ${initialRecoveredCount} recovered, ₹${initialRecoveredRevenue} recovered revenue.`);

  // Step 2: Seed ONE failed transaction
  const testTxId = `tx_recon_${Date.now()}`;
  const testAmount = 2499;
  const testTx: Transaction = {
    id: testTxId,
    razorpay_payment_id: `pay_orig_${Date.now()}`,
    amount: testAmount,
    customer_id: 'cust_recon_test',
    channel: 'checkout_web',
    failure_bucket: 'upi_timeout',
    failure_reason_raw: 'Bank NPCI gateway timeout on authorization',
    recoverability_score: 85,
    status: 'failed',
    retry_payment_link: `https://rzp.io/i/recon_${Date.now()}`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await db.createTransaction(testTx);
  console.log(`Seeded failed transaction ${testTxId} (Amount: ₹${testAmount}).`);

  // Step 3: Trigger recovery outreach to generate payment link
  const outreachRes = await executeRecoveryOutreach(testTxId);
  assert(outreachRes.success === true, 'Outreach succeeded and created recovery attempt');
  const paymentLinkId = outreachRes.transaction?.razorpay_payment_link_id;
  assert(paymentLinkId !== undefined, `Payment link created with ID: ${paymentLinkId}`);

  // Step 4: Simulate Razorpay payment_link.paid webhook event
  console.log('\nSimulating payment_link.paid event via Webhook Handler...');
  const webhookPayload = {
    entity: 'event',
    account_id: 'acc_test_recon',
    event: 'payment_link.paid',
    contains: ['payment_link', 'payment'],
    payload: {
      payment_link: {
        entity: {
          id: paymentLinkId,
          amount: testAmount * 100,
          status: 'paid',
          notes: {
            transaction_id: testTxId,
          },
        },
      },
      payment: {
        entity: {
          id: `pay_success_${Date.now()}`,
          amount: testAmount * 100,
          status: 'captured',
          order_id: `order_${Date.now()}`,
        },
      },
    },
    created_at: Math.floor(Date.now() / 1000),
  };

  // Directly invoke the webhook route logic by POST request to local dev server
  const webhookRes = await fetch('http://localhost:3000/api/webhooks/razorpay', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Provide valid secret signature if secret exists, else dev endpoint accepts
      ...(process.env.RAZORPAY_WEBHOOK_SECRET
        ? {
            'x-razorpay-signature': require('crypto')
              .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
              .update(JSON.stringify(webhookPayload))
              .digest('hex'),
          }
        : {}),
    },
    body: JSON.stringify(webhookPayload),
  });

  const webhookJson = await webhookRes.json();
  console.log('Webhook Response:', webhookJson);
  assert(webhookRes.ok, 'Webhook returned HTTP 200 OK');

  // Step 5: AUDIT DATABASE FOR EXACT LINEAGE AND ZERO DOUBLE-COUNTING
  console.log('\n--- Auditing Database Lineage & Reconciliation ---');
  const afterTxs = await db.getTransactions();
  const afterAnalytics = await db.getAnalytics();

  // Check 1: Exactly ONE transaction was added (the seeded one), NO phantom second record
  assert(
    afterTxs.length === initialTxCount + 1,
    `Database transaction count strictly equals baseline + 1 (${afterTxs.length} === ${initialTxCount + 1}). No duplicate transaction was created!`
  );

  // Check 2: The ORIGINAL transaction record updated status to 'recovered'
  const updatedOriginalTx = await db.getTransactionById(testTxId);
  assert(updatedOriginalTx !== null, 'Original transaction record exists');
  assert(
    updatedOriginalTx?.status === 'recovered',
    `Original transaction ${testTxId} status updated to "recovered" in-place`
  );
  assert(
    updatedOriginalTx?.amount === testAmount,
    `Original transaction amount preserved at ₹${testAmount}`
  );

  // Check 3: "Total Recovered" dashboard figure increments by EXACTLY testAmount — NOT double-counted
  const revenueDelta = afterAnalytics.total_recovered_revenue - initialRecoveredRevenue;
  assert(
    revenueDelta === testAmount,
    `Dashboard Total Recovered Revenue incremented by exactly ₹${testAmount} (Delta: ₹${revenueDelta}). Zero double counting!`
  );

  // Check 4: Recovered Count incremented by exactly 1
  const countDelta = afterAnalytics.recovered_count - initialRecoveredCount;
  assert(
    countDelta === 1,
    `Dashboard Recovered Count incremented by exactly 1 (Delta: ${countDelta})`
  );

  console.log('\n================================================================');
  console.log('🎉 TASK 2 VERIFICATION COMPLETE: RECONCILIATION IS 100% CORRECT!');
  console.log('================================================================');
}

main().catch((err) => {
  console.error('Fatal error in reconciliation verification:', err);
  process.exit(1);
});
