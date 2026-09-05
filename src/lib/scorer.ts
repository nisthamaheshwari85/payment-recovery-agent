import { Customer, FailureBucket, ScoreBreakdown } from './types';
import { computeExplainableScoreBreakdown } from './scoringBreakdown';

interface ScorerInput {
  failure_bucket: FailureBucket;
  amount: number;
  customer?: Customer | null;
  channel?: string;
  created_at?: string;
  failure_reason_raw?: string;
  recovery_attempts?: any[];
  has_recurring_failure?: boolean;
}

export function computeRecoverabilityScore(input: ScorerInput): ScoreBreakdown {
  const {
    failure_bucket,
    amount,
    customer,
    channel,
    created_at,
    failure_reason_raw,
    recovery_attempts,
    has_recurring_failure,
  } = input;

  const mockTx: any = {
    failure_bucket,
    amount,
    channel: channel || 'checkout_web',
    created_at: created_at || new Date().toISOString(),
    failure_reason_raw: failure_reason_raw || '',
    recovery_attempts: recovery_attempts || [],
    has_recurring_failure: has_recurring_failure || false,
    customer: customer || undefined,
  };

  const breakdown = computeExplainableScoreBreakdown(mockTx, customer);
  const finalScore = breakdown.total_score;

  const baseItem = breakdown.items.find((i) => i.id === 'base_platform');
  const amountItem = breakdown.items.find((i) => i.id.startsWith('order_tier_'));
  const historyItem = breakdown.items.find((i) => i.id.includes('repeat') || i.id === 'baseline_customer');

  return {
    base_bucket_score: baseItem ? baseItem.points : 10,
    amount_adjustment: amountItem ? amountItem.points : 0,
    history_adjustment: historyItem ? historyItem.points : 0,
    time_decay_penalty: 0,
    channel_factor: 1.0,
    final_score: finalScore,
    rationale: breakdown.items.map((i) => `${i.label}: ${i.explanation}`),
  };
}
