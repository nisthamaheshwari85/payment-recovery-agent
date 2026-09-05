import { Customer, Transaction, RecoveryAttempt, HumanEscalation, FailureBucket } from './types';
import { db } from './db';
import { maskPhoneNumber } from './masking';
import { computeExplainableScoreBreakdown } from './scoringBreakdown';

interface SeedDataset {
  customers: Customer[];
  transactions: Transaction[];
  recovery_attempts: RecoveryAttempt[];
  human_escalations: HumanEscalation[];
}

const FIRST_NAMES = [
  'Aarav', 'Vihaan', 'Aditya', 'Rohan', 'Reyansh', 'Kabir', 'Ananya', 'Diya', 'Ishaan', 'Aanya',
  'Pooja', 'Rahul', 'Priya', 'Amit', 'Neha', 'Vikas', 'Deepak', 'Sneha', 'Arjun', 'Tanvi',
  'Siddharth', 'Meera', 'Gaurav', 'Shreya', 'Karan', 'Kavita', 'Manish', 'Simran', 'Varun', 'Ritu',
  'Kunal', 'Sanya', 'Naveen', 'Divya', 'Suresh', 'Swati', 'Harsh', 'Preeti', 'Sunil', 'Rashmi',
  'Prateek', 'Pallavi', 'Akash', 'Shweta', 'Abhishek', 'Monika', 'Rajat', 'Bhavna', 'Alok', 'Smriti'
];

const LAST_NAMES = [
  'Sharma', 'Verma', 'Patel', 'Reddy', 'Singh', 'Gupta', 'Kumar', 'Mehta', 'Joshi', 'Nair',
  'Iyer', 'Chopra', 'Malhotra', 'Bhatia', 'Saxena', 'Kapoor', 'Mishra', 'Agarwal', 'Shah', 'Banerjee'
];

const RAW_FAILURE_REASONS: Record<FailureBucket, string[]> = {
  upi_timeout: [
    'NPCI PSP response timeout after 45000ms: UPI_SESSION_TIMED_OUT',
    'Beneficiary bank server down or not responding during MPIN authorization',
    'Google Pay UPI authorization timed out on user device',
    'PhonePe callback not received within 60 seconds of intent invocation',
    'Bank UPI switch busy: U30 error code from NPCI gateway'
  ],
  card_decline: [
    'Issuer bank declined transaction: 3DS OTP verification failed/timeout',
    'Card declined by HDFC Bank: Incorrect CVV2 entered 3 times',
    'Transaction declined by ICICI: International/e-commerce limit disabled in banking app',
    'Axis Bank Card Gateway: Issuer security filter blocked high-value online transaction',
    'Debit card rejected: Card expired or invalid expiration date provided'
  ],
  network_error: [
    'Client connection reset: net::ERR_CONNECTION_RESET during redirect to gateway',
    'Socket hangup during Razorpay 3DS redirection handshake',
    'Mobile browser closed during gateway redirect (WebKit WebView drop)',
    'Network timeout: gateway response packet lost mid-flight',
    'DNS resolution failure on customer 4G network connection'
  ],
  cart_abandon: [
    'User exited checkout drawer without selecting a payment instrument (idle 180s)',
    'Modal dismissed by customer at payment method selection step',
    'Customer abandoned session after promo code validation check',
    'Checkout sheet closed on mobile browser after selecting netbanking tab',
    'User navigated back to cart from Razorpay checkout modal'
  ],
  insufficient_funds: [
    'SBI Core Banking response: 51 - Insufficient account funds for debit',
    'Kotak Bank: Available balance less than requested transaction amount ₹14,999',
    'Credit card declined: Exceeds assigned credit limit on card ending 4092',
    'Prepaid wallet balance low: Paytm wallet balance ₹12.50 insufficient for ₹899',
    'Account overdraft limit reached: transaction declined by Federal Bank'
  ],
  other: [
    'Razorpay fraud prevention shield triggered: High-velocity IP anomaly detected',
    'Expired payment link: Link validity exceeded 15 minutes TTL',
    'Currency not supported for merchant tier: Multi-currency authorization failed',
    'Duplicate transaction request identifier detected within 10s window',
    'Merchant API key test mode rate limit exceeded'
  ]
};

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateRandomPhone(index: number): string {
  const prefix = ['98', '99', '97', '91', '88', '70', '80'][index % 7];
  const rest = Math.floor(10000000 + Math.random() * 90000000).toString().substring(0, 8);
  return `+91${prefix}${rest}`;
}

export function generateSyntheticDataset(): SeedDataset {
  const now = new Date();
  const customers: Customer[] = [];
  const transactions: Transaction[] = [];
  const recovery_attempts: RecoveryAttempt[] = [];
  const human_escalations: HumanEscalation[] = [];

  // Define 6 buckets distribution for 52 records
  const bucketList: FailureBucket[] = [
    'upi_timeout', 'upi_timeout', 'upi_timeout', 'upi_timeout', 'upi_timeout', 'upi_timeout', 'upi_timeout', 'upi_timeout', 'upi_timeout', 'upi_timeout', 'upi_timeout', 'upi_timeout', // 12
    'network_error', 'network_error', 'network_error', 'network_error', 'network_error', 'network_error', 'network_error', 'network_error', // 8
    'cart_abandon', 'cart_abandon', 'cart_abandon', 'cart_abandon', 'cart_abandon', 'cart_abandon', 'cart_abandon', 'cart_abandon', 'cart_abandon', 'cart_abandon', // 10
    'card_decline', 'card_decline', 'card_decline', 'card_decline', 'card_decline', 'card_decline', 'card_decline', 'card_decline', // 8
    'insufficient_funds', 'insufficient_funds', 'insufficient_funds', 'insufficient_funds', 'insufficient_funds', 'insufficient_funds', 'insufficient_funds', 'insufficient_funds', // 8
    'other', 'other', 'other', 'other', 'other', 'other' // 6
  ];

  // 1. Generate 52 customers
  for (let i = 0; i < bucketList.length; i++) {
    const fName = FIRST_NAMES[i % FIRST_NAMES.length];
    const lName = LAST_NAMES[(i * 3) % LAST_NAMES.length];
    const name = `${fName} ${lName}`;
    const phone = generateRandomPhone(i);
    const email = `${fName.toLowerCase()}.${lName.toLowerCase()}${randomInt(10, 99)}@gmail.com`;

    const custId = `cust_${(i + 1).toString().padStart(4, '0')}`;
    const isRepeat = i % 4 === 0;

    customers.push({
      id: custId,
      name,
      phone,
      email,
      total_failed: 1 + (isRepeat ? randomInt(1, 3) : 0),
      total_recovered: isRepeat ? randomInt(1, 2) : 0,
      do_not_contact: false,
      opted_out_at: null,
      created_at: new Date(now.getTime() - randomInt(1, 30) * 86400000).toISOString()
    });
  }

  // 2. Generate transactions matching the buckets
  bucketList.forEach((bucket, idx) => {
    const cust = customers[idx];
    const txId = `tx_${(idx + 1).toString().padStart(4, '0')}`;
    const payId = `pay_${Math.random().toString(36).substring(2, 11).toUpperCase()}`;
    const orderId = `order_${Math.random().toString(36).substring(2, 10).toLowerCase()}`;

    // Realistic INR amounts based on bucket
    let amount = 999;
    if (bucket === 'cart_abandon') amount = randomChoice([1299, 2499, 3999, 5499, 8999, 14999]);
    else if (bucket === 'upi_timeout') amount = randomChoice([499, 799, 1499, 1999, 2499, 3499, 6999]);
    else if (bucket === 'card_decline') amount = randomChoice([3500, 6500, 12000, 18500, 24999, 38000]);
    else if (bucket === 'insufficient_funds') amount = randomChoice([4999, 8999, 14999, 22500, 31000]);
    else if (bucket === 'network_error') amount = randomChoice([699, 1199, 1899, 2999, 4500]);
    else amount = randomChoice([2999, 7999, 15000, 25000]);

    const failureReason = randomChoice(RAW_FAILURE_REASONS[bucket]);

    // Base score calculation
    // Note: Recoverability score will be computed via unified computeExplainableScoreBreakdown below

    // Distribution of transaction statuses across the 52 records:
    // - 16 Recovered
    // - 14 Fresh / Ready for initial outreach (failed, 0 attempts)
    // - 8 In Recovery (with realistic drop-offs: retried, clicked, read)
    // - 6 Needs Human Review (hit 3 attempts)
    // - 5 Opted Out (replied STOP)
    // - 3 Unrecoverable (bucket 'other' or fraud)
    let status: Transaction['status'] = 'failed';
    let funnelStage: Transaction['funnel_stage'] = undefined;
    const hoursAgo = randomInt(1, 72);
    const createdAt = new Date(now.getTime() - hoursAgo * 3600000).toISOString();
    const retryLink = `https://rzp.io/i/rec_${payId.substring(4, 10).toLowerCase()}`;

    if (idx < 16) {
      status = 'recovered';
      funnelStage = 'recovered';
    } else if (idx < 30) {
      status = 'failed'; // 0 attempts, fresh
      funnelStage = undefined;
    } else if (idx < 38) {
      status = 'in_recovery';
      // Realistic drop-offs: some clicked and retried, some clicked only, some read only
      if (idx === 30 || idx === 31 || idx === 32) {
        funnelStage = 'payment_retried';
      } else if (idx === 33 || idx === 34 || idx === 35) {
        funnelStage = 'link_clicked';
      } else {
        funnelStage = 'messaged';
      }
    } else if (idx < 44) {
      status = 'escalated_human_review';
      if (idx === 38 || idx === 39) {
        funnelStage = 'payment_retried';
      } else if (idx === 40 || idx === 41) {
        funnelStage = 'link_clicked';
      } else {
        funnelStage = 'messaged';
      }
    } else if (idx < 49) {
      status = 'opted_out';
      funnelStage = 'messaged';
      cust.do_not_contact = true;
      cust.opted_out_at = new Date(now.getTime() - 4 * 3600000).toISOString();
    } else {
      status = 'unrecoverable';
      funnelStage = undefined;
    }

    // Single source of truth for scoring: literal sum of explainable line items
    const initialAttemptsMock = (idx < 16 ? [{ attempt_number: 1 }] : idx < 38 ? [{ attempt_number: 1 }] : idx < 44 ? [{ attempt_number: 1 }, { attempt_number: 2 }, { attempt_number: 3 }] : idx < 49 ? [{ attempt_number: 1 }] : []) as any;
    const breakdown = computeExplainableScoreBreakdown({
      failure_bucket: bucket,
      failure_reason_raw: failureReason,
      amount,
      recovery_attempts: initialAttemptsMock,
      customer: cust,
    }, cust);
    const finalScore = breakdown.total_score;

    const tx: Transaction = {
      id: txId,
      razorpay_payment_id: payId,
      razorpay_order_id: orderId,
      amount,
      customer_id: cust.id,
      channel: randomChoice(['checkout_web', 'upi_app', 'payment_link', 'mobile_sdk']),
      failure_reason_raw: failureReason,
      failure_bucket: bucket,
      recoverability_score: finalScore,
      score_breakdown: {
        base_bucket_score: breakdown.items.find(i => i.id === 'base_platform')?.points || 10,
        amount_adjustment: breakdown.items.find(i => i.id.startsWith('order_tier_'))?.points || 0,
        history_adjustment: breakdown.items.find(i => i.id.includes('repeat') || i.id === 'baseline_customer')?.points || 0,
        time_decay_penalty: 0,
        channel_factor: 1.0,
        final_score: finalScore,
        rationale: breakdown.items.map(i => `${i.label}: ${i.explanation}`)
      },
      status,
      funnel_stage: funnelStage,
      retry_payment_link: retryLink,
      created_at: createdAt,
      updated_at: createdAt
    };

    transactions.push(tx);

    // 3. Attach realistic recovery attempts based on the status
    if (status === 'recovered') {
      const attemptsCount = (idx % 3) + 1; // 1 to 3 attempts
      for (let att = 1; att <= attemptsCount; att++) {
        const attemptTime = new Date(new Date(createdAt).getTime() + att * 7 * 3600000).toISOString();
        const isFinal = att === attemptsCount;
        recovery_attempts.push({
          id: `att_${txId}_${att}`,
          transaction_id: txId,
          customer_id: cust.id,
          attempt_number: att,
          channel: 'whatsapp',
          message_sent: att === 1
            ? `Namaste ${cust.name}! Dekha aapka ₹${amount} ka payment complete nahi ho paya. Don't worry, aap bina dobara cart banaye yahan se seedha complete kar sakte hain: ${retryLink} . Reply STOP to opt-out.`
            : `Hi ${cust.name}, aapka pending order abhi reserved hai. Retry link: ${retryLink} . Agar help chahiye toh reply karein.`,
          sent_at: attemptTime,
          outcome: isFinal ? 'recovered' : 'clicked',
          retry_payment_link: retryLink,
          llm_model_used: 'openai/gpt-oss-20b',
          guardrail_checks: {
            max_attempts_checked: true,
            cooldown_checked: true,
            opt_out_checked: true,
            tone_safety_checked: true
          }
        });
      }
    } else if (status === 'in_recovery') {
      // 1 or 2 attempts done with realistic drop-off states
      const attemptsCount = (idx % 2) + 1;
      const isRecent = idx === 30 || idx === 31; // 2 records have cooldown active (<6h)
      for (let att = 1; att <= attemptsCount; att++) {
        const gapHours = isRecent && att === attemptsCount ? 2 : att * 8;
        const attemptTime = new Date(now.getTime() - gapHours * 3600000).toISOString();
        const isFinal = att === attemptsCount;
        let attemptOutcome: RecoveryAttempt['outcome'] = 'read';
        if (isFinal) {
          if (funnelStage === 'payment_retried') attemptOutcome = 'retried';
          else if (funnelStage === 'link_clicked') attemptOutcome = 'clicked';
          else attemptOutcome = 'read';
        }
        recovery_attempts.push({
          id: `att_${txId}_${att}`,
          transaction_id: txId,
          customer_id: cust.id,
          attempt_number: att,
          channel: 'whatsapp',
          message_sent: `Hi ${cust.name}, aapka ₹${amount} ka payment network issue ki wajah se ruk gaya tha. Ek tap mein retry karein: ${retryLink} . Reply STOP to unsubscribe.`,
          sent_at: attemptTime,
          outcome: attemptOutcome,
          retry_payment_link: retryLink,
          llm_model_used: 'openai/gpt-oss-20b',
          guardrail_checks: {
            max_attempts_checked: true,
            cooldown_checked: true,
            opt_out_checked: true,
            tone_safety_checked: true
          }
        });
      }
    } else if (status === 'escalated_human_review') {
      // 3 attempts exhausted, automatically escalated
      for (let att = 1; att <= 3; att++) {
        const attemptTime = new Date(now.getTime() - (24 - att * 7) * 3600000).toISOString();
        let attOutcome: RecoveryAttempt['outcome'] = att === 3 ? 'failed_escalated' : 'read';
        if (funnelStage === 'payment_retried' && att === 2) attOutcome = 'retried';
        if (funnelStage === 'link_clicked' && att === 2) attOutcome = 'clicked';

        recovery_attempts.push({
          id: `att_${txId}_${att}`,
          transaction_id: txId,
          customer_id: cust.id,
          attempt_number: att,
          channel: 'whatsapp',
          message_sent: `Attempt ${att} for ${cust.name}: payment retry link ${retryLink}`,
          sent_at: attemptTime,
          outcome: attOutcome,
          retry_payment_link: retryLink,
          llm_model_used: 'openai/gpt-oss-20b',
          guardrail_checks: {
            max_attempts_checked: true,
            cooldown_checked: true,
            opt_out_checked: true,
            tone_safety_checked: true
          }
        });
      }

      human_escalations.push({
        id: `esc_${txId}`,
        transaction_id: txId,
        customer_id: cust.id,
        reason: 'max_attempts_reached',
        status: 'pending',
        assigned_to: 'Support Team L2',
        notes: `Customer completed 3 automated Hinglish recovery outreach attempts with zero conversion. Failure bucket: ${bucket}. Ticket amount: ₹${amount}. Customer phone: ${maskPhoneNumber(cust.phone)}. Manual verification recommended.`,
        created_at: new Date(now.getTime() - 2 * 3600000).toISOString()
      });
    } else if (status === 'opted_out') {
      // 1 attempt was sent, customer responded STOP
      const attemptTime = new Date(now.getTime() - 8 * 3600000).toISOString();
      recovery_attempts.push({
        id: `att_${txId}_1`,
        transaction_id: txId,
        customer_id: cust.id,
        attempt_number: 1,
        channel: 'whatsapp',
        message_sent: `Namaste ${cust.name}! Aapka ₹${amount} payment pending reh gaya tha. Retry link: ${retryLink} . Reply STOP to opt out.`,
        sent_at: attemptTime,
        outcome: 'opted_out',
        retry_payment_link: retryLink,
        llm_model_used: 'openai/gpt-oss-20b',
        guardrail_checks: {
          max_attempts_checked: true,
          cooldown_checked: true,
          opt_out_checked: true,
          tone_safety_checked: true
        }
      });
    }
  });

  // 4. Add deterministic Task 1 test cases for late authorization re-verification
  if (customers.length > 0) {
    const testCust = customers[0];
    const lateCapScore = computeExplainableScoreBreakdown({
      failure_bucket: 'upi_timeout',
      amount: 1999,
      customer: testCust,
    }, testCust).total_score;

    const normFailScore = computeExplainableScoreBreakdown({
      failure_bucket: 'upi_timeout',
      amount: 2499,
      customer: testCust,
    }, testCust).total_score;

    transactions.unshift(
      {
        id: 'tx_demo_late_captured',
        razorpay_payment_id: 'pay_late_cap_99881',
        razorpay_order_id: 'order_late_cap_001',
        amount: 1999,
        customer_id: testCust.id,
        channel: 'upi_app',
        failure_reason_raw: 'UPI switch did not respond in time (delayed bank auth)',
        failure_bucket: 'upi_timeout',
        recoverability_score: lateCapScore,
        status: 'failed',
        retry_payment_link: 'https://rzp.io/i/rec_latecap',
        created_at: new Date(now.getTime() - 25 * 60000).toISOString(),
        updated_at: new Date(now.getTime() - 25 * 60000).toISOString(),
      },
      {
        id: 'tx_demo_normal_failed',
        razorpay_payment_id: 'pay_norm_fail_11223',
        razorpay_order_id: 'order_norm_fail_002',
        amount: 2499,
        customer_id: testCust.id,
        channel: 'checkout_web',
        failure_reason_raw: 'Bank gateway timeout during OTP authorization',
        failure_bucket: 'upi_timeout',
        recoverability_score: normFailScore,
        status: 'failed',
        retry_payment_link: 'https://rzp.io/i/rec_normfail',
        created_at: new Date(now.getTime() - 35 * 60000).toISOString(),
        updated_at: new Date(now.getTime() - 35 * 60000).toISOString(),
      }
    );
  }

  return {
    customers,
    transactions,
    recovery_attempts,
    human_escalations
  };
}

export async function executeSeed(): Promise<{
  customersCount: number;
  transactionsCount: number;
  attemptsCount: number;
  escalationsCount: number;
}> {
  const data = generateSyntheticDataset();
  await db.seed(data);
  return {
    customersCount: data.customers.length,
    transactionsCount: data.transactions.length,
    attemptsCount: data.recovery_attempts.length,
    escalationsCount: data.human_escalations.length
  };
}
