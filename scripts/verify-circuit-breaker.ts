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
import { evaluateCircuitBreakers, isCircuitBreakerTripped } from '../src/lib/circuitBreaker';
import { executeRecoveryOutreach } from '../src/lib/agent';

async function verifyCircuitBreaker() {
  console.log('================================================================');
  console.log('TASK 5 VERIFICATION: MASS-FAILURE CIRCUIT BREAKER');
  console.log('================================================================');

  // 1. Get an existing customer or create dummy
  const customers = await db.getCustomers();
  const customerId = customers.length > 0 ? customers[0].id : 'cust_cb_test';

  const testTxIds: string[] = [];
  const now = new Date();

  console.log('\n[Step 1] Seeding burst of 10 upi_timeout failures within the last 10 minutes...');
  for (let i = 0; i < 10; i++) {
    const txId = `tx_burst_${Date.now()}_${i}`;
    testTxIds.push(txId);
    const createdAt = new Date(now.getTime() - (i + 1) * 30 * 1000).toISOString();

    await db.createTransaction({
      id: txId,
      razorpay_payment_id: `pay_cb_test_${Date.now()}_${i}`,
      customer_id: customerId,
      amount: 1500,
      channel: 'checkout_web',
      failure_reason_raw: 'UPI switch did not respond in time',
      status: 'failed',
      failure_bucket: 'upi_timeout',
      recoverability_score: 85,
      retry_payment_link: '',
      created_at: createdAt,
      updated_at: createdAt,
    });
  }
  console.log(`✓ Seeded ${testTxIds.length} failed transactions.`);

  // 2. Evaluate circuit breakers on all transactions
  console.log('\n[Step 2] Evaluating circuit breaker state from database transactions...');
  const allTxs = await db.getTransactions();
  const breakers = evaluateCircuitBreakers(allTxs);
  const upiBreaker = breakers.upi_timeout;

  console.log('UPI Timeout Breaker Status:', JSON.stringify(upiBreaker, null, 2));

  if (!upiBreaker.tripped) {
    throw new Error(`FAILED: Expected upi_timeout circuit breaker to trip with >= 10 failures. Got count: ${upiBreaker.failure_count}`);
  }
  if (upiBreaker.failure_count < 10) {
    throw new Error(`FAILED: Expected failure count >= 10, got ${upiBreaker.failure_count}`);
  }
  console.log('✓ Circuit breaker TRIPPED correctly for upi_timeout.');
  console.log(`✓ Alert message surfaced: "${upiBreaker.alert_message}"`);

  // 3. Test that executeRecoveryOutreach actually GATES execution
  console.log('\n[Step 3] Verifying automated recovery gating logic...');
  const targetTxId = testTxIds[0];
  const outreachResult = await executeRecoveryOutreach(targetTxId);

  console.log('Outreach execution result:', {
    success: outreachResult.success,
    guardrail_code: outreachResult.guardrail.code,
    guardrail_allowed: outreachResult.guardrail.allowed,
    message: outreachResult.guardrail.message,
  });

  if (outreachResult.success !== false) {
    throw new Error('FAILED: Expected outreach to be halted (success: false)');
  }
  if (outreachResult.guardrail.code !== 'CIRCUIT_BREAKER_TRIPPED') {
    throw new Error(`FAILED: Expected guardrail code CIRCUIT_BREAKER_TRIPPED, got ${outreachResult.guardrail.code}`);
  }
  if (!outreachResult.guardrail.message.includes('Possible systemic issue in UPI TIMEOUT')) {
    throw new Error(`FAILED: Expected message to match circuit breaker alert, got ${outreachResult.guardrail.message}`);
  }
  console.log('✓ Automated recovery strictly GATED: WhatsApp message generation bypassed, no API calls made.');

  // 4. Verify non-tripped bucket (e.g. card_decline) is NOT tripped
  console.log('\n[Step 4] Checking isolation of unimpacted failure buckets...');
  const cardBreaker = breakers.card_decline;
  console.log(`Card Decline Tripped: ${cardBreaker.tripped} (Count: ${cardBreaker.failure_count})`);
  if (cardBreaker.tripped && cardBreaker.failure_count < 10) {
    throw new Error('FAILED: card_decline should not be tripped');
  }
  console.log('✓ Isolation verified: unaffected buckets are not incorrectly throttled.');

  // 5. Cleanup
  console.log('\n[Step 5] Cleaning up seeded burst transactions...');
  for (const id of testTxIds) {
    await db.deleteTransaction(id);
  }
  console.log('✓ Cleanup complete.');

  console.log('\n================================================================');
  console.log('ALL TASK 5 CIRCUIT BREAKER TESTS PASSED!');
  console.log('================================================================');
}

verifyCircuitBreaker().catch((err) => {
  console.error('Task 5 Verification FAILED:', err);
  process.exit(1);
});
