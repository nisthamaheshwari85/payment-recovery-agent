import { Customer, FailureBucket, ScoreBreakdown } from './types';

interface ScorerInput {
  failure_bucket: FailureBucket;
  amount: number;
  customer?: Customer | null;
  channel?: string;
  created_at?: string;
}

const BUCKET_BASE_SCORES: Record<FailureBucket, number> = {
  upi_timeout: 88, // Intent is complete, bank NPCI switch issue -> very high recovery
  network_error: 84, // Temporary drop -> very high recovery with single-click retry
  cart_abandon: 72, // User dropped off -> high recovery if reminded quickly
  card_decline: 56, // 3DS OTP timeout / CVV issue -> moderate recovery if offered UPI/card retry
  insufficient_funds: 42, // Account balance issue -> low to moderate recovery unless alternate source
  other: 25, // Unclear / fraud / system rejection -> low recovery
};

export function computeRecoverabilityScore(input: ScorerInput): ScoreBreakdown {
  const { failure_bucket, amount, customer, channel, created_at } = input;
  const rationale: string[] = [];

  // 1. Base Bucket Score
  const baseScore = BUCKET_BASE_SCORES[failure_bucket] || 50;
  rationale.push(`Root cause bucket '${failure_bucket}' establishes base recoverability of ${baseScore}/100.`);

  // 2. Amount Adjustment
  let amountAdj = 0;
  if (amount <= 1000) {
    amountAdj = 10;
    rationale.push(`Low ticket size (₹${amount}) has minimal purchase friction (+10 pts).`);
  } else if (amount <= 3000) {
    amountAdj = 5;
    rationale.push(`Moderate ticket size (₹${amount}) has high recovery conversion (+5 pts).`);
  } else if (amount <= 10000) {
    amountAdj = 0;
    rationale.push(`Standard ticket size (₹${amount}) neutral conversion impact (0 pts).`);
  } else if (amount <= 25000) {
    amountAdj = -6;
    rationale.push(`Higher ticket size (₹${amount}) involves greater consideration (-6 pts).`);
  } else {
    amountAdj = -14;
    rationale.push(`High-value transaction (₹${amount}) has higher customer drop-off sensitivity (-14 pts).`);
  }

  // 3. Customer History Adjustment
  let historyAdj = 0;
  if (customer) {
    if (customer.total_recovered > 0) {
      historyAdj += 14;
      rationale.push(`Repeat customer with ${customer.total_recovered} previous successful recoveries (+14 pts).`);
    } else if (customer.total_failed > 3 && customer.total_recovered === 0) {
      historyAdj -= 10;
      rationale.push(`Customer has ${customer.total_failed} past failures without conversion (-10 pts).`);
    } else {
      rationale.push('Customer has no adverse recovery history (0 pts).');
    }
  } else {
    rationale.push('New customer profile with default baseline history.');
  }

  // 4. Channel Factor
  let channelFactor = 1.0;
  if (channel === 'upi_app') {
    channelFactor = 1.05;
    rationale.push('UPI App intent supports instant 1-tap re-triggering (+5% multiplier).');
  }

  // 5. Time Decay Penalty
  let timeDecay = 0;
  if (created_at) {
    const elapsedHours = (Date.now() - new Date(created_at).getTime()) / 3600000;
    if (elapsedHours > 48) {
      timeDecay = 15;
      rationale.push(`Over 48 hours elapsed since failure (-15 pts decay).`);
    } else if (elapsedHours > 24) {
      timeDecay = 10;
      rationale.push(`24-48 hours elapsed since failure (-10 pts decay).`);
    } else if (elapsedHours > 6) {
      timeDecay = 4;
      rationale.push(`6-24 hours elapsed since failure (-4 pts decay).`);
    } else {
      rationale.push('Fresh failure event within active recovery golden window (0 pts decay).');
    }
  }

  // Compute final bounded score
  let rawScore = (baseScore + amountAdj + historyAdj) * channelFactor - timeDecay;
  const finalScore = Math.max(5, Math.min(98, Math.round(rawScore)));

  return {
    base_bucket_score: baseScore,
    amount_adjustment: amountAdj,
    history_adjustment: historyAdj,
    time_decay_penalty: timeDecay,
    channel_factor: channelFactor,
    final_score: finalScore,
    rationale,
  };
}
