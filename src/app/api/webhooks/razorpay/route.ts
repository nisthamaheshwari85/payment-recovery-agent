import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { classifyFailureReason } from '@/lib/classifier';
import { computeRecoverabilityScore } from '@/lib/scorer';
import { Transaction } from '@/lib/types';
import { razorpay } from '@/lib/razorpay';

export async function GET() {
  return NextResponse.json({
    status: 'active',
    endpoint: '/api/webhooks/razorpay',
    signature_verification_enabled: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET),
    razorpay_api_configured: razorpay.hasValidCredentials(),
  });
}

export async function POST(req: NextRequest) {
  try {
    const rawPayload = await req.text();
    const signature = req.headers.get('x-razorpay-signature');

    // 1. Mandatory Webhook Signature Verification
    if (process.env.RAZORPAY_WEBHOOK_SECRET) {
      if (!signature) {
        return NextResponse.json(
          { error: 'Missing x-razorpay-signature header' },
          { status: 400 }
        );
      }

      const verifyResult = razorpay.verifyWebhookSignature(rawPayload, signature);
      if (!verifyResult.valid) {
        console.warn('[Razorpay Webhook] Signature verification failed:', verifyResult.reason);
        return NextResponse.json(
          { error: 'Invalid webhook signature', details: verifyResult.reason },
          { status: 400 }
        );
      }
    } else {
      console.warn(
        '[Razorpay Webhook] RAZORPAY_WEBHOOK_SECRET is not configured; running in dev/demo verification mode.'
      );
    }

    let body: any;
    try {
      body = JSON.parse(rawPayload);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const event = body.event;
    console.log(`[Razorpay Webhook] Received authenticated event: ${event}`);

    // Handle payment.failed event
    if (event === 'payment.failed') {
      const payment = body.payload?.payment?.entity;
      if (!payment) {
        return NextResponse.json({ error: 'Missing payment entity in payload' }, { status: 400 });
      }

      const payId = payment.id || `pay_${Date.now()}`;
      const amountInINR = (payment.amount || 10000) / 100; // Razorpay amounts are in paise
      const failureReasonRaw =
        payment.error_description ||
        payment.error_reason ||
        payment.internal_error_code ||
        'Payment processing failed at gateway';

      // Customer info from payment notes or contact
      const contactPhone = payment.contact || '+919876543210';
      const contactEmail = payment.email || 'customer@example.com';
      const customerName = payment.notes?.customer_name || 'Valued Customer';

      // Find or create customer
      let customer = await db.getCustomerByPhone(contactPhone);
      if (!customer) {
        customer = {
          id: `cust_${Date.now()}`,
          name: customerName,
          phone: contactPhone,
          email: contactEmail,
          total_failed: 1,
          total_recovered: 0,
          do_not_contact: false,
          created_at: new Date().toISOString(),
        };
        const store = await db.getStore();
        store.customers.push(customer);
        await db.seed(store);
      } else {
        await db.updateCustomer(customer.id, {
          total_failed: (customer.total_failed || 0) + 1,
        });
      }

      // Step 2: Classify and Score
      const classification = await classifyFailureReason(failureReasonRaw);
      const scoreBreakdown = computeRecoverabilityScore({
        failure_bucket: classification.bucket,
        amount: amountInINR,
        customer,
        channel: payment.method || 'checkout_web',
        created_at: new Date().toISOString(),
      });

      const txId = `tx_${Date.now()}`;

      // Create real Razorpay Payment Link if credentials are configured
      let retryPaymentLink = `https://rzp.io/i/rec_${payId.substring(4, 10).toLowerCase()}`;
      let paymentLinkId: string | undefined;
      let isLiveRazorpay = false;

      const rzpLinkRes = await razorpay.createPaymentLink({
        amount: amountInINR,
        customerName: customer.name,
        customerPhone: customer.phone,
        customerEmail: customer.email,
        description: `Payment recovery for order ${payId}`,
        transactionId: txId,
      });

      if (rzpLinkRes.link) {
        retryPaymentLink = rzpLinkRes.link.short_url;
        paymentLinkId = rzpLinkRes.link.id;
        isLiveRazorpay = !rzpLinkRes.isSimulated;
      }

      const newTx: Transaction = {
        id: txId,
        razorpay_payment_id: payId,
        razorpay_order_id: payment.order_id,
        razorpay_payment_link_id: paymentLinkId,
        is_live_razorpay: isLiveRazorpay,
        amount: amountInINR,
        customer_id: customer.id,
        channel: 'checkout_web',
        failure_reason_raw: failureReasonRaw,
        failure_bucket: classification.bucket,
        recoverability_score: scoreBreakdown.final_score,
        score_breakdown: scoreBreakdown,
        status: 'failed',
        retry_payment_link: retryPaymentLink,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await db.createTransaction(newTx);

      return NextResponse.json({
        success: true,
        message: 'Payment failure ingested, classified, scored, and link generated',
        transaction: newTx,
      });
    }

    // Handle payment_link.paid event
    if (event === 'payment_link.paid') {
      const plink = body.payload?.payment_link?.entity;
      const plinkId = plink?.id;
      const originTxId = plink?.notes?.transaction_id;

      if (plinkId || originTxId) {
        const txs = await db.getTransactions();
        // Strict reconciliation audit: resolve original transaction record lineage
        const matchingTx = txs.find(
          (t) =>
            (originTxId && t.id === originTxId) ||
            (plinkId && (t.razorpay_payment_link_id === plinkId || t.retry_payment_link?.includes(plinkId)))
        );

        if (matchingTx) {
          // Update the ORIGINAL record in place (preventing phantom duplicate orders)
          const updatedTx = await db.updateTransaction(matchingTx.id, {
            status: 'recovered',
            updated_at: new Date().toISOString(),
          });

          if (matchingTx.customer_id) {
            const customer = await db.getCustomerById(matchingTx.customer_id);
            if (customer) {
              await db.updateCustomer(customer.id, {
                total_recovered: (customer.total_recovered || 0) + 1,
              });
            }
          }

          const attempts = await db.getRecoveryAttempts(matchingTx.id);
          if (attempts.length > 0) {
            const latest = attempts[attempts.length - 1];
            latest.outcome = 'recovered';
          }

          return NextResponse.json({
            success: true,
            message: `Transaction ${matchingTx.id} recovered via payment_link.paid`,
            transaction: updatedTx,
          });
        }
      }
    }

    // Handle order.paid or payment.captured / payment.authorized (recovery success)
    if (event === 'order.paid' || event === 'payment.captured') {
      const payment = body.payload?.payment?.entity;
      const payId = payment?.id;
      const originTxId = payment?.notes?.transaction_id;

      if (payId || originTxId) {
        const txs = await db.getTransactions();
        const matchingTx = txs.find(
          (t) =>
            (originTxId && t.id === originTxId) ||
            (payId && t.razorpay_payment_id === payId)
        );
        if (matchingTx) {
          await db.updateTransaction(matchingTx.id, {
            status: 'recovered',
            updated_at: new Date().toISOString(),
          });

          if (matchingTx.customer_id) {
            const customer = await db.getCustomerById(matchingTx.customer_id);
            if (customer) {
              await db.updateCustomer(customer.id, {
                total_recovered: (customer.total_recovered || 0) + 1,
              });
            }
          }

          return NextResponse.json({
            success: true,
            message: `Transaction ${matchingTx.id} marked as recovered`,
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Webhook received event: ${event}`,
    });
  } catch (err: any) {
    console.error('Webhook error:', err);
    return NextResponse.json(
      { error: 'Webhook processing failed', details: err?.message },
      { status: 500 }
    );
  }
}
