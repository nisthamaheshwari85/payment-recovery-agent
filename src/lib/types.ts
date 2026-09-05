export type FailureBucket =
  | 'card_decline'
  | 'upi_timeout'
  | 'network_error'
  | 'cart_abandon'
  | 'insufficient_funds'
  | 'other';

export type TransactionStatus =
  | 'failed'
  | 'in_recovery'
  | 'recovered'
  | 'escalated_human_review'
  | 'not_economically_viable'
  | 'unrecoverable'
  | 'opted_out'
  | 'auto_resolved_late_capture';

export type RecoveryOutcome =
  | 'sent'
  | 'delivered'
  | 'read'
  | 'clicked'
  | 'retried'
  | 'recovered'
  | 'opted_out'
  | 'failed_escalated';

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email?: string;
  total_failed: number;
  total_recovered: number;
  do_not_contact: boolean;
  opted_out_at?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface ScoreBreakdown {
  base_bucket_score: number;
  amount_adjustment: number;
  history_adjustment: number;
  time_decay_penalty: number;
  channel_factor: number;
  final_score: number;
  rationale: string[];
}

export type RemediationStrategyType =
  | 'transient_network_retry'      // upi_timeout, network_error
  | 'flexible_payment_split_emi'   // insufficient_funds
  | 'cart_value_rescue'           // cart_abandon
  | 'card_auth_switch_upi'        // card_decline
  | 'general_recovery';           // other

export interface RemediationStrategy {
  type: RemediationStrategyType;
  title: string;
  action_summary: string;
  channel_payload_type: 'direct_retry_link' | 'emi_flexible_link' | 'cart_incentive_summary' | 'upi_fallback_link';
  parameters: {
    enable_emi?: boolean;
    incentive_discount_pct?: number; // e.g. 5% voucher code
    coupon_code?: string;
    alternate_instrument?: string;   // e.g. 'Instant UPI / GPay / Netbanking'
  };
  reasoning: string;
}

export interface RecurringFailurePattern {
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  repeated_bucket: FailureBucket;
  failure_count: number;
  total_transactions: number;
  plain_language_reason: string;
  suggested_prevention_action: string;
  recent_failure_reasons: string[];
}

export interface EconomicEvaluation {
  expected_value: number;       // (recoverability_score / 100) * amount in INR
  channel_cost: number;         // Estimated cost per message (e.g. ₹0.85 WhatsApp)
  hurdle_multiplier: number;    // e.g. 3.0x hurdle rate
  hurdle_threshold: number;     // channel_cost * hurdle_multiplier
  is_viable: boolean;           // expected_value >= hurdle_threshold
  net_roi_ratio: number;        // expected_value / channel_cost
  decision_rationale: string;
}

export interface Transaction {
  id: string;
  razorpay_payment_id: string;
  razorpay_order_id?: string;
  amount: number; // in INR
  customer_id: string;
  customer?: Customer;
  channel: 'checkout_web' | 'upi_app' | 'payment_link' | 'mobile_sdk';
  failure_reason_raw: string;
  failure_bucket: FailureBucket;
  recoverability_score: number;
  score_breakdown?: ScoreBreakdown;
  economic_evaluation?: EconomicEvaluation;
  remediation_strategy?: RemediationStrategy;
  has_recurring_failure?: boolean;
  recurring_pattern_summary?: string;
  status: TransactionStatus;
  retry_payment_link: string;
  razorpay_payment_link_id?: string;
  is_live_razorpay?: boolean;
  funnel_stage?: 'messaged' | 'link_clicked' | 'payment_retried' | 'recovered';
  created_at: string;
  updated_at: string;
  recovery_attempts?: RecoveryAttempt[];
}

export interface RecoveryAttempt {
  id: string;
  transaction_id: string;
  customer_id: string;
  attempt_number: number; // 1, 2, or 3
  channel: 'whatsapp' | 'sms';
  message_sent: string;
  sent_at: string;
  outcome: RecoveryOutcome;
  retry_payment_link: string;
  razorpay_payment_link_id?: string;
  is_live_razorpay?: boolean;
  llm_model_used?: string;
  remediation_strategy_used?: RemediationStrategyType;
  /**
   * TRAI / DLT regulatory message classification.
   * In India's telecom regulatory framework (TCCCPR), "transactional" (Service-Implicit)
   * communication covers essential transaction lifecycle alerts (e.g. payment failure, retry URL).
   * It is legally permitted to bypass customer DND (Do Not Disturb) registries, strictly provided
   * the message contains zero promotional language, incentives, discounts, or marketing urgency.
   */
  message_category?: 'transactional' | 'promotional';
  guardrail_checks?: {
    max_attempts_checked: boolean;
    cooldown_checked: boolean;
    opt_out_checked: boolean;
    tone_safety_checked: boolean;
    dlt_compliance_checked?: boolean;
  };
}

export interface HumanEscalation {
  id: string;
  transaction_id: string;
  customer_id: string;
  reason: string;
  status: 'pending' | 'in_review' | 'resolved' | 'closed';
  assigned_to?: string;
  notes?: string;
  created_at: string;
  resolved_at?: string;
  transaction?: Transaction;
  customer?: Customer;
}

export interface GuardrailCheckResult {
  allowed: boolean;
  code:
    | 'ALLOWED'
    | 'MAX_ATTEMPTS_EXCEEDED'
    | 'COOLDOWN_ACTIVE'
    | 'DO_NOT_CONTACT'
    | 'TRANSACTION_ALREADY_RESOLVED'
    | 'NOT_ECONOMICALLY_VIABLE'
    | 'INVALID_STATUS'
    | 'CIRCUIT_BREAKER_TRIPPED'
    | 'AUTO_RESOLVED_LATE_CAPTURE';
  message: string;
  cooldown_remaining_seconds?: number;
  current_attempt_count?: number;
}

export interface AnalyticsSummary {
  total_revenue_at_risk: number;
  total_recovered_revenue: number;
  blended_recovery_rate: number;
  total_transactions: number;
  active_in_recovery: number;
  recovered_count: number;
  escalated_count: number;
  unviable_count: number;
  opted_out_count: number;
  bucket_metrics: Record<
    FailureBucket,
    {
      count: number;
      revenue_at_risk: number;
      revenue_recovered: number;
      recovery_rate: number;
    }
  >;
  attempts_funnel: {
    attempt_1: { sent: number; converted: number; rate: number };
    attempt_2: { sent: number; converted: number; rate: number };
    attempt_3: { sent: number; converted: number; rate: number };
  };
  attribution_funnel?: AttributionFunnelMetrics;
}

export interface AttributionFunnelMetrics {
  messaged_count: number;
  link_clicked_count: number;
  payment_retried_count: number;
  payment_successful_count: number;
  click_rate: number;
  retry_rate: number;
  conversion_rate: number;
  recovered_revenue: number;
}
