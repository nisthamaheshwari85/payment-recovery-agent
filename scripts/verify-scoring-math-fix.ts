import { computeExplainableScoreBreakdown } from '../src/lib/scoringBreakdown';
import { Transaction, Customer } from '../src/lib/types';

interface TestCase {
  name: string;
  tx: Partial<Transaction>;
  customer?: Partial<Customer>;
}

const testCases: TestCase[] = [
  {
    name: 'Case 1: Fresh Low-Ticket UPI Timeout (0 attempts, fresh customer)',
    tx: {
      failure_bucket: 'upi_timeout',
      failure_reason_raw: 'NPCI PSP response timeout after 45000ms: UPI_SESSION_TIMED_OUT',
      amount: 1299,
      recovery_attempts: [],
    },
    customer: {
      total_failed: 1,
      total_recovered: 0,
      do_not_contact: false,
    },
  },
  {
    name: 'Case 2: Moderate-Ticket Card Decline with 1 Prior Attempt',
    tx: {
      failure_bucket: 'card_decline',
      failure_reason_raw: 'Issuer bank declined transaction: 3DS OTP verification failed/timeout',
      amount: 4500,
      recovery_attempts: [
        {
          id: 'att_1',
          attempt_number: 1,
          channel: 'whatsapp',
          message_sent: 'Retry link',
          sent_at: new Date().toISOString(),
          outcome: 'read',
          retry_payment_link: 'https://rzp.io/test',
          transaction_id: 'tx_1',
          customer_id: 'cust_1',
        },
      ],
    },
    customer: {
      total_failed: 1,
      total_recovered: 0,
      do_not_contact: false,
    },
  },
  {
    name: 'Case 3: High-Ticket Cart Abandonment with 2 Attempts (Customer with Repeat Failures)',
    tx: {
      failure_bucket: 'cart_abandon',
      failure_reason_raw: 'User exited checkout drawer without selecting a payment instrument (idle 180s)',
      amount: 22000,
      has_recurring_failure: true,
      recovery_attempts: [
        {
          id: 'att_1',
          attempt_number: 1,
          channel: 'whatsapp',
          message_sent: 'Retry 1',
          sent_at: new Date().toISOString(),
          outcome: 'read',
          retry_payment_link: 'https://rzp.io/test1',
          transaction_id: 'tx_2',
          customer_id: 'cust_2',
        },
        {
          id: 'att_2',
          attempt_number: 2,
          channel: 'whatsapp',
          message_sent: 'Retry 2',
          sent_at: new Date().toISOString(),
          outcome: 'read',
          retry_payment_link: 'https://rzp.io/test2',
          transaction_id: 'tx_2',
          customer_id: 'cust_2',
        },
      ],
    },
    customer: {
      total_failed: 4,
      total_recovered: 0,
      do_not_contact: false,
    },
  },
  {
    name: 'Case 4: Insufficient Funds with Repeat Converted Loyal Customer (0 attempts, ₹8,999)',
    tx: {
      failure_bucket: 'insufficient_funds',
      failure_reason_raw: 'Kotak Bank: Available balance less than requested transaction amount',
      amount: 8999,
      recovery_attempts: [],
    },
    customer: {
      total_failed: 2,
      total_recovered: 3,
      do_not_contact: false,
    },
  },
  {
    name: 'Case 5: Generic Network Error with 1 Prior Attempt (Low Ticket ₹799)',
    tx: {
      failure_bucket: 'network_error',
      failure_reason_raw: 'Client connection reset: net::ERR_CONNECTION_RESET during redirect',
      amount: 799,
      recovery_attempts: [
        {
          id: 'att_1',
          attempt_number: 1,
          channel: 'whatsapp',
          message_sent: 'Retry 1',
          sent_at: new Date().toISOString(),
          outcome: 'read',
          retry_payment_link: 'https://rzp.io/test5',
          transaction_id: 'tx_5',
          customer_id: 'cust_5',
        },
      ],
    },
    customer: {
      total_failed: 1,
      total_recovered: 0,
      do_not_contact: false,
    },
  },
];

console.log('════════════════════════════════════════════════════════════════');
console.log('FIX 1 VERIFICATION: ARITHMETIC SUM VERIFICATION OF SCORING BREAKDOWN');
console.log('════════════════════════════════════════════════════════════════\n');

let allPassed = true;

for (let idx = 0; idx < testCases.length; idx++) {
  const tc = testCases[idx];
  const breakdown = computeExplainableScoreBreakdown(tc.tx as Transaction, tc.customer as Customer);
  
  console.log(`\n--- Test Case ${idx + 1}: ${tc.name} ---`);
  let manualSum = 0;
  const terms: string[] = [];
  
  breakdown.items.forEach((item) => {
    manualSum += item.points;
    terms.push(`${item.points >= 0 ? '+' : ''}${item.points}`);
    console.log(`   [${item.points >= 0 ? '+' : ''}${item.points}] ${item.label}`);
  });

  const equation = terms.join(' ') + ` = ${manualSum}`;
  console.log(`   🧮 Explicit Manual Sum: ${equation}`);
  console.log(`   📊 Displayed Total Score: ${breakdown.total_score} / 100`);

  if (manualSum === breakdown.total_score) {
    console.log(`   ✅ PASS: Line items mathematically sum EXACTLY to displayed total (${manualSum} === ${breakdown.total_score})`);
  } else {
    console.error(`   ❌ FAIL: Math mismatch! Sum is ${manualSum} but total_score is ${breakdown.total_score}`);
    allPassed = false;
  }
}

console.log('\n════════════════════════════════════════════════════════════════');
if (allPassed) {
  console.log('🎉 FIX 1 VERIFIED: All test cases have 100% mathematical equality between displayed items and total score!');
  process.exit(0);
} else {
  console.error('❌ FIX 1 FAILED: Discrepancy found.');
  process.exit(1);
}
