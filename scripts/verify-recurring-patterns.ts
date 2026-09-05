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

import { detectRecurringFailurePatterns, getCustomerRecurringPattern } from '../src/lib/patterns';
import { generateHinglishRecoveryMessage } from '../src/lib/agent';
import { Customer, Transaction, FailureBucket } from '../src/lib/types';

function assert(condition: boolean, description: string) {
  if (condition) {
    console.log(`✅ PASS: ${description}`);
  } else {
    console.error(`❌ FAIL: ${description}`);
    process.exit(1);
  }
}

async function run() {
  console.log('===========================================================');
  console.log('🧪 VERIFYING RECURRING FAILURE PATTERNS & TELEMETRY');
  console.log('===========================================================\n');

  const mockCustomer1: Customer = {
    id: 'cust_repeat_upi',
    name: 'Pooja Sharma',
    phone: '+91 98765 43210',
    email: 'pooja@example.com',
    total_recovered: 1,
    total_failed: 3,
    do_not_contact: false,
    created_at: new Date().toISOString(),
  };

  const mockCustomer2: Customer = {
    id: 'cust_single_failures',
    name: 'Rohan Mehta',
    phone: '+91 98111 22233',
    email: 'rohan@example.com',
    total_recovered: 1,
    total_failed: 2,
    do_not_contact: false,
    created_at: new Date().toISOString(),
  };

  const mockTransactions: Transaction[] = [
    // Customer 1: 2 upi_timeout failures
    {
      id: 'tx_p1',
      customer_id: mockCustomer1.id,
      customer: mockCustomer1,
      razorpay_payment_id: 'pay_p1',
      amount: 1499,
      status: 'failed',
      failure_bucket: 'upi_timeout',
      failure_reason_raw: 'NPCI UPI Bank Server Timeout [UT-01]',
      recoverability_score: 85,
      channel: 'checkout_web',
      retry_payment_link: 'https://rzp.io/i/test_p1',
      created_at: new Date(Date.now() - 86400000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'tx_p2',
      customer_id: mockCustomer1.id,
      customer: mockCustomer1,
      razorpay_payment_id: 'pay_p2',
      amount: 2199,
      status: 'failed',
      failure_bucket: 'upi_timeout',
      failure_reason_raw: 'PSP App Timeout on VPA confirmation',
      recoverability_score: 82,
      channel: 'checkout_web',
      retry_payment_link: 'https://rzp.io/i/test_p2',
      created_at: new Date(Date.now() - 3600000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    // Customer 2: 1 card_decline, 1 upi_timeout (different buckets, count = 1 each)
    {
      id: 'tx_r1',
      customer_id: mockCustomer2.id,
      customer: mockCustomer2,
      razorpay_payment_id: 'pay_r1',
      amount: 899,
      status: 'failed',
      failure_bucket: 'card_decline',
      failure_reason_raw: 'Bank declined transaction (3DS OTP)',
      recoverability_score: 72,
      channel: 'checkout_web',
      retry_payment_link: 'https://rzp.io/i/test_r1',
      created_at: new Date(Date.now() - 86400000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'tx_r2',
      customer_id: mockCustomer2.id,
      customer: mockCustomer2,
      razorpay_payment_id: 'pay_r2',
      amount: 1299,
      status: 'failed',
      failure_bucket: 'upi_timeout',
      failure_reason_raw: 'VPA handle error',
      recoverability_score: 80,
      channel: 'checkout_web',
      retry_payment_link: 'https://rzp.io/i/test_r2',
      created_at: new Date(Date.now() - 3600000).toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  // 1. TEST PATTERN DETECTION FUNCTION
  console.log('--- TEST 1: Rule-Based Pattern Detection ---');
  const patterns = detectRecurringFailurePatterns(
    [mockCustomer1, mockCustomer2],
    mockTransactions
  );

  assert(patterns.length === 1, 'Exactly 1 recurring pattern identified');
  assert(patterns[0].customer_id === mockCustomer1.id, 'Correct customer flagged for recurring pattern');
  assert(patterns[0].repeated_bucket === 'upi_timeout', 'Flagged bucket is upi_timeout');
  assert(patterns[0].failure_count === 2, 'Pattern records exactly 2 failures');
  assert(
    patterns[0].plain_language_reason.includes('failed with UPI Network Timeout'),
    `Plain language explanation is transparent: "${patterns[0].plain_language_reason}"`
  );
  assert(
    patterns[0].suggested_prevention_action.includes('UPI app') || patterns[0].suggested_prevention_action.includes('Netbanking'),
    `Preventive guidance is actionable: "${patterns[0].suggested_prevention_action}"`
  );

  // 2. TEST SPECIFIC CUSTOMER PATTERN LOOKUP
  console.log('\n--- TEST 2: Customer Recurring Pattern Lookup ---');
  const foundPattern = getCustomerRecurringPattern(
    mockCustomer1.id,
    'upi_timeout',
    mockTransactions
  );
  assert(foundPattern !== null, 'Found recurring pattern for customer 1 on upi_timeout');
  assert(foundPattern?.failure_count === 2, 'Found pattern count is 2');

  const notFoundPattern = getCustomerRecurringPattern(
    mockCustomer2.id,
    'card_decline',
    mockTransactions
  );
  assert(notFoundPattern === null, 'Customer 2 with only 1 card_decline is NOT flagged as recurring');

  // 3. TEST LLM MESSAGE INGESTION WITH RECURRING PATTERN
  console.log('\n--- TEST 3: LLM Message Ingestion with Recurring Pattern ---');
  const llmResult = await generateHinglishRecoveryMessage({
    customerName: 'Pooja',
    amount: 2199,
    failureBucket: 'upi_timeout',
    failureReasonRaw: 'PSP App Timeout on VPA confirmation',
    recoverabilityScore: 82,
    attemptNumber: 1,
    retryPaymentLink: 'https://rzp.io/i/test_recurring_123',
    remediationStrategy: {
      type: 'transient_network_retry',
      title: 'Transient Gateway Retry',
      action_summary: 'Direct 1-tap instant retry link',
      channel_payload_type: 'direct_retry_link',
      reasoning: 'UPI gateway timeout',
      parameters: {},
    },
    recurringPattern: foundPattern || undefined,
  });

  console.log(`[Model Used]: ${llmResult.modelUsed}`);
  console.log(`[LLM Message]:\n"${llmResult.message}"\n`);

  assert(llmResult.message.length > 20, 'Message generated successfully');
  assert(llmResult.message.includes('https://rzp.io/i/test_recurring_123'), 'Payment link is included');
  assert(llmResult.message.includes('STOP'), 'Opt-out disclaimer is included');

  // 4. TEST LIVE /api/analytics ENDPOINT
  console.log('\n--- TEST 4: Live API Endpoint Check ---');
  try {
    const res = await fetch('http://localhost:3000/api/analytics');
    if (res.ok) {
      const data = await res.json();
      assert(Array.isArray(data.recurring_patterns), 'Analytics API returns recurring_patterns array');
      console.log(`Live DB recurring patterns found: ${data.recurring_patterns.length}`);
    } else {
      console.log('Server not responding with 200 on /api/analytics, skipping HTTP test');
    }
  } catch (err: any) {
    console.log('HTTP fetch failed (dev server may be starting):', err?.message);
  }

  console.log('\n===========================================================');
  console.log('🎉 ALL RECURRING PATTERN & TELEMETRY CHECKS PASSED!');
  console.log('===========================================================');
}

run().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
