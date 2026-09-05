import { Customer, Transaction, FailureBucket, RecurringFailurePattern } from './types';

function formatBucketLabel(bucket: FailureBucket): string {
  switch (bucket) {
    case 'upi_timeout':
      return 'UPI Network Timeout';
    case 'card_decline':
      return 'Card Issuer Decline / OTP Issue';
    case 'insufficient_funds':
      return 'Insufficient Account Funds / Limits';
    case 'network_error':
      return 'Network / Connection Drop';
    case 'cart_abandon':
      return 'Cart Exit Without Payment';
    default:
      return 'Gateway Processing Failure';
  }
}

/**
 * Synthesizes dynamic, customer-specific pattern descriptions pulling actual
 * checkout amounts, counts, and raw telemetry reasons rather than generic boilerplate.
 */
function generateDynamicPatternReason(
  bucket: FailureBucket,
  matchingTxs: Transaction[],
  totalTxCount: number
): string {
  const amounts = matchingTxs.map((t) => `₹${t.amount.toLocaleString('en-IN')}`).join(' & ');
  const distinctReasons = Array.from(new Set(matchingTxs.map((t) => t.failure_reason_raw).filter(Boolean)));
  const bucketLabel = formatBucketLabel(bucket);

  let text = `${matchingTxs.length} of ${totalTxCount} checkouts (${amounts}) failed on ${bucketLabel}.`;
  if (distinctReasons.length === 1) {
    text += ` Telemetry recorded: "${distinctReasons[0]}".`;
  } else if (distinctReasons.length > 1) {
    text += ` Telemetry recorded: "${distinctReasons[0]}" and "${distinctReasons[1]}".`;
  }
  return text;
}

/**
 * Synthesizes customer-tailored prevention actions referencing customer name,
 * actual ticket sizes, and specific root-cause failure characteristics.
 */
function generateDynamicPreventionAction(
  bucket: FailureBucket,
  customer: Customer,
  matchingTxs: Transaction[]
): string {
  const firstName = customer.name.split(' ')[0];
  const maxAmount = Math.max(...matchingTxs.map((t) => t.amount));
  const totalAmount = matchingTxs.reduce((s, t) => s + t.amount, 0);
  const reasonsStr = matchingTxs.map((t) => t.failure_reason_raw || '').join(' ').toLowerCase();

  switch (bucket) {
    case 'upi_timeout':
      if (reasonsStr.includes('mpin') || reasonsStr.includes('beneficiary')) {
        return `${firstName}'s bank faced MPIN authorization delays. Recommend switching to Netbanking or alternate UPI handle for orders around ₹${maxAmount.toLocaleString('en-IN')}.`;
      } else if (reasonsStr.includes('gpay') || reasonsStr.includes('google pay') || reasonsStr.includes('phonepe')) {
        return `UPI app timeout detected on ${firstName}'s devices. Suggest clearing app cache or generating a collect request on checkout.`;
      }
      return `Repeated switch timeout across ${matchingTxs.length} orders totaling ₹${totalAmount.toLocaleString('en-IN')}. Route next recovery link to fast-clearing UPI handles (e.g. @okaxis/@okhdfcbank) or Card.`;

    case 'card_decline':
      if (reasonsStr.includes('cvv') || reasonsStr.includes('otp')) {
        return `OTP/CVV verification failed repeatedly for ${firstName}. Recommend fallback to 1-tap Instant UPI to eliminate 3DS SMS authentication friction.`;
      } else if (maxAmount > 15000) {
        return `High-ticket decline (₹${maxAmount.toLocaleString('en-IN')}) indicates card limit caps. Advise enabling e-commerce limits in card app or offering Card EMI.`;
      }
      return `Issuer decline on ${matchingTxs.length} transactions (₹${totalAmount.toLocaleString('en-IN')}). Pre-select alternate payment rails (UPI/Netbanking) on recovery link.`;

    case 'insufficient_funds':
      if (maxAmount >= 10000) {
        return `High-value order (₹${maxAmount.toLocaleString('en-IN')}) repeatedly hit account balance limits. Pre-enable 3/6-month No-Cost Card EMI and PayLater on recovery links for ${firstName}.`;
      }
      return `Account balance constraints on ${matchingTxs.length} purchases totaling ₹${totalAmount.toLocaleString('en-IN')}. Offer flexible split-payment or wallet top-up options.`;

    case 'network_error':
      if (reasonsStr.includes('webview') || reasonsStr.includes('mobile browser')) {
        return `Mobile WebView drops observed during ${firstName}'s checkouts. Send direct WhatsApp recovery link accessible in native mobile browser.`;
      }
      return `Connection resets on ${matchingTxs.length} checkout sessions (₹${totalAmount.toLocaleString('en-IN')}). Provide preserved cart restoration link with extended 24h validity.`;

    case 'cart_abandon':
      return `${firstName} abandoned ${matchingTxs.length} carts (last for ₹${maxAmount.toLocaleString('en-IN')}). Send low-friction 1-click cart restoration without payment failure language.`;

    default:
      return `Tailor outreach for ${firstName} with direct concierge support on ₹${totalAmount.toLocaleString('en-IN')} cumulative failed orders.`;
  }
}

/**
 * Transparent, rule-based repeat-failure pattern detection.
 * Evaluates customer transaction history to find 2+ failures in the same bucket.
 * Explicitly NOT an ML model or synthetic prediction score.
 */
export function detectRecurringFailurePatterns(
  customers: Customer[],
  transactions: Transaction[]
): RecurringFailurePattern[] {
  const patterns: RecurringFailurePattern[] = [];
  const customerMap = new Map<string, Customer>();
  customers.forEach((c) => customerMap.set(c.id, c));

  // Group transactions by customer
  const txByCustomer = new Map<string, Transaction[]>();
  transactions.forEach((tx) => {
    if (!tx.customer_id) return;
    const existing = txByCustomer.get(tx.customer_id) || [];
    existing.push(tx);
    txByCustomer.set(tx.customer_id, existing);
  });

  txByCustomer.forEach((txList, customerId) => {
    const customer = customerMap.get(customerId);
    if (!customer) return;

    // Group by failure bucket
    const bucketTxs: Partial<Record<FailureBucket, Transaction[]>> = {};

    txList.forEach((t) => {
      const b = t.failure_bucket;
      if (!bucketTxs[b]) {
        bucketTxs[b] = [];
      }
      bucketTxs[b]!.push(t);
    });

    // Check for 2+ failures in any bucket
    (Object.keys(bucketTxs) as FailureBucket[]).forEach((bucket) => {
      const matchingTxs = bucketTxs[bucket];
      if (matchingTxs && matchingTxs.length >= 2) {
        patterns.push({
          customer_id: customer.id,
          customer_name: customer.name,
          customer_phone: customer.phone,
          repeated_bucket: bucket,
          failure_count: matchingTxs.length,
          total_transactions: txList.length,
          plain_language_reason: generateDynamicPatternReason(bucket, matchingTxs, txList.length),
          suggested_prevention_action: generateDynamicPreventionAction(bucket, customer, matchingTxs),
          recent_failure_reasons: matchingTxs.map((t) => t.failure_reason_raw).filter(Boolean).slice(0, 2),
        });
      }
    });
  });

  // Sort by failure count descending
  return patterns.sort((a, b) => b.failure_count - a.failure_count);
}

/**
 * Checks if a specific customer has a recurring failure history for a given failure bucket.
 */
export function getCustomerRecurringPattern(
  customerId: string,
  bucket: FailureBucket,
  transactions: Transaction[]
): RecurringFailurePattern | null {
  const customerTxs = transactions.filter((t) => t.customer_id === customerId);
  const matchingBucketTxs = customerTxs.filter((t) => t.failure_bucket === bucket);

  if (matchingBucketTxs.length >= 2) {
    const firstTx = customerTxs[0];
    const customer = firstTx?.customer || {
      id: customerId,
      name: firstTx?.customer?.name || 'Customer',
      phone: firstTx?.customer?.phone || '',
      total_failed: customerTxs.length,
      total_recovered: 0,
      do_not_contact: false,
      created_at: new Date().toISOString(),
    };

    return {
      customer_id: customerId,
      customer_name: customer.name,
      customer_phone: customer.phone,
      repeated_bucket: bucket,
      failure_count: matchingBucketTxs.length,
      total_transactions: customerTxs.length,
      plain_language_reason: generateDynamicPatternReason(bucket, matchingBucketTxs, customerTxs.length),
      suggested_prevention_action: generateDynamicPreventionAction(bucket, customer, matchingBucketTxs),
      recent_failure_reasons: matchingBucketTxs.map((t) => t.failure_reason_raw).filter(Boolean).slice(0, 2),
    };
  }

  return null;
}
