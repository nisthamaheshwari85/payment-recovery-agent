import { detectDarkPatterns } from '../src/lib/guardrails';
import { generateHinglishRecoveryMessage } from '../src/lib/agent';

async function verifyRefundGuardrailFix() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log('FIX 2 VERIFICATION: REMOVE SPECIFIC REFUND-TIMELINE PROMISES');
  console.log('════════════════════════════════════════════════════════════════\n');

  // 1. Test Guardrail Detection of Violating Patterns
  console.log('--- 1. Testing Guardrail Rejection on Violating Messages ---');
  const violatingSamples = [
    'Don\'t worry, amount will auto-refund in 24-48 hours.',
    'If money was deducted, your bank will refund within 3 days.',
    'Aapka paisa 24 ghante mein automatically refund ho jayega.',
    'Amount will be refunded within 5-7 business days as per policy.',
    'Auto-refund within 48 hrs guaranteed.',
  ];

  for (const sample of violatingSamples) {
    const result = detectDarkPatterns(sample);
    if (!result.hasViolation) {
      throw new Error(`Expected guardrail violation for: "${sample}", but it passed!`);
    }
    console.log(`✅ Correctly flagged violating message: "${sample}" (Matched: ${result.matched.join(', ')})`);
  }

  // 2. Test Guardrail Allowance on Compliant Non-Committal Phrasing
  console.log('\n--- 2. Testing Guardrail Allowance on Compliant Phrasing ---');
  const compliantSamples = [
    'Namaste Aarav! Agar amount deduct hua ho, toh as per bank standard process refund ho jayega: https://rzp.io/test (Reply STOP to opt out)',
    'Any amount debited will be refunded as per your bank standard process. Retry here: https://rzp.io/test (Reply STOP to opt out)',
    'Dekha aapka payment network issue ki wajah se ruk gaya tha. Link se retry karein: https://rzp.io/test (Reply STOP to opt out)',
  ];

  for (const sample of compliantSamples) {
    const result = detectDarkPatterns(sample);
    if (result.hasViolation) {
      throw new Error(`False positive! Compliant message flagged as violation: "${sample}"`);
    }
    console.log(`✅ Correctly allowed compliant phrasing: "${sample}"`);
  }

  // 3. Test Actual Message Generation
  console.log('\n--- 3. Testing Real Message Generation (No Refund Timelines) ---');
  const testContexts = [
    {
      customerName: 'Aarav Sharma',
      amount: 2499,
      failureBucket: 'upi_timeout' as const,
      failureReasonRaw: 'NPCI PSP response timeout after 45000ms',
      recoverabilityScore: 90,
      attemptNumber: 1,
      retryPaymentLink: 'https://rzp.io/i/test_aarav',
    },
    {
      customerName: 'Pooja Verma',
      amount: 14999,
      failureBucket: 'insufficient_funds' as const,
      failureReasonRaw: 'Available balance less than requested transaction amount',
      recoverabilityScore: 75,
      attemptNumber: 1,
      retryPaymentLink: 'https://rzp.io/i/test_pooja',
    },
    {
      customerName: 'Rohan Gupta',
      amount: 1199,
      failureBucket: 'network_error' as const,
      failureReasonRaw: 'Socket hangup during 3DS redirection handshake',
      recoverabilityScore: 83,
      attemptNumber: 1,
      retryPaymentLink: 'https://rzp.io/i/test_rohan',
    },
  ];

  for (const ctx of testContexts) {
    const output = await generateHinglishRecoveryMessage(ctx);
    console.log(`\nGenerated message for ${ctx.customerName} (${ctx.failureBucket}):`);
    console.log(`"${output.message}"`);
    console.log(`[Model: ${output.modelUsed}]`);

    // Check that no time-bound refund language appears
    const check = detectDarkPatterns(output.message);
    if (check.hasViolation) {
      throw new Error(`Generated message contained prohibited pattern: ${check.matched.join(', ')}`);
    }

    const hasSpecificRefundTime = /refund.*?\b\d+[\s-]*(hour|hr|ghante|day|din)s?\b/i.test(output.message) ||
      /\b\d+[\s-]*(hour|hr|ghante|day|din)s?.*?\brefund\b/i.test(output.message);

    if (hasSpecificRefundTime) {
      throw new Error(`Message contains specific refund timeline! "${output.message}"`);
    }

    console.log('✅ PASS: Message has zero time-bound refund promises and passed all compliance filters.');
  }

  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('🎉 FIX 2 VERIFIED: Specific refund timelines completely removed and strictly gated!');
}

verifyRefundGuardrailFix().catch((err) => {
  console.error('❌ FIX 2 FAILED:', err);
  process.exit(1);
});
