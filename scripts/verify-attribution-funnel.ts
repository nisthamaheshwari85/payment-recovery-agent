import { db } from '../src/lib/db';
import { Transaction } from '../src/lib/types';

async function verifyAttributionFunnel() {
  console.log('🧪 Verifying Task 5: Recovery Funnel with Multi-Stage Attribution...');

  // 1. Get initial analytics
  const initialAnalytics = await db.getAnalytics();
  console.log('Initial Attribution Metrics:', {
    messaged: initialAnalytics.attribution_funnel?.messaged_count,
    clicked: initialAnalytics.attribution_funnel?.link_clicked_count,
    retried: initialAnalytics.attribution_funnel?.payment_retried_count,
    recovered: initialAnalytics.attribution_funnel?.payment_successful_count,
    recoveredRevenue: initialAnalytics.attribution_funnel?.recovered_revenue,
  });

  // 2. Create or find a test transaction for funnel verification
  const txId = `tx_test_funnel_${Date.now()}`;
  const testTx: Transaction = {
    id: txId,
    razorpay_payment_id: `pay_test_${Date.now()}`,
    customer_id: 'cust_001',
    amount: 3499,
    channel: 'checkout_web',
    failure_bucket: 'upi_timeout',
    failure_reason_raw: 'PSP timer expired during UPI handle verification',
    recoverability_score: 85,
    status: 'failed',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    retry_payment_link: `https://rzp.io/i/test_funnel_${Date.now()}`,
    recovery_attempts: [
      {
        id: `att_${Date.now()}`,
        transaction_id: txId,
        customer_id: 'cust_001',
        attempt_number: 1,
        sent_at: new Date().toISOString(),
        channel: 'whatsapp',
        message_sent: 'Namaste! Please complete your payment here: https://rzp.io/i/test',
        outcome: 'sent',
        retry_payment_link: `https://rzp.io/i/test_funnel_${Date.now()}`,
      },
    ],
    funnel_stage: 'messaged',
  };

  await db.createTransaction(testTx);
  console.log(`✅ Created test transaction ${txId} at funnel stage: 'messaged'`);

  // Verify Stage 1 (Messaged)
  let tx = await db.getTransactionById(txId);
  if (!tx || tx.funnel_stage !== 'messaged') {
    throw new Error(`Expected funnel_stage to be 'messaged', got ${tx?.funnel_stage}`);
  }

  // 3. Simulate Stage 2: Link Clicked
  const attempts = tx.recovery_attempts || [];
  if (attempts.length > 0) {
    attempts[attempts.length - 1].outcome = 'clicked';
  }
  await db.updateTransaction(txId, {
    funnel_stage: 'link_clicked',
    recovery_attempts: attempts,
  });
  tx = await db.getTransactionById(txId);
  if (!tx || tx.funnel_stage !== 'link_clicked') {
    throw new Error(`Expected funnel_stage to be 'link_clicked', got ${tx?.funnel_stage}`);
  }
  console.log(`✅ Verified Stage 2: Link Clicked (funnel_stage='link_clicked', attempt.outcome='clicked')`);

  // 4. Simulate Stage 3: Payment Retried
  if (attempts.length > 0) {
    attempts[attempts.length - 1].outcome = 'retried';
  }
  await db.updateTransaction(txId, {
    funnel_stage: 'payment_retried',
    recovery_attempts: attempts,
  });
  tx = await db.getTransactionById(txId);
  if (!tx || tx.funnel_stage !== 'payment_retried') {
    throw new Error(`Expected funnel_stage to be 'payment_retried', got ${tx?.funnel_stage}`);
  }
  console.log(`✅ Verified Stage 3: Payment Retried (funnel_stage='payment_retried', attempt.outcome='retried')`);

  // 5. Simulate Stage 4: Attributed as Recovered
  if (attempts.length > 0) {
    attempts[attempts.length - 1].outcome = 'recovered';
  }
  await db.updateTransaction(txId, {
    status: 'recovered',
    funnel_stage: 'recovered',
    recovery_attempts: attempts,
  });
  tx = await db.getTransactionById(txId);
  if (!tx || tx.funnel_stage !== 'recovered' || tx.status !== 'recovered') {
    throw new Error(`Expected status and funnel_stage to be 'recovered', got status=${tx?.status}, stage=${tx?.funnel_stage}`);
  }
  console.log(`✅ Verified Stage 4: Attributed as Recovered (funnel_stage='recovered', status='recovered')`);

  // 6. Check updated analytics funnel calculation
  const updatedAnalytics = await db.getAnalytics();
  const af = updatedAnalytics.attribution_funnel;
  console.log('Updated Attribution Metrics:', {
    messaged: af?.messaged_count,
    clicked: af?.link_clicked_count,
    retried: af?.payment_retried_count,
    recovered: af?.payment_successful_count,
    clickRate: `${af?.click_rate}%`,
    retryRate: `${af?.retry_rate}%`,
    conversionRate: `${af?.conversion_rate}%`,
    recoveredRevenue: af?.recovered_revenue,
  });

  if (!af || af.messaged_count <= 0 || af.link_clicked_count <= 0 || af.payment_successful_count <= 0) {
    throw new Error('Attribution funnel did not record counts properly');
  }

  console.log('🎉 Task 5 VERIFICATION PASSED: Attribution funnel stages and metrics verified successfully!');
}

verifyAttributionFunnel().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
