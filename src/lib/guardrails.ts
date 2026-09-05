import { Customer, Transaction, RecoveryAttempt, GuardrailCheckResult, FailureBucket } from './types';

/**
 * Bucket-Specific Cooldown & Attempt Policy Configuration
 *
 * Operational Rationale:
 * 1. upi_timeout (45 min) & network_error (30 min):
 *    Transient bank switch (NPCI / PSP) congestion or mobile packet drops resolve within minutes.
 *    Re-engaging the user while purchase intent is fresh yields high recovery conversion (~82%).
 * 2. insufficient_funds (12 hours / max 1 attempt):
 *    Bank accounts do not replenish within hours. Repeatedly chasing a customer whose balance or
 *    daily debit limit was exceeded is aggressive, causes brand friction, and yields poor ROI.
 *    We cap to 1 attempt to prevent customer harassment, with a 12h cooldown between any follow-up.
 * 3. cart_abandon (2 hours / max 2 attempts):
 *    Users who exit checkout need reasonable cognitive space before a reminder. Contacting too quickly
 *    (e.g. 10m) feels intrusive; waiting >4h loses checkout intent. 2 hours is the optimal D2C window.
 * 4. card_decline (2 hours / max 3 attempts):
 *    3DS OTP expires quickly, but card issuers often impose temporary velocity blocks. A 2-hour buffer
 *    prevents repeated card declines while offering UPI fallback.
 * 5. other (6 hours / max 3 attempts):
 *    Conservative default fallback window for unclassified errors.
 */
export interface BucketPolicyConfig {
  cooldown_minutes: number;
  max_attempts: number;
  label: string;
  rationale: string;
}

export const BUCKET_COOLDOWN_POLICIES: Record<FailureBucket, BucketPolicyConfig> = {
  upi_timeout: {
    cooldown_minutes: 45,
    max_attempts: 3,
    label: '45m Transient Cooldown',
    rationale: 'Transient bank switch congestion resolves quickly; prompt retry while intent is hot',
  },
  network_error: {
    cooldown_minutes: 30,
    max_attempts: 3,
    label: '30m Network Cooldown',
    rationale: 'Client connection drop; short cooldown allows seamless session resumption',
  },
  insufficient_funds: {
    cooldown_minutes: 720, // 12 hours
    max_attempts: 1, // Cap at 1 attempt
    label: '12h Strict Cooldown (Max 1 attempt)',
    rationale: 'Account balance does not replenish quickly; capped at 1 attempt to prevent harassment',
  },
  cart_abandon: {
    cooldown_minutes: 120, // 2 hours
    max_attempts: 2,
    label: '2h Cart Cooldown (Max 2 attempts)',
    rationale: 'Allows browsing intent to resurface without feeling intrusive',
  },
  card_decline: {
    cooldown_minutes: 120, // 2 hours
    max_attempts: 3,
    label: '2h Card Cooldown',
    rationale: 'Issuer velocity block buffer before offering alternate UPI rail',
  },
  other: {
    cooldown_minutes: 360, // 6 hours
    max_attempts: 3,
    label: '6h Standard Cooldown',
    rationale: 'Conservative default window for unclassified error telemetry',
  },
};

// Dark patterns / high-pressure trigger words that are strictly prohibited
export const PROHIBITED_DARK_PATTERNS = [
  /\bhurry(\s+up)?\b/i,
  /\bexpires in \d+ (minutes|seconds|hours)\b/i,
  /\boffer expires\b/i,
  /\bdeal expires\b/i,
  /\blast chance\b/i,
  /\blimited time (only|offer)?\b/i,
  /\bact now\b/i,
  /\baccount (will be )?blocked\b/i,
  /\blegal action\b/i,
  /\bpenalty\b/i,
  /\bfinal warning\b/i,
  /\bfinal reminder\b/i,
  /\byou will lose\b/i,
  /\burgent( action required)?\b/i,
  /\blose out\b/i,
  /\bdon'?t miss out\b/i,
];

export function detectDarkPatterns(text: string): { hasViolation: boolean; matched: string[] } {
  const matched: string[] = [];
  for (const pattern of PROHIBITED_DARK_PATTERNS) {
    if (pattern.test(text)) {
      matched.push(pattern.source);
    }
  }
  return {
    hasViolation: matched.length > 0,
    matched,
  };
}

/**
 * TRAI / DLT Transactional Message Compliance Checker (India TCCCPR Regulations).
 * Transactional (Service-Implicit) templates sent over Indian telecom / WhatsApp channels
 * are legally permitted to bypass DND filters ONLY if they contain zero promotional language,
 * marketing incentives, coupon codes, discounts, or urgency triggers.
 */
export const PROHIBITED_DLT_PROMOTIONAL_PATTERNS = [
  // Promotional / Marketing incentives
  /\b(discount|voucher|coupon|promo(\s?code)?|cashback|flat\s?\d+%\s?(off)?)\b/i,
  /\b(special offer|exclusive deal|buy 1 get 1|bogo|sale|loot|bonus)\b/i,
  /\b(save\s?\d+%\b|\bsave\s?₹\d+|\bsave5\b)\b/i,
  /\b(free gift|free voucher|unbeatable price|festive offer|mega sale)\b/i,
  // High-pressure urgency & false scarcity
  /\b(hurry(\s+up)?|last chance|offer expires|deal expires|limited time|act now)\b/i,
  /\b(expires in \d+|don'?t miss out|lose out|grab now|valid till)\b/i,
  /\b(account (will be )?blocked|legal action|penalty|final warning|final reminder)\b/i,
  /\burgent( action required)?\b/i,
];

export function validateTransactionalCompliance(text: string): {
  isCompliant: boolean;
  violations: string[];
  classification: 'transactional' | 'promotional_rejected';
} {
  const violations: string[] = [];
  for (const pattern of PROHIBITED_DLT_PROMOTIONAL_PATTERNS) {
    if (pattern.test(text)) {
      violations.push(pattern.source);
    }
  }

  return {
    isCompliant: violations.length === 0,
    violations,
    classification: violations.length === 0 ? 'transactional' : 'promotional_rejected',
  };
}

/**
 * Hard-coded Guardrail Gatekeeper.
 * Evaluates all 5 non-negotiable safety rules before any message can be dispatched.
 */
export function evaluateRecoveryGuardrails(
  transaction: Transaction,
  customer: Customer | null | undefined,
  attempts: RecoveryAttempt[]
): GuardrailCheckResult {
  // Guardrail 1: Check Customer Opt-Out / Do Not Contact
  if (customer?.do_not_contact) {
    return {
      allowed: false,
      code: 'DO_NOT_CONTACT',
      message: 'Customer has opted out of communications (do_not_contact = true). Outreach strictly blocked.',
      current_attempt_count: attempts.length,
    };
  }

  // Guardrail 2: Check Resolved or Escalated Status
  if (transaction.status === 'recovered') {
    return {
      allowed: false,
      code: 'TRANSACTION_ALREADY_RESOLVED',
      message: 'Transaction is already marked as recovered. No further recovery outreach permitted.',
      current_attempt_count: attempts.length,
    };
  }

  if (transaction.status === 'escalated_human_review') {
    return {
      allowed: false,
      code: 'INVALID_STATUS',
      message: 'Transaction is in Human Review escalation queue. Automated retries disabled.',
      current_attempt_count: attempts.length,
    };
  }

  if (transaction.status === 'opted_out') {
    return {
      allowed: false,
      code: 'DO_NOT_CONTACT',
      message: 'Transaction is marked as opted out. Further messaging prohibited.',
      current_attempt_count: attempts.length,
    };
  }

  // Resolve bucket-specific policy
  const bucketPolicy = BUCKET_COOLDOWN_POLICIES[transaction.failure_bucket] || BUCKET_COOLDOWN_POLICIES.other;
  const maxAttemptsForBucket = bucketPolicy.max_attempts;

  // Guardrail 3: MAX attempts per transaction policy for this bucket
  if (attempts.length >= maxAttemptsForBucket) {
    return {
      allowed: false,
      code: 'MAX_ATTEMPTS_EXCEEDED',
      message: `Maximum allowed attempts (${maxAttemptsForBucket}) reached for ${transaction.failure_bucket}. Auto-escalating to human review.`,
      current_attempt_count: attempts.length,
    };
  }

  // Guardrail 4: Bucket-specific cooldown gap between attempts
  if (attempts.length > 0) {
    // Sort to find the latest attempt
    const sortedAttempts = [...attempts].sort(
      (a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime()
    );
    const lastAttempt = sortedAttempts[0];
    const lastSentTime = new Date(lastAttempt.sent_at).getTime();
    const now = Date.now();
    const timeDiff = now - lastSentTime;
    const cooldownMs = bucketPolicy.cooldown_minutes * 60 * 1000;

    if (timeDiff < cooldownMs) {
      const remainingMs = cooldownMs - timeDiff;
      const remainingSeconds = Math.ceil(remainingMs / 1000);
      const remainingMinutes = Math.ceil(remainingMs / (60 * 1000));
      const remainingDisplay =
        remainingMinutes >= 60
          ? `${(remainingMinutes / 60).toFixed(1)} hours`
          : `${remainingMinutes} minutes`;

      return {
        allowed: false,
        code: 'COOLDOWN_ACTIVE',
        message: `Cooldown active: ${bucketPolicy.label} enforced for ${transaction.failure_bucket}. Please wait ${remainingDisplay} (${remainingSeconds}s remaining).`,
        cooldown_remaining_seconds: remainingSeconds,
        current_attempt_count: attempts.length,
      };
    }
  }

  // Guardrail 5: Passed all defensive checks
  return {
    allowed: true,
    code: 'ALLOWED',
    message: `All safety guardrails passed. Authorized to dispatch attempt #${attempts.length + 1} of ${maxAttemptsForBucket} (${bucketPolicy.label}).`,
    current_attempt_count: attempts.length,
  };
}

/**
 * Defensive Tone & Ethical Recovery Sanitizer.
 * Enforces NO dark patterns, NO fake urgency, and ensures explicit opt-out wording is appended.
 */
export function sanitizeRecoveryMessage(rawMessage: string): {
  cleanMessage: string;
  violationsFound: string[];
} {
  let clean = rawMessage.trim();
  const violationsFound: string[] = [];

  // Detect and neutralize dark patterns
  for (const pattern of PROHIBITED_DARK_PATTERNS) {
    if (pattern.test(clean)) {
      violationsFound.push(pattern.toString());
      clean = clean.replace(pattern, '');
    }
  }

  // Ensure opt-out clause is present
  const optOutRegex = /\b(opt[- ]?out|reply stop|stop to unsubscribe)\b/i;
  if (!optOutRegex.test(clean)) {
    clean += '\n\n(Reply STOP to opt out of updates)';
  }

  return {
    cleanMessage: clean.replace(/\s{2,}/g, ' '),
    violationsFound,
  };
}
