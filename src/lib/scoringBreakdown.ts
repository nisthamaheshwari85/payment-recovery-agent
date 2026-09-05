import { Customer, Transaction } from './types';

export interface ScoreItem {
  id: string;
  label: string;
  points: number; // positive or negative points, e.g. +25, +20, -10
  explanation: string;
}

export interface ComputedScoreBreakdown {
  items: ScoreItem[];
  total_score: number;
}

/**
 * Computes an explainable additive recoverability score breakdown
 * derived transparently from actual transaction and customer fields.
 */
export function computeExplainableScoreBreakdown(
  tx: Transaction,
  customer?: Customer | null
): ComputedScoreBreakdown {
  const items: ScoreItem[] = [];
  const cust = customer || tx.customer;

  // 1. Base Intent & Payment Stage
  if (tx.failure_bucket === 'cart_abandon' || tx.failure_reason_raw?.toLowerCase().includes('abandon')) {
    items.push({
      id: 'stage_abandon',
      points: 15,
      label: '+15 Cart-level intent',
      explanation: 'User reached checkout modal but dropped off before initiating payment gateway auth',
    });
  } else {
    items.push({
      id: 'stage_initiated',
      points: 25,
      label: '+25 Payment was initiated',
      explanation: 'Reached gateway authorization stage, confirming high buyer purchase intent',
    });
  }

  // 2. Failure Bucket Nature (Transient vs Permanent)
  if (tx.failure_bucket === 'upi_timeout' || tx.failure_bucket === 'network_error') {
    items.push({
      id: 'transient_failure',
      points: 20,
      label: '+20 Transient failure reason',
      explanation: `${tx.failure_bucket === 'upi_timeout' ? 'UPI NPCI switch timeout' : 'Network connection drop'} — user intent and bank balance remain valid`,
    });
  } else if (tx.failure_bucket === 'card_decline') {
    items.push({
      id: 'auth_decline',
      points: 12,
      label: '+12 Card decline / 3DS OTP timeout',
      explanation: 'Issuer 3DS OTP expired; highly recoverable via instant 1-tap UPI fallback',
    });
  } else if (tx.failure_bucket === 'insufficient_funds') {
    items.push({
      id: 'funds_limit',
      points: 8,
      label: '+8 Account balance limit reached',
      explanation: 'Recoverable via Card EMI, PayLater, or alternate payment instruments',
    });
  } else {
    items.push({
      id: 'other_failure',
      points: 5,
      label: '+5 Unclassified failure category',
      explanation: 'Standard fallback baseline for generic gateway error codes',
    });
  }

  // 3. Order Value Tier Bonus / Consideration Factor
  if (tx.amount <= 1500) {
    items.push({
      id: 'order_tier_low',
      points: 15,
      label: '+15 Order value tier bonus (Low ticket)',
      explanation: `₹${tx.amount.toLocaleString('en-IN')} ticket size has minimal purchase friction and high impulse conversion`,
    });
  } else if (tx.amount <= 5000) {
    items.push({
      id: 'order_tier_mid',
      points: 10,
      label: '+10 Order value tier bonus (Standard ticket)',
      explanation: `₹${tx.amount.toLocaleString('en-IN')} ticket size sits within optimal D2C recovery band`,
    });
  } else if (tx.amount <= 15000) {
    items.push({
      id: 'order_tier_moderate',
      points: 5,
      label: '+5 Order value tier bonus (Moderate ticket)',
      explanation: `₹${tx.amount.toLocaleString('en-IN')} ticket size has moderate conversion elasticity`,
    });
  } else {
    items.push({
      id: 'order_tier_high',
      points: -5,
      label: '-5 High order value penalty',
      explanation: `₹${tx.amount.toLocaleString('en-IN')} high-ticket purchase requires re-deliberation and higher buyer consideration`,
    });
  }

  // 4. Previous Recovery Attempts History
  const attemptsCount = tx.recovery_attempts?.length || 0;
  if (attemptsCount === 0) {
    items.push({
      id: 'attempt_fresh',
      points: 15,
      label: '+15 Fresh failure (0 previous attempts)',
      explanation: 'Customer has not yet been contacted; maximum responsiveness in first golden hour',
    });
  } else if (attemptsCount === 1) {
    items.push({
      id: 'attempt_single',
      points: 8,
      label: '+8 Single follow-up opportunity',
      explanation: '1 previous gentle reminder dispatched; secondary conversion window active',
    });
  } else {
    items.push({
      id: 'attempt_diminishing',
      points: -10,
      label: '-10 Diminishing response penalty',
      explanation: `${attemptsCount} previous attempts dispatched without conversion; customer fatigue factor`,
    });
  }

  // 5. Customer History & Repeat-Failure Check
  const hasRepeat =
    tx.has_recurring_failure ||
    (cust && cust.total_failed >= 2 && cust.total_recovered === 0);

  if (hasRepeat) {
    items.push({
      id: 'repeat_failure_penalty',
      points: -10,
      label: '-10 Repeated failure history',
      explanation: 'Customer has 2+ past failed checkouts on this instrument; elevated friction profile',
    });
  } else if (cust && cust.total_recovered > 0) {
    items.push({
      id: 'repeat_recovered_bonus',
      points: 12,
      label: '+12 Repeat converted customer',
      explanation: `Customer previously salvaged ${cust.total_recovered} orders; verified payment willingness`,
    });
  } else {
    items.push({
      id: 'baseline_customer',
      points: 5,
      label: '+5 Standard customer standing',
      explanation: 'Clean recovery profile with zero adverse opt-outs or payment disputes',
    });
  }

  // 6. Base Baseline Platform Index
  items.unshift({
    id: 'base_platform',
    points: 10,
    label: '+10 Base platform recoverability',
    explanation: 'Benchmark checkout confidence on modern payment gateways',
  });

  const rawTotal = items.reduce((acc, item) => acc + item.points, 0);
  const finalScore = Math.max(5, Math.min(98, rawTotal));

  return {
    items,
    total_score: finalScore,
  };
}
