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
import { setPaymentStateLog } from '../src/lib/paymentStateLog';

async function verifyLateCapture() {
  console.log('================================================================');
  console.log('TASK 1 VERIFICATION: PAYMENT-STATE RE-VERIFICATION (LATE CAPTURE)');
  console.log('================================================================');

  const customers = await db.getCustomers();
  const customerId = customers.length > 0 ? customers[0].id : 'cust_0001';

  // Test Case 1: Late-Captured transaction
  const lateCaptureTxId = 'tx_test_late_captured_demo';
  await db.createTransaction({
    id: lateCaptureTxId,
    razorpay_payment_id: 'pay_late_cap_test_1',
    customer_id: customerId,
    amount: 1999,
    channel: 'upi_app',
    failure_reason_raw: 'UPI switch did not respond in time',
    failure_bucket: 'upi_timeout',
    recoverability_score: 88,
    status: 'failed',
    retry_payment_link: 'https://rzp.io/i/rec_test_latecap',
    created_at: new Date(Date.now() - 20 * 60000).toISOString(),
    updated_at: new Date(Date.now() - 20 * 60000).toISOString(),
  });

  // Explicitly register as captured in the payment state log (simulated late authorization)
  setPaymentStateLog(lateCaptureTxId, 'captured', 'NPCI switch settled late authorization after timeout');

  console.log('\n[Step 1] Executing recovery outreach on late-captured transaction...');
  const lateResult = await executeRecoveryOutreach(lateCaptureTxId);

  console.log('Late capture outreach result:', {
    success: lateResult.success,
    guardrail_code: lateResult.guardrail.code,
    message: lateResult.guardrail.message,
    status: lateResult.transaction?.status,
  });

  if (lateResult.success !== false) {
    throw new Error('FAILED: Expected outreach to be cancelled for late-captured payment.');
  }
  if (lateResult.guardrail.code !== 'AUTO_RESOLVED_LATE_CAPTURE') {
    throw new Error(`FAILED: Expected guardrail code AUTO_RESOLVED_LATE_CAPTURE, got ${lateResult.guardrail.code}`);
  }
  if (lateResult.guardrail.message !== 'Payment state changed to captured after initial failure; outreach cancelled.') {
    throw new Error(`FAILED: Unexpected guardrail message: ${lateResult.guardrail.message}`);
  }
  if (lateResult.transaction?.status !== 'auto_resolved_late_capture') {
    throw new Error(`FAILED: Expected transaction status auto_resolved_late_capture, got ${lateResult.transaction?.status}`);
  }
  console.log('✅ PASS: Late-captured payment outreach cancelled and status marked as Auto-Resolved (Late Capture)');

  // Test Case 2: Normal-Failed transaction
  const normalFailedTxId = 'tx_test_normal_failed_demo';
  await db.createTransaction({
    id: normalFailedTxId,
    razorpay_payment_id: 'pay_normal_fail_test_2',
    customer_id: customerId,
    amount: 2499,
    channel: 'checkout_web',
    failure_reason_raw: 'Bank gateway timeout during OTP authorization',
    failure_bucket: 'upi_timeout',
    recoverability_score: 85,
    status: 'failed',
    retry_payment_link: 'https://rzp.io/i/rec_test_normfail',
    created_at: new Date(Date.now() - 20 * 60000).toISOString(),
    updated_at: new Date(Date.now() - 20 * 60000).toISOString(),
  });

  // Explicitly register as still failed in state log
  setPaymentStateLog(normalFailedTxId, 'failed', 'Confirmed failed: no late authorization');

  console.log('\n[Step 2] Executing recovery outreach on normal failed transaction...');
  const normalResult = await executeRecoveryOutreach(normalFailedTxId);

  console.log('Normal failed outreach result:', {
    success: normalResult.success,
    attempt_number: normalResult.attempt?.attempt_number,
    status: normalResult.transaction?.status,
  });

  if (!normalResult.success) {
    throw new Error(`FAILED: Normal failed transaction should proceed with outreach, got ${JSON.stringify(normalResult)}`);
  }
  console.log('✅ PASS: Normal failed payment correctly proceeds with outreach!');

  // Cleanup
  await db.deleteTransaction(lateCaptureTxId);
  await db.deleteTransaction(normalFailedTxId);
  console.log('✅ PASS: Test transactions cleaned up.');

  console.log('\n================================================================');
  console.log('🎉 TASK 1 VERIFICATION COMPLETE: ALL TESTS PASSED!');
  console.log('================================================================');
}

verifyLateCapture().catch((err) => {
  console.error('Task 1 Verification Error:', err);
  process.exit(1);
});
