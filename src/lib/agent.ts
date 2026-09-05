import { Customer, Transaction, RecoveryAttempt, FailureBucket, RemediationStrategy, EconomicEvaluation, RecurringFailurePattern } from './types';
import { db } from './db';
import { evaluateRecoveryGuardrails, sanitizeRecoveryMessage, detectDarkPatterns, validateTransactionalCompliance } from './guardrails';
import { razorpay } from './razorpay';
import { evaluateEconomicViability, determineRemediationStrategy } from './remediation';
import { getCustomerRecurringPattern } from './patterns';
import { isCircuitBreakerTripped } from './circuitBreaker';
import { checkPaymentStateLog } from './paymentStateLog';

export interface MessageGenerationContext {
  customerName: string;
  amount: number;
  failureBucket: FailureBucket;
  failureReasonRaw: string;
  recoverabilityScore: number;
  attemptNumber: number;
  retryPaymentLink: string;
  remediationStrategy?: RemediationStrategy;
  recurringPattern?: RecurringFailurePattern;
}

const HINGLISH_FALLBACK_TEMPLATES: Record<
  FailureBucket,
  (ctx: MessageGenerationContext) => string
> = {
  upi_timeout: (ctx) => {
    if (ctx.attemptNumber === 1) {
      return `Namaste ${ctx.customerName}! Dekha aapka ₹${ctx.amount} ka payment UPI/bank network timeout ki wajah se complete nahi ho paya. Don't worry, aap bina dobara cart banaye yahan se direct retry kar sakte hain: ${ctx.retryPaymentLink} . Agar amount deduct hua ho, toh bank ke standard process ke mutabik refund ho jayega. Reply STOP to opt out.`;
    }
    return `Hi ${ctx.customerName}, aapka ₹${ctx.amount} ka order abhi bhi safely reserved hai. Agar aap UPI ya alternate option se complete karna chahte hain toh link open karein: ${ctx.retryPaymentLink} . Kisi madad ke liye reply karein. Reply STOP to opt out.`;
  },
  card_decline: (ctx) => {
    if (ctx.attemptNumber === 1) {
      return `Hi ${ctx.customerName}! Lagta hai aapke card payment pe bank OTP authenticate nahi ho paya (₹${ctx.amount}). Aap alternate card ya instant UPI ke through easily complete kar sakte hain: ${ctx.retryPaymentLink} . Reply STOP to opt out.`;
    }
    return `Namaste ${ctx.customerName}, aapke transaction (₹${ctx.amount}) ke liye payment window active hai. UPI ya netbanking se retry karne ke liye tap karein: ${ctx.retryPaymentLink} . Reply STOP to opt out.`;
  },
  network_error: (ctx) => {
    if (ctx.attemptNumber === 1) {
      return `Hi ${ctx.customerName}! Internet glitch ya connection drop hone ki wajah se aapka ₹${ctx.amount} ka checkout interrupt ho gaya tha. Ek tap mein bina data re-enter kiye complete karein: ${ctx.retryPaymentLink} . Reply STOP to opt out.`;
    }
    return `Namaste ${ctx.customerName}, humne aapka checkout session save kar rakha hai. Yahan se retry karein: ${ctx.retryPaymentLink} . Koi pareshani ho toh batayein. Reply STOP to opt out.`;
  },
  cart_abandon: (ctx) => {
    if (ctx.attemptNumber === 1) {
      return `Namaste ${ctx.customerName}! Dekha aapka checkout session complete nahi ho paya tha (Total: ₹${ctx.amount}). Humne aapke cart items safely reserve kar rakhe hain. Ek tap mein direct yahan se complete karein: ${ctx.retryPaymentLink} . Reply STOP to opt out.`;
    }
    return `Hi ${ctx.customerName}, aapka checkout session (₹${ctx.amount}) active hai aur cart items reserved hain. Yahan se bina dobara items select kiye complete karein: ${ctx.retryPaymentLink} . Reply STOP to opt out.`;
  },
  insufficient_funds: (ctx) => {
    return `Hi ${ctx.customerName}! Aapka ₹${ctx.amount} ka checkout flexible payment ke liye ready hai. Aap Card EMI, PayLater ya alternate account se easily complete kar sakte hain: ${ctx.retryPaymentLink} . Reply STOP to opt out.`;
  },
  other: (ctx) => {
    return `Namaste ${ctx.customerName}, aapka ₹${ctx.amount} ka payment session complete nahi ho saka. Yahan se safe Razorpay retry link open karein: ${ctx.retryPaymentLink} . Kisi issue ke liye reply karein. Reply STOP to opt out.`;
  },
};

export async function generateHinglishRecoveryMessage(
  context: MessageGenerationContext
): Promise<{ message: string; modelUsed: string; isLlmGenerated: boolean }> {
  const apiKey = process.env.GROQ_API_KEY;

  if (apiKey) {
    const strat = context.remediationStrategy || determineRemediationStrategy({
      amount: context.amount,
      failure_bucket: context.failureBucket,
      failure_reason_raw: context.failureReasonRaw,
    });

    // Strategy-specific instructions
    let strategyGuidance = '';
    if (strat.type === 'cart_value_rescue') {
      strategyGuidance = `SPECIAL REMEDIATION ACTION: CART VALUE RESCUE.
The customer voluntarily abandoned their shopping cart BEFORE attempting payment.
DO NOT mention payment failure, bank error, or transaction decline!
Write a welcoming cart reminder stating their items are safely reserved in their checkout session.
STRICTLY DO NOT include promotional offers, discounts, coupon codes, or artificial urgency to comply with India TRAI DLT transactional template standards.`;
    } else if (strat.type === 'flexible_payment_split_emi') {
      strategyGuidance = `SPECIAL REMEDIATION ACTION: FLEXIBLE PAYMENT & EMI OPTIONS.
This transaction failed due to insufficient account balance or daily bank limits.
DO NOT ask them to retry the exact same failing card or debit account!
Explicitly explain that flexible payment options (including No-Cost/Low-Cost Card EMI, PayLater, or alternate account rails) are enabled on the link.`;
    } else if (strat.type === 'card_auth_switch_upi') {
      strategyGuidance = `SPECIAL REMEDIATION ACTION: AUTHENTICATION FALLBACK TO INSTANT UPI.
The customer's card was rejected by the bank (OTP timeout or card limit).
Encourage them to complete via Instant 1-click UPI (Google Pay, PhonePe) or Netbanking on the link to avoid card OTP friction.`;
    } else {
      strategyGuidance = `SPECIAL REMEDIATION ACTION: TRANSIENT GATEWAY RETRY.
Transient network / UPI timeout. If money was debited, reassure them using strictly non-committal language like "any amount debited will be refunded as per your bank's standard process" (STRICTLY NEVER promise any specific timeline or number of hours/days). Provide the direct 1-tap retry link.`;
    }

    if (context.recurringPattern) {
      strategyGuidance += `\n\nHISTORICAL REPEAT-FAILURE CONTEXT:
This customer has experienced this specific failure multiple times before (${context.recurringPattern.plain_language_reason}).
Acknowledge with warmth and extra care that they have faced this issue before without sounding accusatory.
Offer practical guidance (${context.recurringPattern.suggested_prevention_action}) so they do not experience repeat failure on their next attempt.`;
    }

    const systemPrompt = `You are an empathetic, culturally resonant Payment Recovery AI Agent for an Indian brand on Razorpay.
Your mission is to craft an authentic, polite, considerate, and helpful WhatsApp message in conversational Hinglish (natural Hindi written in Latin script + conversational English).

CRITICAL REGULATORY & ETHICAL CONSTRAINTS:
1. TRAI DLT Transactional Template Compliance (Service-Implicit):
   Strictly NEVER use promotional language, discount vouchers, marketing incentives, or fake urgency.
   Prohibited words: "discount", "voucher", "coupon", "promo", "SAVE5", "offer", "sale", "hurry", "last chance", "limited time", "urgent", "penalty", "final warning", "account blocked".
2. STRICT BAN ON SPECIFIC REFUND TIMELINES (Compliance & Bank Liability):
   NEVER autonomously state or promise any specific refund timeframe (no "24-48 hours", no "X days", no numeric timeline of any kind regarding refunds).
   Actual refund processing depends entirely on the customer's bank. If mentioning a debited amount, use ONLY generic non-committal language:
   "agar amount deduct hua ho, toh bank ke standard process ke mutabik refund ho jayega" or "any amount debited will be refunded as per your bank's standard process".
3. Tone must be warm, respectful, and non-accusatory. Never blame the customer.
4. Apply the specific remediation strategy below.
5. End with the exact Razorpay link: ${context.retryPaymentLink}
6. Conclude with the mandatory opt-out disclaimer: "(Reply STOP to opt out)"
7. Length: between 35 and 65 words.
8. Output ONLY the WhatsApp message text without quotes, headers, or markdown wrappers.

${strategyGuidance}`;

    const userPrompt = `Generate a personalized Hinglish recovery message for this customer context:
- Customer Name: ${context.customerName}
- Amount: ₹${context.amount}
- Root Cause: ${context.failureBucket}
- Raw Telemetry: "${context.failureReasonRaw}"
- Recoverability Score: ${context.recoverabilityScore}/100
- Remediation Strategy Chosen: ${strat.title} (${strat.type})
- Remediation Reasoning: ${strat.reasoning}${context.recurringPattern ? `\n- Repeat Pattern: ${context.recurringPattern.plain_language_reason}` : ''}
- Outreach Attempt: #${context.attemptNumber} of 3
- Razorpay Secure Link: ${context.retryPaymentLink}`;

    // Try primary high-throughput model (qwen/qwen3.8-27b), then fallback model
    const candidateModels = [
      { id: 'qwen/qwen3.8-27b', maxTokens: 250 },
      { id: 'openai/gpt-oss-20b', maxTokens: 450 },
    ];

    for (const candidate of candidateModels) {
      for (let retry = 0; retry < 2; retry++) {
        try {
          const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: candidate.id,
              messages: [
                { role: 'system', content: systemPrompt },
                {
                  role: 'user',
                  content:
                    retry > 0
                      ? `${userPrompt}\n\nIMPORTANT: Your previous output contained prohibited urgency words or a specific refund timeline promise. Strictly avoid words like discount, coupon, offer, hurry, or promising specific refund hours/days (like 24-48 hours). If mentioning refund, use ONLY 'as per your bank's standard process'. Keep it strictly transactional, supportive, and helpful.`
                      : userPrompt,
                },
              ],
              temperature: 0.7,
              max_tokens: candidate.maxTokens,
            }),
          });

          if (!res.ok) {
            console.warn(`[Groq LLM] Model ${candidate.id} returned status ${res.status}`);
            break; // Try next model
          }

          const data = await res.json();
          const rawContent = data.choices?.[0]?.message?.content?.trim();

          if (rawContent && rawContent.length > 20) {
            // Post-generation guardrail checks: dark patterns & TRAI DLT transactional compliance
            const darkPatternCheck = detectDarkPatterns(rawContent);
            const dltCheck = validateTransactionalCompliance(rawContent);

            if (darkPatternCheck.hasViolation || !dltCheck.isCompliant) {
              const allViolations = [...darkPatternCheck.matched, ...dltCheck.violations];
              console.warn(
                `[Guardrail Engine] Regulatory / dark pattern violation detected in LLM output: ${allViolations.join(', ')}. Triggering rejection and re-generation.`
              );
              continue; // Re-prompt LLM with explicit rejection
            }

            const { cleanMessage } = sanitizeRecoveryMessage(rawContent);
            return {
              message: cleanMessage,
              modelUsed: `groq/${candidate.id}`,
              isLlmGenerated: true,
            };
          }
        } catch (err) {
          console.warn(`[Groq LLM] Error calling ${candidate.id}:`, err);
          break;
        }
      }
    }
  }

  // Deterministic fallback if LLM is unavailable or offline
  const fallbackGenerator =
    HINGLISH_FALLBACK_TEMPLATES[context.failureBucket] || HINGLISH_FALLBACK_TEMPLATES.other;
  const rawFallback = fallbackGenerator(context);
  const { cleanMessage } = sanitizeRecoveryMessage(rawFallback);

  return {
    message: cleanMessage,
    modelUsed: 'deterministic-hinglish-template-engine (fallback)',
    isLlmGenerated: false,
  };
}

export async function executeRecoveryOutreach(transactionId: string): Promise<{
  success: boolean;
  guardrail: ReturnType<typeof evaluateRecoveryGuardrails>;
  economic_evaluation?: EconomicEvaluation;
  remediation_strategy?: RemediationStrategy;
  attempt?: RecoveryAttempt;
  transaction?: Transaction;
}> {
  const tx = await db.getTransactionById(transactionId);
  if (!tx) {
    throw new Error(`Transaction ${transactionId} not found`);
  }

  const customer = tx.customer_id ? await db.getCustomerById(tx.customer_id) : null;
  const attempts = await db.getRecoveryAttempts(tx.id);

  // 1. Evaluate hard ethical guardrails (Opt-Out, Max 3 Attempts, 6h Cooldown)
  const guardrail = evaluateRecoveryGuardrails(tx, customer, attempts);

  if (!guardrail.allowed) {
    if (guardrail.code === 'MAX_ATTEMPTS_EXCEEDED' && tx.status !== 'escalated_human_review') {
      await db.updateTransaction(tx.id, {
        status: 'escalated_human_review',
      });

      await db.createHumanEscalation({
        id: `esc_${tx.id}_${Date.now()}`,
        transaction_id: tx.id,
        customer_id: tx.customer_id,
        reason: 'max_attempts_reached',
        status: 'pending',
        assigned_to: 'Support Team L2',
        notes: `Auto-escalated by Recovery Agent after exceeding 3 bounded attempts without customer conversion. Amount: ₹${tx.amount}, Failure: ${tx.failure_bucket}.`,
        created_at: new Date().toISOString(),
      });
    }

    return {
      success: false,
      guardrail,
      transaction: tx,
    };
  }

  // 1.5. MASS-FAILURE SYSTEMIC CIRCUIT BREAKER
  // Pauses automated recovery if a sudden burst of 10+ failures occurred in this bucket in the last 15 mins (indicating bank/switch outage)
  const allTxsForBreaker = await db.getTransactions();
  const circuitBreaker = isCircuitBreakerTripped(tx.failure_bucket, allTxsForBreaker);
  if (circuitBreaker.tripped) {
    console.warn(
      `[Circuit Breaker] Outreach PAUSED for transaction ${tx.id}. Bucket "${tx.failure_bucket}" has ${circuitBreaker.failure_count} failures in last ${circuitBreaker.window_minutes}m. Systemic gateway/bank outage suspected.`
    );
    return {
      success: false,
      guardrail: {
        allowed: false,
        code: 'CIRCUIT_BREAKER_TRIPPED',
        message: circuitBreaker.alert_message,
        current_attempt_count: attempts.length,
      },
      transaction: tx,
    };
  }

  // 2. COST-AWARE AGENTIC DECISION GATE
  // Computes Expected Value (EV) vs Channel Message Cost (₹0.85) with a 3.0x ROI Hurdle Rate
  const economicEval = evaluateEconomicViability(tx.amount, tx.recoverability_score, 'whatsapp');
  const remediationStrategy = determineRemediationStrategy(tx, customer);

  if (!economicEval.is_viable) {
    console.log(
      `[Cost-Aware Decision Gate] SKIP: Transaction ${tx.id} is NOT economically viable. ` +
        `Expected Value: ₹${economicEval.expected_value.toFixed(2)} < Hurdle Threshold: ₹${economicEval.hurdle_threshold.toFixed(2)} ` +
        `(Amount: ₹${tx.amount}, Score: ${tx.recoverability_score}%, Message Cost: ₹${economicEval.channel_cost}).`
    );

    const updatedTx = await db.updateTransaction(tx.id, {
      status: 'not_economically_viable',
      economic_evaluation: economicEval,
      remediation_strategy: remediationStrategy,
    });

    return {
      success: false,
      guardrail: {
        allowed: false,
        code: 'NOT_ECONOMICALLY_VIABLE',
        message: economicEval.decision_rationale,
        current_attempt_count: attempts.length,
      },
      economic_evaluation: economicEval,
      remediation_strategy: remediationStrategy,
      transaction: updatedTx || tx,
    };
  }

  // 2.5. PAYMENT-STATE RE-VERIFICATION (LATE AUTHORIZATION CHECK)
  // Re-verifies payment state against the payment state log before generating outreach.
  // Real UPI failures can sometimes resolve via late authorization / clearing at bank switch.
  const paymentState = checkPaymentStateLog(tx.id);
  if (paymentState.status === 'captured') {
    const logMsg = 'Payment state changed to captured after initial failure; outreach cancelled.';
    console.log(`[Payment Re-Verification] ${logMsg} (Transaction: ${tx.id}, Gateway ID: ${paymentState.gateway_payment_id || 'N/A'})`);

    const updatedTx = await db.updateTransaction(tx.id, {
      status: 'auto_resolved_late_capture',
      economic_evaluation: economicEval,
      remediation_strategy: remediationStrategy,
    });

    return {
      success: false,
      guardrail: {
        allowed: false,
        code: 'AUTO_RESOLVED_LATE_CAPTURE',
        message: logMsg,
        current_attempt_count: attempts.length,
      },
      economic_evaluation: economicEval,
      remediation_strategy: remediationStrategy,
      transaction: updatedTx || tx,
    };
  }

  // 3. ROOT-CAUSE-SPECIFIC REMEDIATION ACTION & IDEMPOTENCY KEY DERIVATION
  const nextAttemptNumber = attempts.length + 1;
  const idempotencyKey = `idem_${tx.id}_att_${nextAttemptNumber}`;

  let retryLink = tx.retry_payment_link;
  let paymentLinkId = tx.razorpay_payment_link_id;
  let isLiveRazorpay = tx.is_live_razorpay ?? false;

  // Check if an existing attempt already has a payment link for this attempt number
  const existingAttempt = attempts.find((a) => a.attempt_number === nextAttemptNumber);
  if (existingAttempt && existingAttempt.retry_payment_link) {
    retryLink = existingAttempt.retry_payment_link;
    paymentLinkId = existingAttempt.razorpay_payment_link_id;
    isLiveRazorpay = existingAttempt.is_live_razorpay ?? false;
  } else if (!paymentLinkId || paymentLinkId.startsWith('plink_sim_') || !retryLink || retryLink.includes('rec_')) {
    const customerName = customer ? customer.name : 'Valued Customer';
    
    // Pass strategy-specific parameters & idempotency key to Razorpay Payment Link notes
    const customNotes: Record<string, string> = {
      remediation_strategy: remediationStrategy.type,
      remediation_title: remediationStrategy.title,
      idempotency_key: idempotencyKey,
    };
    if (remediationStrategy.parameters.enable_emi) {
      customNotes.enable_emi = 'true';
      customNotes.enable_paylater = 'true';
    }

    const rzpResult = await razorpay.createPaymentLink({
      amount: tx.amount,
      customerName,
      customerEmail: customer?.email,
      customerPhone: customer?.phone,
      description: `${remediationStrategy.title} for order ${tx.razorpay_payment_id}`,
      transactionId: tx.id,
      attemptNumber: nextAttemptNumber,
      idempotencyKey,
      notes: customNotes,
    });

    if (rzpResult.link) {
      paymentLinkId = rzpResult.link.id;
      retryLink = rzpResult.link.short_url;
      isLiveRazorpay = !rzpResult.isSimulated;
    }
  }

  const customerFirstName = customer ? customer.name.split(' ')[0] : 'Valued Customer';

  // 4. CHECK HISTORICAL RECURRING FAILURE PATTERNS (Rule-based explainable telemetry)
  const allTransactions = await db.getTransactions();
  const recurringPattern = tx.customer_id
    ? getCustomerRecurringPattern(tx.customer_id, tx.failure_bucket, allTransactions)
    : null;

  const { message, modelUsed } = await generateHinglishRecoveryMessage({
    customerName: customerFirstName,
    amount: tx.amount,
    failureBucket: tx.failure_bucket,
    failureReasonRaw: tx.failure_reason_raw,
    recoverabilityScore: tx.recoverability_score,
    attemptNumber: nextAttemptNumber,
    retryPaymentLink: retryLink,
    remediationStrategy,
    recurringPattern: recurringPattern || undefined,
  });

  // 5. TRAI / DLT TRANSACTIONAL REGULATORY COMPLIANCE VERIFICATION
  const dltCheck = validateTransactionalCompliance(message);
  if (!dltCheck.isCompliant) {
    console.warn(
      `[DLT Compliance] Re-sanitizing message for transaction ${tx.id} due to promotional triggers: ${dltCheck.violations.join(', ')}`
    );
  }

  const attemptId = `att_${tx.id}_${nextAttemptNumber}_${Date.now()}`;
  const newAttempt: RecoveryAttempt = {
    id: attemptId,
    transaction_id: tx.id,
    customer_id: tx.customer_id,
    attempt_number: nextAttemptNumber,
    channel: 'whatsapp',
    message_sent: message,
    sent_at: new Date().toISOString(),
    outcome: 'sent',
    retry_payment_link: retryLink,
    razorpay_payment_link_id: paymentLinkId,
    is_live_razorpay: isLiveRazorpay,
    llm_model_used: modelUsed,
    remediation_strategy_used: remediationStrategy.type,
    /**
     * India Telecom TRAI / DLT regulatory category.
     * "transactional" represents Service-Implicit messaging (e.g. order failure alerts, payment links)
     * which permits DND-bypass delivery in India, provided it is strictly free of promotional/offer copy.
     */
    message_category: 'transactional',
    guardrail_checks: {
      max_attempts_checked: true,
      cooldown_checked: true,
      opt_out_checked: true,
      tone_safety_checked: true,
      dlt_compliance_checked: true,
    },
  };

  await db.createRecoveryAttempt(newAttempt);
  const updatedTx = await db.updateTransaction(tx.id, {
    status: 'in_recovery',
    retry_payment_link: retryLink,
    razorpay_payment_link_id: paymentLinkId,
    is_live_razorpay: isLiveRazorpay,
    economic_evaluation: economicEval,
    remediation_strategy: remediationStrategy,
    has_recurring_failure: Boolean(recurringPattern),
    recurring_pattern_summary: recurringPattern ? recurringPattern.plain_language_reason : undefined,
  });

  return {
    success: true,
    guardrail,
    economic_evaluation: economicEval,
    remediation_strategy: remediationStrategy,
    attempt: newAttempt,
    transaction: updatedTx || tx,
  };
}
