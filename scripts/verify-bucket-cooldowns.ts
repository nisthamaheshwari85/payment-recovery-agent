import { evaluateRecoveryGuardrails, BUCKET_COOLDOWN_POLICIES } from '../src/lib/guardrails';
import { Transaction, RecoveryAttempt } from '../src/lib/types';

async function verifyBucketCooldowns() {
  console.log('================================================================');
  console.log('TASK 4 VERIFICATION: BUCKET-SPECIFIC CONFIGURABLE COOLDOWNS');
  console.log('================================================================');

  const baseTx: Transaction = {
    id: 'tx_cooldown_test',
    razorpay_payment_id: 'pay_cd_1',
    customer_id: 'cust_cd_1',
    amount: 2500,
    channel: 'checkout_web',
    failure_reason_raw: 'Switch timeout',
    failure_bucket: 'upi_timeout',
    recoverability_score: 85,
    status: 'failed',
    retry_payment_link: 'https://rzp.io/i/rec_cd',
    created_at: new Date(Date.now() - 3600000).toISOString(),
    updated_at: new Date().toISOString(),
  };

  // --- Test 1: UPI Timeout (45 min cooldown) ---
  console.log('\n--- Test 1: UPI Timeout (Policy: 45 min cooldown) ---');
  const now = Date.now();
  const upiAttempt20m: RecoveryAttempt[] = [
    {
      id: 'att_1',
      transaction_id: baseTx.id,
      customer_id: 'cust_cd_1',
      attempt_number: 1,
      channel: 'whatsapp',
      message_sent: 'Hello',
      sent_at: new Date(now - 20 * 60000).toISOString(), // 20 mins ago (< 45m)
      outcome: 'sent',
      retry_payment_link: 'https://rzp.io/i/rec_cd',
      message_category: 'transactional',
    },
  ];

  const upiBlocked = evaluateRecoveryGuardrails(baseTx, null, upiAttempt20m);
  console.log('20 min elapsed result:', { allowed: upiBlocked.allowed, code: upiBlocked.code, msg: upiBlocked.message });
  if (upiBlocked.allowed || upiBlocked.code !== 'COOLDOWN_ACTIVE' || !upiBlocked.message.includes('45m')) {
    throw new Error('FAILED: Expected UPI timeout to be blocked under 45m cooldown!');
  }
  console.log('✅ PASS: UPI Timeout correctly blocked at 20 min (< 45m policy).');

  const upiAttempt50m: RecoveryAttempt[] = [
    {
      ...upiAttempt20m[0],
      sent_at: new Date(now - 50 * 60000).toISOString(), // 50 mins ago (> 45m)
    },
  ];
  const upiAllowed = evaluateRecoveryGuardrails(baseTx, null, upiAttempt50m);
  console.log('50 min elapsed result:', { allowed: upiAllowed.allowed, code: upiAllowed.code });
  if (!upiAllowed.allowed) {
    throw new Error('FAILED: Expected UPI timeout to be allowed after 50m (> 45m policy)!');
  }
  console.log('✅ PASS: UPI Timeout correctly authorized after 50 min.');

  // --- Test 2: Insufficient Funds (Capped at 1 attempt) ---
  console.log('\n--- Test 2: Insufficient Funds (Policy: Cap at 1 attempt) ---');
  const fundsTx: Transaction = {
    ...baseTx,
    failure_bucket: 'insufficient_funds',
  };
  const fundsBlocked = evaluateRecoveryGuardrails(fundsTx, null, upiAttempt50m);
  console.log('1 attempt done result:', { allowed: fundsBlocked.allowed, code: fundsBlocked.code, msg: fundsBlocked.message });
  if (fundsBlocked.allowed || fundsBlocked.code !== 'MAX_ATTEMPTS_EXCEEDED') {
    throw new Error('FAILED: Insufficient funds must cap at 1 attempt!');
  }
  console.log('✅ PASS: Insufficient funds correctly capped at 1 attempt (customer harassment prevented).');

  // --- Test 3: Cart Abandon (Policy: 2 hours) ---
  console.log('\n--- Test 3: Cart Abandon (Policy: 2 hours cooldown) ---');
  const cartTx: Transaction = {
    ...baseTx,
    failure_bucket: 'cart_abandon',
  };
  const cartAttempt70m: RecoveryAttempt[] = [
    {
      ...upiAttempt20m[0],
      sent_at: new Date(now - 70 * 60000).toISOString(), // 70 min (< 120m)
    },
  ];
  const cartBlocked = evaluateRecoveryGuardrails(cartTx, null, cartAttempt70m);
  if (cartBlocked.allowed || cartBlocked.code !== 'COOLDOWN_ACTIVE' || !cartBlocked.message.includes('2h Cart Cooldown')) {
    throw new Error('FAILED: Cart abandon must require 2h cooldown!');
  }
  console.log('✅ PASS: Cart abandon blocked at 70m (< 2h policy).');

  const cartAttempt130m: RecoveryAttempt[] = [
    {
      ...upiAttempt20m[0],
      sent_at: new Date(now - 130 * 60000).toISOString(), // 130 min (> 120m)
    },
  ];
  const cartAllowed = evaluateRecoveryGuardrails(cartTx, null, cartAttempt130m);
  if (!cartAllowed.allowed) {
    throw new Error('FAILED: Cart abandon should be allowed after 2h!');
  }
  console.log('✅ PASS: Cart abandon allowed at 130m (> 2h policy).');

  console.log('\n================================================================');
  console.log('🎉 TASK 4 VERIFICATION COMPLETE: ALL BUCKET COOLDOWNS VERIFIED!');
  console.log('================================================================');
}

verifyBucketCooldowns().catch((err) => {
  console.error('Task 4 Verification Error:', err);
  process.exit(1);
});
