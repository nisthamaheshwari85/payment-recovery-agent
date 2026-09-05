import { NextResponse } from 'next/server';
import { razorpay } from '@/lib/razorpay';

export async function GET() {
  const rzpStatus = razorpay.getStatus();
  const hasGroq = Boolean(process.env.GROQ_API_KEY);

  return NextResponse.json({
    razorpay: {
      is_configured: rzpStatus.configured,
      key_id_preview: rzpStatus.keyIdPrefix,
      mode: rzpStatus.mode,
      endpoints_supported: [
        'POST https://api.razorpay.com/v1/payment_links',
        'GET https://api.razorpay.com/v1/payment_links/:id',
        'POST /api/webhooks/razorpay (HMAC-SHA256 signature verification)',
      ],
    },
    llm: {
      provider: 'Groq',
      primary_model: 'qwen/qwen3.8-27b',
      fallback_model: 'openai/gpt-oss-20b',
      configured: hasGroq,
      features: [
        'Dynamic contextual Hinglish synthesis',
        'Failure reason telemetry injection',
        'Anti-dark pattern system prompt & post-generation validator',
      ],
    },
    demo_controls: {
      cooldown_fast_forward: 'Available via UI button (satisfies 6-hour guardrail for judging)',
      force_recovery_simulation: 'Available when test keys are in sandbox exploration mode',
    },
  });
}
