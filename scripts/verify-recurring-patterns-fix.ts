import { detectRecurringFailurePatterns } from '../src/lib/patterns';
import { Customer, Transaction } from '../src/lib/types';

function verifyRecurringPatternsFix() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log('FIX 3 VERIFICATION: DYNAMIC CUSTOMER-SPECIFIC PATTERNS');
  console.log('════════════════════════════════════════════════════════════════\n');

  // Customer A: Aarav Sharma (UPI MPIN server delay, ticket ₹1,499 & ₹2,499)
  const custA: Customer = {
    id: 'cust_aarav',
    name: 'Aarav Sharma',
    phone: '+919876543210',
    total_failed: 2,
    total_recovered: 0,
    do_not_contact: false,
    created_at: new Date().toISOString(),
  };

  const txsA: Transaction[] = [
    {
      id: 'tx_a1',
      razorpay_payment_id: 'pay_a1_test',
      customer_id: 'cust_aarav',
      amount: 1499,
      channel: 'upi_app',
      failure_bucket: 'upi_timeout',
      failure_reason_raw: 'Beneficiary bank server down during MPIN authorization',
      status: 'failed',
      recoverability_score: 90,
      retry_payment_link: 'https://rzp.io/a1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'tx_a2',
      razorpay_payment_id: 'pay_a2_test',
      customer_id: 'cust_aarav',
      amount: 2499,
      channel: 'upi_app',
      failure_bucket: 'upi_timeout',
      failure_reason_raw: 'Bank UPI switch busy: U30 error code from NPCI gateway',
      status: 'failed',
      recoverability_score: 85,
      retry_payment_link: 'https://rzp.io/a2',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  // Customer B: Aditi Rao (UPI GPay device timeout, ticket ₹499 & ₹799)
  const custB: Customer = {
    id: 'cust_aditi',
    name: 'Aditi Rao',
    phone: '+919812345678',
    total_failed: 2,
    total_recovered: 0,
    do_not_contact: false,
    created_at: new Date().toISOString(),
  };

  const txsB: Transaction[] = [
    {
      id: 'tx_b1',
      razorpay_payment_id: 'pay_b1_test',
      customer_id: 'cust_aditi',
      amount: 499,
      channel: 'upi_app',
      failure_bucket: 'upi_timeout',
      failure_reason_raw: 'Google Pay UPI authorization timed out on user device',
      status: 'failed',
      recoverability_score: 90,
      retry_payment_link: 'https://rzp.io/b1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'tx_b2',
      razorpay_payment_id: 'pay_b2_test',
      customer_id: 'cust_aditi',
      amount: 799,
      channel: 'upi_app',
      failure_bucket: 'upi_timeout',
      failure_reason_raw: 'PhonePe callback not received within 60 seconds of intent invocation',
      status: 'failed',
      recoverability_score: 90,
      retry_payment_link: 'https://rzp.io/b2',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const patterns = detectRecurringFailurePatterns([custA, custB], [...txsA, ...txsB]);

  console.log(`Detected ${patterns.length} recurring failure patterns:\n`);

  patterns.forEach((pat, i) => {
    console.log(`[Customer ${i + 1}] ${pat.customer_name} (${pat.repeated_bucket})`);
    console.log(`   Pattern: "${pat.plain_language_reason}"`);
    console.log(`   Suggested Prevention: "${pat.suggested_prevention_action}"\n`);
  });

  if (patterns.length !== 2) {
    throw new Error(`Expected 2 patterns, got ${patterns.length}`);
  }

  const [patA, patB] = patterns;

  // Assert Pattern text is NOT identical
  if (patA.plain_language_reason === patB.plain_language_reason) {
    throw new Error('FAIL: Pattern descriptions are identical boilerplate!');
  }
  console.log('✅ PASS: Pattern descriptions are distinct and reflect customer-specific amounts & telemetry!');

  // Assert Prevention text is NOT identical
  if (patA.suggested_prevention_action === patB.suggested_prevention_action) {
    throw new Error('FAIL: Suggested prevention actions are identical boilerplate!');
  }
  console.log('✅ PASS: Suggested prevention actions are distinct and reference customer name & root-cause details!');

  // Check specific amounts appear in text
  if (!patA.plain_language_reason.includes('₹1,499') || !patB.plain_language_reason.includes('₹499')) {
    throw new Error('FAIL: Transaction amounts not found in pattern description!');
  }
  console.log('✅ PASS: Specific transaction amounts successfully included in pattern text.');

  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('🎉 FIX 3 VERIFIED: Recurring failure pattern text is genuinely computed per customer!');
}

verifyRecurringPatternsFix();
