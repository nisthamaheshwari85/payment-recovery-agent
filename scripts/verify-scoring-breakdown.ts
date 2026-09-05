import { computeExplainableScoreBreakdown } from '../src/lib/scoringBreakdown';
import { Transaction } from '../src/lib/types';

async function verifyScoringBreakdown() {
  console.log('================================================================');
  console.log('TASK 2 VERIFICATION: EXPLAINABLE ADDITIVE SCORING BREAKDOWN');
  console.log('================================================================');

  // Test Case 1: Fresh UPI Timeout under ₹1500 (Ideal conversion)
  const upiTx: Transaction = {
    id: 'tx_score_upi',
    razorpay_payment_id: 'pay_score_1',
    customer_id: 'cust_1',
    amount: 1200,
    channel: 'upi_app',
    failure_reason_raw: 'UPI switch timeout',
    failure_bucket: 'upi_timeout',
    recoverability_score: 88,
    status: 'failed',
    retry_payment_link: 'https://rzp.io/i/test_upi',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    recovery_attempts: [],
  };

  const upiBreakdown = computeExplainableScoreBreakdown(upiTx);
  console.log('\n--- Case 1: Fresh UPI Timeout (₹1200, 0 attempts) ---');
  for (const item of upiBreakdown.items) {
    console.log(`  ${item.points > 0 ? '+' : ''}${item.points} | ${item.label} -> ${item.explanation}`);
  }
  console.log(`Total Score Computed: ${upiBreakdown.total_score}/100`);

  const hasInitiated = upiBreakdown.items.some((i) => i.id === 'stage_initiated' && i.points === 25);
  const hasTransient = upiBreakdown.items.some((i) => i.id === 'transient_failure' && i.points === 20);
  const hasTierBonus = upiBreakdown.items.some((i) => i.id === 'order_tier_low' && i.points === 15);
  const hasZeroAttempts = upiBreakdown.items.some((i) => i.id === 'attempt_fresh' && i.points === 15);

  if (!hasInitiated || !hasTransient || !hasTierBonus || !hasZeroAttempts) {
    throw new Error('FAILED: Expected +25 Initiated, +20 Transient, +15 Tier bonus, +15 Fresh attempt!');
  }
  console.log('✅ PASS: Real additive breakdown computed from real transaction fields!');

  // Test Case 2: Cart Abandonment with high ticket
  const cartTx: Transaction = {
    id: 'tx_score_cart',
    razorpay_payment_id: 'pay_score_2',
    customer_id: 'cust_2',
    amount: 22000,
    channel: 'checkout_web',
    failure_reason_raw: 'User closed modal before payment',
    failure_bucket: 'cart_abandon',
    recoverability_score: 55,
    status: 'failed',
    retry_payment_link: 'https://rzp.io/i/test_cart',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    recovery_attempts: [],
  };

  const cartBreakdown = computeExplainableScoreBreakdown(cartTx);
  console.log('\n--- Case 2: Cart Abandonment (High Ticket ₹22000) ---');
  for (const item of cartBreakdown.items) {
    console.log(`  ${item.points > 0 ? '+' : ''}${item.points} | ${item.label}`);
  }
  console.log(`Total Score Computed: ${cartBreakdown.total_score}/100`);

  const hasAbandonStage = cartBreakdown.items.some((i) => i.id === 'stage_abandon');
  const hasHighTicketPenalty = cartBreakdown.items.some((i) => i.id === 'order_tier_high' && i.points === -5);

  if (!hasAbandonStage || !hasHighTicketPenalty) {
    throw new Error('FAILED: Expected cart-stage and high ticket penalty for high-value abandon!');
  }
  console.log('✅ PASS: Distinct factors applied correctly for cart abandonment & high ticket size!');

  // Test Case 3: Customer with Repeat Failure Penalty
  const repeatTx: Transaction = {
    ...upiTx,
    id: 'tx_score_repeat',
    has_recurring_failure: true,
  };
  const repeatBreakdown = computeExplainableScoreBreakdown(repeatTx);
  const hasRepeatPenalty = repeatBreakdown.items.some((i) => i.id === 'repeat_failure_penalty' && i.points === -10);

  if (!hasRepeatPenalty) {
    throw new Error('FAILED: Expected -10 penalty for repeat failure history!');
  }
  console.log('✅ PASS: -10 Repeated failure history penalty computed from real customer flag!');

  console.log('\n================================================================');
  console.log('🎉 TASK 2 VERIFICATION COMPLETE: ALL TESTS PASSED!');
  console.log('================================================================');
}

verifyScoringBreakdown().catch((err) => {
  console.error('Task 2 Verification Error:', err);
  process.exit(1);
});
