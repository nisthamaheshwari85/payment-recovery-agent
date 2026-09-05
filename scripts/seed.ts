import { executeSeed } from '../src/lib/seed';
import { db } from '../src/lib/db';

async function main() {
  console.log('🌱 Seeding Payment Recovery Agent synthetic dataset (50+ records)...');
  const counts = await executeSeed();
  console.log(`✅ Seeded successfully:`);
  console.log(`   - Customers: ${counts.customersCount}`);
  console.log(`   - Transactions: ${counts.transactionsCount}`);
  console.log(`   - Recovery Attempts: ${counts.attemptsCount}`);
  console.log(`   - Human Escalations: ${counts.escalationsCount}`);

  const analytics = await db.getAnalytics();
  console.log('\n📊 Analytics Preview:');
  console.log(`   - Total Revenue At Risk: ₹${analytics.total_revenue_at_risk.toLocaleString('en-IN')}`);
  console.log(`   - Total Recovered Revenue: ₹${analytics.total_recovered_revenue.toLocaleString('en-IN')}`);
  console.log(`   - Blended Recovery Rate: ${analytics.blended_recovery_rate}%`);
  console.log(`   - Recovered Transactions: ${analytics.recovered_count} / ${analytics.total_transactions}`);
  console.log(`   - Active in Recovery: ${analytics.active_in_recovery}`);
  console.log(`   - Human Review Queue: ${analytics.escalated_count}`);
  console.log(`   - Opted Out (STOP): ${analytics.opted_out_count}`);
}

main().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
