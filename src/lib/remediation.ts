import { FailureBucket, Transaction, Customer, RemediationStrategy, EconomicEvaluation } from './types';

/**
 * UNIT ECONOMICS CONSTANTS:
 * 
 * Sources & Assumptions:
 * 1. Meta WhatsApp Business Platform published rates for India (per-conversation pricing):
 *    - Marketing conversation: ₹0.82 / message
 *    - Utility conversation: ₹0.35 / message
 *    - Business Solution Provider (BSP) / Cloud API markup (e.g. Gupshup/Twilio/Razorpay): ~₹0.05
 *    - Blended operational cost per outreach: ₹0.85
 * 
 * 2. ROI Hurdle Rate (3.0x Multiplier):
 *    - Typical Indian direct-to-consumer (D2C) / retail merchant gross margin is ~30% to 35%.
 *    - Razorpay payment gateway MDR is ~2%.
 *    - Sending an outreach touchpoint burns customer goodwill and risks opt-outs ("STOP").
 *    - Therefore, Expected Value (EV) must exceed at least 3.0x the messaging cost (₹2.55 minimum EV)
 *      to ensure the recovery is net-profit positive and unit-economically viable.
 */
export const WHATSAPP_MESSAGE_COST_INR = 0.85;
export const SMS_MESSAGE_COST_INR = 0.25;
export const DEFAULT_ROI_HURDLE_MULTIPLIER = 3.0;

/**
 * Computes whether a recovery message is economically viable to dispatch.
 * 
 * EV = (recoverability_score / 100) * amount
 * Hurdle Threshold = message_cost * hurdle_multiplier
 */
export function evaluateEconomicViability(
  amount: number,
  recoverabilityScore: number,
  channel: 'whatsapp' | 'sms' = 'whatsapp',
  hurdleMultiplier: number = DEFAULT_ROI_HURDLE_MULTIPLIER
): EconomicEvaluation {
  const channelCost = channel === 'sms' ? SMS_MESSAGE_COST_INR : WHATSAPP_MESSAGE_COST_INR;
  const probability = Math.max(0, Math.min(100, recoverabilityScore)) / 100;
  const expectedValue = Math.round(probability * amount * 100) / 100;
  const hurdleThreshold = Math.round(channelCost * hurdleMultiplier * 100) / 100;
  const isViable = expectedValue >= hurdleThreshold;
  const netRoiRatio = channelCost > 0 ? Math.round((expectedValue / channelCost) * 10) / 10 : 0;

  const decisionRationale = isViable
    ? `Unit economics PASS: Expected value ₹${expectedValue.toFixed(2)} (Score ${recoverabilityScore}% of ₹${amount}) exceeds ₹${hurdleThreshold.toFixed(2)} hurdle threshold (${hurdleMultiplier}x of ₹${channelCost.toFixed(2)} message cost). ROI Ratio: ${netRoiRatio}x.`
    : `Unit economics REJECTED: Expected value ₹${expectedValue.toFixed(2)} is BELOW the ₹${hurdleThreshold.toFixed(2)} economic hurdle (${hurdleMultiplier}x of ₹${channelCost.toFixed(2)} message cost). Skipped outreach to prevent negative merchant ROI and customer spam.`;

  return {
    expected_value: expectedValue,
    channel_cost: channelCost,
    hurdle_multiplier: hurdleMultiplier,
    hurdle_threshold: hurdleThreshold,
    is_viable: isViable,
    net_roi_ratio: netRoiRatio,
    decision_rationale: decisionRationale,
  };
}

/**
 * Root-Cause-Specific Remediation Strategy Engine.
 * Replaces generic "one retry link fits all" with tailored payment recovery actions.
 */
export function determineRemediationStrategy(
  tx: Partial<Transaction> & {
    amount: number;
    failure_bucket: FailureBucket;
    failure_reason_raw?: string;
  },
  customer?: Customer | null
): RemediationStrategy {
  const bucket = tx.failure_bucket;

  switch (bucket) {
    case 'upi_timeout':
      return {
        type: 'transient_network_retry',
        title: 'Transient Gateway Retry',
        action_summary: 'Generate direct 1-click UPI retry link with intent payload',
        channel_payload_type: 'direct_retry_link',
        parameters: {
          alternate_instrument: 'Direct UPI Instant Retry',
        },
        reasoning:
          'Failure caused by transient NPCI/PSP switch timeout. Customer intent and bank balance remain valid; direct one-tap retry on the same instrument has an 82% recovery conversion rate.',
      };

    case 'network_error':
      return {
        type: 'transient_network_retry',
        title: 'Connection Reconnect Link',
        action_summary: 'Generate persistent session retry link without cart re-entry',
        channel_payload_type: 'direct_retry_link',
        parameters: {
          alternate_instrument: 'Preserved Session Checkout',
        },
        reasoning:
          'Failure caused by client connection drop or webview socket hangup. Re-opening the saved checkout session allows completion without re-filling details.',
      };

    case 'insufficient_funds':
      return {
        type: 'flexible_payment_split_emi',
        title: 'Flexible Payment & EMI Options',
        action_summary: 'Offer Razorpay payment link with Card EMI, PayLater, and alternate payment rails enabled',
        channel_payload_type: 'emi_flexible_link',
        parameters: {
          enable_emi: true,
          alternate_instrument: 'Card EMI / PayLater / Alternate Account',
        },
        reasoning:
          'Account balance or daily debit limit was exceeded. Resending a direct debit retry will predictably fail again. Supplying flexible payment rails (Card EMI, PayLater, or alternate account) unlocks purchasing power.',
      };

    case 'cart_abandon':
      return {
        type: 'cart_value_rescue',
        title: 'Saved Cart Session Recovery',
        action_summary: 'Send reassuring cart summary with direct checkout restoration link, avoiding payment failure language',
        channel_payload_type: 'cart_incentive_summary',
        parameters: {
          alternate_instrument: 'Preserved Cart Session Link',
        },
        reasoning:
          'Customer voluntarily exited the checkout modal without attempting payment. A "payment failed" alert would be factually incorrect and erode customer trust. A transactional cart restoration link allows 1-tap checkout without re-filling details, complying with TRAI DLT transactional rules.',
      };

    case 'card_decline':
      return {
        type: 'card_auth_switch_upi',
        title: 'Authentication Fallback to Instant UPI',
        action_summary: 'Offer alternate instant UPI / Netbanking payment link to bypass card 3DS OTP failures',
        channel_payload_type: 'upi_fallback_link',
        parameters: {
          alternate_instrument: 'Instant UPI / Google Pay / PhonePe',
        },
        reasoning:
          'Card was rejected by issuer bank (3DS OTP timeout or international limit disabled). Prompting a frictionless switch to Instant UPI bypasses card OTP gates.',
      };

    default:
      return {
        type: 'general_recovery',
        title: 'Multi-Rail Recovery Link',
        action_summary: 'Generate secure multi-instrument Razorpay retry link',
        channel_payload_type: 'direct_retry_link',
        parameters: {
          alternate_instrument: 'All Supported Instruments',
        },
        reasoning:
          'Unclassified gateway anomaly. Providing a secure universal Razorpay payment link enables customer to pick their preferred recovery method.',
      };
  }
}
