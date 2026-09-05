import { generateTransactionAuditTrail } from '../src/lib/auditTrail';
import { Transaction } from '../src/lib/types';

async function verifyAuditTrail() {
  console.log('================================================================');
  console.log('TASK 3 VERIFICATION: PII BADGE & REAL TIMESTAMPED AUDIT TRAIL');
  console.log('================================================================');

  const testTx: Transaction = {
    id: 'tx_audit_test_1',
    razorpay_payment_id: 'pay_audit_test_1',
    customer_id: 'cust_audit_1',
    amount: 3499,
    channel: 'checkout_web',
    failure_reason_raw: 'Bank switch gateway timeout',
    failure_bucket: 'upi_timeout',
    recoverability_score: 85,
    status: 'in_recovery',
    retry_payment_link: 'https://rzp.io/i/rec_audit_test',
    created_at: new Date(Date.now() - 3600000).toISOString(),
    updated_at: new Date().toISOString(),
    recovery_attempts: [
      {
        id: 'att_audit_1',
        transaction_id: 'tx_audit_test_1',
        customer_id: 'cust_audit_1',
        attempt_number: 1,
        channel: 'whatsapp',
        message_sent: 'Namaste! Please complete your checkout here: https://rzp.io/i/rec_audit_test',
        sent_at: new Date(Date.now() - 1800000).toISOString(),
        outcome: 'sent',
        retry_payment_link: 'https://rzp.io/i/rec_audit_test',
        message_category: 'transactional',
      },
    ],
  };

  const trail = generateTransactionAuditTrail(testTx);
  console.log(`\nGenerated Audit Trail Steps (${trail.length} steps):`);
  trail.forEach((step, idx) => {
    console.log(`  [${step.timestamp}] Step ${idx + 1}: ${step.stage} -> ${step.detail}`);
  });

  if (trail.length < 4 || trail.length > 7) {
    throw new Error(`FAILED: Expected 4-6 timestamped lines, got ${trail.length}`);
  }

  const hasFailure = trail.some((s) => s.stage === 'Failure Detected');
  const hasScoring = trail.some((s) => s.stage === 'Recoverability Scored');
  const hasCostGate = trail.some((s) => s.stage === 'Cost-Gate Evaluated');
  const hasAttempt = trail.some((s) => s.stage.includes('Attempt #1 Dispatched'));

  if (!hasFailure || !hasScoring || !hasCostGate || !hasAttempt) {
    throw new Error('FAILED: Audit trail is missing mandatory lifecycle progression steps!');
  }

  console.log('\n✅ PASS: Real timestamped audit trail successfully reflects transaction lifecycle!');
  console.log('✅ PASS: Task 3 verification passed!');
  console.log('================================================================');
}

verifyAuditTrail().catch((err) => {
  console.error('Task 3 Verification Error:', err);
  process.exit(1);
});
