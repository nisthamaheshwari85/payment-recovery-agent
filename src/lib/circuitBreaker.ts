import { FailureBucket, Transaction } from './types';

/**
 * Mass-Failure Circuit Breaker Parameters.
 *
 * Operational Rationale:
 * In Indian payment ecosystems (UPI, Netbanking, Cards), a sudden cluster of 10+ failures
 * within a rolling 15-minute window for a single failure bucket strongly indicates an upstream
 * bank outage, NPCI switch congestion, or payment gateway maintenance (e.g. HDFC/SBI CBS downtime).
 * In such scenarios, automated recovery retries will predictably fail again, wasting WhatsApp messaging
 * fees (₹0.85/msg) and frustrating customers. Pausing recovery protects merchant unit economics
 * until human operators confirm gateway recovery.
 */
export const CIRCUIT_BREAKER_WINDOW_MINUTES = 15;
export const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 10;

export interface CircuitBreakerStatus {
  tripped: boolean;
  failure_count: number;
  window_minutes: number;
  bucket: FailureBucket;
  alert_message: string;
}

export function evaluateCircuitBreakers(
  transactions: Transaction[],
  nowMs: number = Date.now()
): Record<FailureBucket, CircuitBreakerStatus> {
  const windowMs = CIRCUIT_BREAKER_WINDOW_MINUTES * 60 * 1000;
  const cutoffTime = nowMs - windowMs;

  const buckets: FailureBucket[] = [
    'upi_timeout',
    'card_decline',
    'network_error',
    'cart_abandon',
    'insufficient_funds',
    'other',
  ];

  const counts: Record<FailureBucket, number> = {
    upi_timeout: 0,
    card_decline: 0,
    network_error: 0,
    cart_abandon: 0,
    insufficient_funds: 0,
    other: 0,
  };

  for (const tx of transactions) {
    const txTime = new Date(tx.created_at).getTime();
    if (txTime >= cutoffTime) {
      if (counts[tx.failure_bucket] !== undefined) {
        counts[tx.failure_bucket]++;
      }
    }
  }

  const result: Partial<Record<FailureBucket, CircuitBreakerStatus>> = {};

  for (const bucket of buckets) {
    const count = counts[bucket];
    const tripped = count >= CIRCUIT_BREAKER_FAILURE_THRESHOLD;
    const readableBucket = bucket.replace('_', ' ').toUpperCase();

    result[bucket] = {
      tripped,
      failure_count: count,
      window_minutes: CIRCUIT_BREAKER_WINDOW_MINUTES,
      bucket,
      alert_message: tripped
        ? `Possible systemic issue in ${readableBucket} — ${count} failures in ${CIRCUIT_BREAKER_WINDOW_MINUTES} minutes, recovery paused pending review.`
        : '',
    };
  }

  return result as Record<FailureBucket, CircuitBreakerStatus>;
}

export function isCircuitBreakerTripped(
  bucket: FailureBucket,
  transactions: Transaction[],
  nowMs: number = Date.now()
): CircuitBreakerStatus {
  const all = evaluateCircuitBreakers(transactions, nowMs);
  return all[bucket];
}
