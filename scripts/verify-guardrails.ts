import { evaluateRecoveryGuardrails, sanitizeRecoveryMessage } from '../src/lib/guardrails';
import { computeRecoverabilityScore } from '../src/lib/scorer';
import { classifyFailureReason } from '../src/lib/classifier';
import { generateHinglishRecoveryMessage } from '../src/lib/agent';
import { Transaction, Customer, RecoveryAttempt } from '../src/lib/types';

async function runTests() {
  console.log('🧪 Starting Hard-Coded Guardrail & Pipeline Verification...\n');
  let passedCount = 0;
  let totalCount = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    totalCount++;
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passedCount++;
    } else {
      console.error(`❌ FAIL: ${testName} ${detail ? `- ${detail}` : ''}`);
      process.exitCode = 1;
    }
  }

  // TEST 1: Opt-Out / do_not_contact guardrail
  const optedOutCustomer: Customer = {
    id: 'cust_opt_1',
    name: 'Siddharth Rao',
    phone: '+919876543210',
    total_failed: 1,
    total_recovered: 0,
    do_not_contact: true,
    created_at: new Date().toISOString(),
  };

  const sampleTx: Transaction = {
    id: 'tx_test_1',
    razorpay_payment_id: 'pay_TEST123',
    amount: 1499,
    customer_id: 'cust_opt_1',
    channel: 'checkout_web',
    failure_reason_raw: 'NPCI timeout',
    failure_bucket: 'upi_timeout',
    recoverability_score: 85,
    status: 'failed',
    retry_payment_link: 'https://rzp.io/i/test',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const optOutResult = evaluateRecoveryGuardrails(sampleTx, optedOutCustomer, []);
  assert(
    !optOutResult.allowed && optOutResult.code === 'DO_NOT_CONTACT',
    'Guardrail 1: Strictly blocks message if do_not_contact = true',
    `Got ${optOutResult.code}`
  );

  // TEST 2: 6-Hour Cooldown constraint
  const activeCustomer: Customer = {
    ...optedOutCustomer,
    do_not_contact: false,
  };

  const recentAttempt: RecoveryAttempt = {
    id: 'att_1',
    transaction_id: sampleTx.id,
    customer_id: activeCustomer.id,
    attempt_number: 1,
    channel: 'whatsapp',
    message_sent: 'Test message',
    sent_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), // 2 hours ago (< 6h)
    outcome: 'sent',
    retry_payment_link: 'https://rzp.io/i/test',
  };

  const cooldownResult = evaluateRecoveryGuardrails(sampleTx, activeCustomer, [recentAttempt]);
  assert(
    !cooldownResult.allowed && cooldownResult.code === 'COOLDOWN_ACTIVE',
    'Guardrail 2: Strictly enforces minimum 6-hour gap between attempts (2h ago rejected)',
    `Got ${cooldownResult.code}, msg: ${cooldownResult.message}`
  );

  // TEST 3: Cooldown elapsed (> 6 hours) permits attempt 2
  const oldAttempt: RecoveryAttempt = {
    ...recentAttempt,
    sent_at: new Date(Date.now() - 7 * 3600 * 1000).toISOString(), // 7 hours ago (> 6h)
  };

  const cooldownElapsedResult = evaluateRecoveryGuardrails(sampleTx, activeCustomer, [oldAttempt]);
  assert(
    cooldownElapsedResult.allowed && cooldownElapsedResult.code === 'ALLOWED',
    'Guardrail 3: Permits attempt #2 after 6-hour cooldown has elapsed',
    `Got ${cooldownElapsedResult.code}`
  );

  // TEST 4: MAX 3 attempts limit
  const threeAttempts: RecoveryAttempt[] = [
    { ...oldAttempt, attempt_number: 1, sent_at: new Date(Date.now() - 20 * 3600 * 1000).toISOString() },
    { ...oldAttempt, attempt_number: 2, sent_at: new Date(Date.now() - 13 * 3600 * 1000).toISOString() },
    { ...oldAttempt, attempt_number: 3, sent_at: new Date(Date.now() - 7 * 3600 * 1000).toISOString() },
  ];

  const maxAttemptsResult = evaluateRecoveryGuardrails(sampleTx, activeCustomer, threeAttempts);
  assert(
    !maxAttemptsResult.allowed && maxAttemptsResult.code === 'MAX_ATTEMPTS_EXCEEDED',
    'Guardrail 4: Strictly rejects 4th attempt when max 3 attempts reached',
    `Got ${maxAttemptsResult.code}`
  );

  // TEST 5: Tone safety sanitizer (no dark patterns, appends opt-out)
  const dirtyMessage = 'HURRY! You will lose your cart and account will be blocked in 5 minutes! Click link now.';
  const sanitized = sanitizeRecoveryMessage(dirtyMessage);
  assert(
    sanitized.violationsFound.length > 0 &&
    !sanitized.cleanMessage.toLowerCase().includes('hurry') &&
    sanitized.cleanMessage.includes('Reply STOP to opt out'),
    'Guardrail 5: Sanitizes dark patterns and ensures opt-out notice',
    `Violations: ${sanitized.violationsFound.join(', ')}`
  );

  // TEST 6: Classifier accuracy
  const c1 = await classifyFailureReason('NPCI PSP response timeout after 45000ms: UPI_SESSION_TIMED_OUT');
  assert(c1.bucket === 'upi_timeout', 'Classifier: Accurately identifies upi_timeout');

  const c2 = await classifyFailureReason('Issuer bank declined transaction: 3DS OTP verification failed/timeout');
  assert(c2.bucket === 'card_decline', 'Classifier: Accurately identifies card_decline');

  const c3 = await classifyFailureReason('net::ERR_CONNECTION_RESET during redirect to gateway');
  assert(c3.bucket === 'network_error', 'Classifier: Accurately identifies network_error');

  // TEST 7: Scorer computation
  const score = computeRecoverabilityScore({
    failure_bucket: 'upi_timeout',
    amount: 999,
    customer: { ...activeCustomer, total_recovered: 2 },
    channel: 'upi_app',
  });
  assert(
    score.final_score >= 85,
    `Scorer: UPI timeout for repeat customer produces high recoverability score (${score.final_score}/100)`
  );

  // TEST 8: Hinglish message generation
  const hinglish = await generateHinglishRecoveryMessage({
    customerName: 'Aarav',
    amount: 1299,
    failureBucket: 'upi_timeout',
    failureReasonRaw: 'NPCI UPI Bank Server Timeout [UT-01]',
    recoverabilityScore: 88,
    attemptNumber: 1,
    retryPaymentLink: 'https://rzp.io/i/rec_test123',
  });
  assert(
    hinglish.message.length > 20 && hinglish.message.includes('https://rzp.io/i/rec_test123'),
    `Hinglish Agent: Generated empathetic message (${hinglish.modelUsed})`
  );
  console.log(`\n💬 Generated Sample Hinglish Message:\n"${hinglish.message}"\n`);

  console.log(`\n========================================`);
  console.log(`Summary: ${passedCount}/${totalCount} tests passed!`);
  console.log(`========================================\n`);
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
