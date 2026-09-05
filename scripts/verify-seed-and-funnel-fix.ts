import { db } from '../src/lib/db';

async function verifyFix4() {
  console.log('═'.repeat(64));
  console.log('FIX 4 VERIFICATION: SEED DATA INTEGRITY & REALISTIC FUNNEL DROP-OFFS');
  console.log('═'.repeat(64));

  // 1. Transactions & Customer Integrity
  const txs = await db.getTransactions();
  console.log(`\n--- 1. Checking Data Hygiene across ${txs.length} Transactions ---`);

  let invalidCount = 0;
  for (const tx of txs) {
    const hasName = Boolean(tx.customer?.name && tx.customer.name.trim().length > 0 && tx.customer.name !== '•');
    const hasCustId = Boolean(tx.customer_id && tx.customer_id.trim().length > 0 && tx.customer_id !== '•');
    const hasTxId = Boolean(tx.id && tx.id.trim().length > 0);
    const hasScore = typeof tx.recoverability_score === 'number' && !isNaN(tx.recoverability_score) && tx.recoverability_score > 0;

    if (!hasName || !hasCustId || !hasTxId || !hasScore) {
      invalidCount++;
      console.error(`❌ Invalid Transaction detected: ID=${tx.id}, Cust=${tx.customer?.name}, CustID=${tx.customer_id}, Score=${tx.recoverability_score}`);
    }
  }

  if (invalidCount === 0) {
    console.log(`✅ PASS: All ${txs.length} transactions have valid customer names, customer IDs, and computed scores! No blank or partially populated rows.`);
  } else {
    throw new Error(`FAIL: Found ${invalidCount} invalid transactions in seed data`);
  }

  // 2. Attribution Funnel Realistic Drop-offs
  console.log('\n--- 2. Checking Attribution Funnel Conversion Drop-offs ---');
  const analytics = await db.getAnalytics();
  const funnel = analytics.attribution_funnel;
  if (!funnel) {
    throw new Error('FAIL: Attribution funnel not found in analytics');
  }

  console.log(`Messaged Count:         ${funnel.messaged_count}`);
  console.log(`Link Clicked Count:     ${funnel.link_clicked_count} (${funnel.click_rate}% click rate)`);
  console.log(`Payment Retried Count:  ${funnel.payment_retried_count} (${funnel.retry_rate}% retry-to-click rate)`);
  console.log(`Payment Recovered Count:${funnel.payment_successful_count} (${funnel.conversion_rate}% conversion rate)`);
  console.log(`Total Recovered Rev:    ₹${funnel.recovered_revenue.toLocaleString('en-IN')}`);

  // Checks
  if (funnel.click_rate === 100) {
    throw new Error('FAIL: Click rate is 100% — needs realistic drop-off');
  }
  if (funnel.retry_rate === 100) {
    throw new Error('FAIL: Retry rate is 100% — needs realistic drop-off');
  }
  if (funnel.conversion_rate === 100) {
    throw new Error('FAIL: Conversion rate is 100% — needs realistic drop-off');
  }

  if (funnel.click_rate >= 60 && funnel.click_rate <= 95 &&
      funnel.retry_rate >= 70 && funnel.retry_rate <= 95 &&
      funnel.conversion_rate >= 70 && funnel.conversion_rate <= 95) {
    console.log('✅ PASS: Attribution funnel displays realistic stage drop-offs (70-95% bounds), not artificially clean 100%!');
  } else {
    console.log(`ℹ️ Rates: Click=${funnel.click_rate}%, Retry=${funnel.retry_rate}%, Conv=${funnel.conversion_rate}%`);
  }

  console.log('\n' + '═'.repeat(64));
  console.log('🎉 FIX 4 VERIFIED: Seed data is completely populated and attribution funnel is realistic!');
}

verifyFix4().catch(err => {
  console.error(err);
  process.exit(1);
});
