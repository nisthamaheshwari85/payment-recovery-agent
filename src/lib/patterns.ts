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

function getPreventionAction(bucket: FailureBucket): string {
  switch (bucket) {
    case 'upi_timeout':
      return 'Advise customer to update their UPI app (GPay/PhonePe) or set up Netbanking/Cards for peak-hour reliability.';
    case 'card_decline':
      return 'Recommend customer enable online/e-commerce transaction limits in banking app or switch to Instant UPI.';
    case 'insufficient_funds':
      return 'Offer No-Cost Card EMI or PayLater rails on checkouts above ₹3,000 to eliminate balance constraints.';
    case 'network_error':
      return 'Provide single-tap session restore link and recommend stable Wi-Fi or alternate browser.';
    case 'cart_abandon':
      return 'Customer repeatedly leaves cart idle; provide single-tap checkout link with preserved session before expiration.';
    default:
      return 'Offer alternate payment rails and direct customer support contact.';
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

    // Count by failure bucket
    const bucketCounts: Partial<Record<FailureBucket, { count: number; reasons: string[] }>> = {};

    txList.forEach((t) => {
      const b = t.failure_bucket;
      if (!bucketCounts[b]) {
        bucketCounts[b] = { count: 0, reasons: [] };
      }
      bucketCounts[b]!.count++;
      if (t.failure_reason_raw && !bucketCounts[b]!.reasons.includes(t.failure_reason_raw)) {
        bucketCounts[b]!.reasons.push(t.failure_reason_raw);
      }
    });

    // Check for 2+ failures in any bucket
    (Object.keys(bucketCounts) as FailureBucket[]).forEach((bucket) => {
      const data = bucketCounts[bucket];
      if (data && data.count >= 2) {
        patterns.push({
          customer_id: customer.id,
          customer_name: customer.name,
          customer_phone: customer.phone,
          repeated_bucket: bucket,
          failure_count: data.count,
          total_transactions: txList.length,
          plain_language_reason: `${data.count} of ${txList.length} checkout attempts failed with ${formatBucketLabel(bucket)}`,
          suggested_prevention_action: getPreventionAction(bucket),
          recent_failure_reasons: data.reasons.slice(0, 2),
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
    return {
      customer_id: customerId,
      customer_name: customerTxs[0]?.customer?.name || 'Customer',
      customer_phone: customerTxs[0]?.customer?.phone || '',
      repeated_bucket: bucket,
      failure_count: matchingBucketTxs.length,
      total_transactions: customerTxs.length,
      plain_language_reason: `${matchingBucketTxs.length} of ${customerTxs.length} checkouts failed with ${formatBucketLabel(bucket)}`,
      suggested_prevention_action: getPreventionAction(bucket),
      recent_failure_reasons: matchingBucketTxs.map((t) => t.failure_reason_raw).slice(0, 2),
    };
  }

  return null;
}
