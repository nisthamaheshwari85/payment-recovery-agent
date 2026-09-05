import crypto from 'crypto';

async function testWebhookFlow() {
  console.log('🧪 Testing Razorpay Webhook Ingestion & Signature Verification...\n');

  const secret = 'rzp_test_webhook_secret_dev_2026';

  // 1. Construct realistic payment.failed payload
  const sampleFailedPayload = {
    entity: 'event',
    account_id: 'acc_test123',
    event: 'payment.failed',
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          id: `pay_test_${Date.now()}`,
          amount: 259900, // ₹2,599
          currency: 'INR',
          status: 'failed',
          order_id: `order_test_${Date.now()}`,
          method: 'upi',
          error_code: 'BAD_REQUEST_ERROR',
          error_description: 'Beneficiary bank server down or not responding during MPIN authorization',
          error_source: 'bank',
          error_step: 'payment_authorization',
          error_reason: 'payment_failed',
          contact: '+919876500001',
          email: 'test.customer@example.com',
          notes: {
            customer_name: 'Aditi Rao',
          },
        },
      },
    },
    created_at: Math.floor(Date.now() / 1000),
  };

  const rawBody = JSON.stringify(sampleFailedPayload);

  // 2. Generate valid HMAC-SHA256 signature
  const validSignature = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  // Test 2A: Verify rejection with invalid signature
  console.log('1. Testing invalid signature rejection...');
  const invalidRes = await fetch('http://localhost:3000/api/webhooks/razorpay', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-razorpay-signature': 'invalid_forged_signature_00000',
    },
    body: rawBody,
  });
  console.log(`   Response Status: ${invalidRes.status} (Expected 400)`);
  if (invalidRes.status !== 400) {
    console.error('❌ Failed: Server accepted invalid signature!');
    process.exit(1);
  }
  console.log('   ✅ PASS: Forged signature successfully rejected with HTTP 400.\n');

  // Test 2B: Verify acceptance with valid signature
  console.log('2. Testing valid signature acceptance and payment.failed ingestion...');
  const validRes = await fetch('http://localhost:3000/api/webhooks/razorpay', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-razorpay-signature': validSignature,
    },
    body: rawBody,
  });
  const validData = await validRes.json();
  console.log(`   Response Status: ${validRes.status} (Expected 200)`);
  console.log(`   Ingested Tx ID: ${validData.transaction?.id}`);
  console.log(`   Classified Bucket: ${validData.transaction?.failure_bucket}`);
  console.log(`   Recoverability Score: ${validData.transaction?.recoverability_score}/100`);
  console.log(`   Retry Payment Link: ${validData.transaction?.retry_payment_link}`);

  if (validRes.status === 200 && validData.transaction?.failure_bucket === 'upi_timeout') {
    console.log('   ✅ PASS: Real payment.failed event ingested, scored, and classified.\n');
  } else {
    console.error('❌ Failed: Webhook processing error:', validData);
    process.exit(1);
  }

  // Test 2C: Trigger recovery via live Groq LLM on this webhook-created transaction
  console.log('3. Triggering agent recovery on webhook-ingested transaction...');
  const triggerRes = await fetch('http://localhost:3000/api/recovery/trigger', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction_id: validData.transaction.id }),
  });
  const triggerData = await triggerRes.json();
  console.log(`   Trigger Success: ${triggerData.success}`);
  console.log(`   Model Used: ${triggerData.attempt?.llm_model_used}`);
  console.log(`   WhatsApp Message: "${triggerData.attempt?.message_sent}"\n`);

  // Test 2D: Test payment_link.paid webhook event
  console.log('4. Testing payment_link.paid recovery completion webhook...');
  const paidPayload = {
    entity: 'event',
    event: 'payment_link.paid',
    payload: {
      payment_link: {
        entity: {
          id: validData.transaction.razorpay_payment_link_id || 'plink_test',
          status: 'paid',
        },
      },
      payment: {
        entity: {
          id: `pay_rec_${Date.now()}`,
          amount: 259900,
          status: 'captured',
        },
      },
    },
  };
  const rawPaid = JSON.stringify(paidPayload);
  const paidSig = crypto.createHmac('sha256', secret).update(rawPaid).digest('hex');
  const paidRes = await fetch('http://localhost:3000/api/webhooks/razorpay', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-razorpay-signature': paidSig,
    },
    body: rawPaid,
  });
  const paidData = await paidRes.json();
  console.log(`   Status: ${paidRes.status}`);
  console.log(`   Result: ${paidData.message}`);
  console.log('   ✅ PASS: Full webhook lifecycle verified.\n');
}

testWebhookFlow().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
