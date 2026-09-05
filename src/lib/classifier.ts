import { FailureBucket } from './types';

export interface ClassificationResult {
  bucket: FailureBucket;
  confidence: number;
  method: 'rules' | 'llm';
  rationale: string;
}

const RULE_PATTERNS: { bucket: FailureBucket; regexes: RegExp[] }[] = [
  {
    bucket: 'upi_timeout',
    regexes: [
      /\bupi\b/i,
      /\bnpci\b/i,
      /\bpsp\b/i,
      /\bmpin\b/i,
      /\bphonepe\b/i,
      /\bgpay\b/i,
      /\bgoogle pay\b/i,
      /\bpaytm upi\b/i,
      /\bvpa\b/i,
      /\bu30\b/i,
      /session timed out/i,
      /authorization timed out/i,
      /bank server busy/i,
      /switch busy/i,
    ],
  },
  {
    bucket: 'card_decline',
    regexes: [
      /\bcard\b/i,
      /\b3ds\b/i,
      /\botp\b/i,
      /\bcvv\b/i,
      /\bcvv2\b/i,
      /\bdebit card\b/i,
      /\bcredit card\b/i,
      /\bvisa\b/i,
      /\bmastercard\b/i,
      /issuer (bank )?declined/i,
      /card expired/i,
      /international.*disabled/i,
      /e-commerce limit/i,
    ],
  },
  {
    bucket: 'network_error',
    regexes: [
      /\bnet::\b/i,
      /err_connection_reset/i,
      /socket hangup/i,
      /connection dropped/i,
      /packet lost/i,
      /dns resolution failure/i,
      /network timeout/i,
      /handshake/i,
      /webview drop/i,
    ],
  },
  {
    bucket: 'insufficient_funds',
    regexes: [
      /insufficient (account )?funds/i,
      /balance less than/i,
      /exceeds.*credit limit/i,
      /wallet balance.*insufficient/i,
      /low balance/i,
      /overdraft limit/i,
      /\b51\b.*funds/i,
    ],
  },
  {
    bucket: 'cart_abandon',
    regexes: [
      /abandoned session/i,
      /dismissed by customer/i,
      /exited checkout/i,
      /modal dismissed/i,
      /drawer without selecting/i,
      /idle \d+s/i,
      /navigated back to cart/i,
      /checkout sheet closed/i,
    ],
  },
];

async function callGroqClassifier(failureReason: string): Promise<ClassificationResult | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  try {
    const prompt = `Classify this failed payment / checkout drop-off reason into exactly ONE bucket:
- upi_timeout
- card_decline
- network_error
- cart_abandon
- insufficient_funds
- other

Payment Failure Reason: "${failureReason}"

Reply with ONLY a JSON object with this exact format:
{"bucket": "upi_timeout|card_decline|network_error|cart_abandon|insufficient_funds|other", "confidence": 0.95, "rationale": "one sentence explanation"}`;

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const parsed = JSON.parse(data.choices[0].message.content);
    if (parsed.bucket && typeof parsed.bucket === 'string') {
      return {
        bucket: parsed.bucket as FailureBucket,
        confidence: parsed.confidence || 0.9,
        method: 'llm',
        rationale: parsed.rationale || 'Classified by Groq LLM based on payment telemetry',
      };
    }
  } catch (err) {
    console.warn('Groq classifier error, using rules fallback:', err);
  }
  return null;
}

export async function classifyFailureReason(
  failureReasonRaw: string
): Promise<ClassificationResult> {
  const text = failureReasonRaw.trim();

  // 1. High-precision rule matching
  for (const { bucket, regexes } of RULE_PATTERNS) {
    for (const regex of regexes) {
      if (regex.test(text)) {
        return {
          bucket,
          confidence: 0.95,
          method: 'rules',
          rationale: `Matched deterministic payment failure pattern: ${regex.toString()}`,
        };
      }
    }
  }

  // 2. Fallback to Groq LLM classifier
  const llmResult = await callGroqClassifier(text);
  if (llmResult) return llmResult;

  // 3. Default fallback
  return {
    bucket: 'other',
    confidence: 0.5,
    method: 'rules',
    rationale: 'Uncategorized failure reason, assigned to generic review bucket',
  };
}
