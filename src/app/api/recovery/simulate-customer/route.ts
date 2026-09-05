import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { razorpay } from '@/lib/razorpay';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { transaction_id, action, customer_reply, force_demo } = body;

    if (!transaction_id) {
      return NextResponse.json({ error: 'transaction_id is required' }, { status: 400 });
    }

    const tx = await db.getTransactionById(transaction_id);
    if (!tx) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    // Action: Check live Razorpay status directly from Razorpay's REST API
    if (action === 'check_razorpay_status') {
      const plinkId = tx.razorpay_payment_link_id;
      if (!plinkId || plinkId.startsWith('plink_sim_')) {
        return NextResponse.json({
          success: false,
          is_live_razorpay: false,
          message: 'This transaction uses a demo-simulated link. Real Razorpay API keys required for live polling.',
          current_status: tx.status,
        });
      }

      const rzpStatus = await razorpay.getPaymentLink(plinkId);

      if (!rzpStatus.link) {
        return NextResponse.json({
          success: false,
          error: rzpStatus.error || 'Failed to fetch status from Razorpay API',
        }, { status: 502 });
      }

      const liveStatus = rzpStatus.link.status;

      if (liveStatus === 'paid') {
        const updatedTx = await db.updateTransaction(tx.id, {
          status: 'recovered',
          is_live_razorpay: true,
        });

        if (tx.customer_id) {
          const customer = await db.getCustomerById(tx.customer_id);
          if (customer) {
            await db.updateCustomer(customer.id, {
              total_recovered: (customer.total_recovered || 0) + 1,
            });
          }
        }

        const attempts = await db.getRecoveryAttempts(tx.id);
        if (attempts.length > 0) {
          const latest = attempts[attempts.length - 1];
          latest.outcome = 'recovered';
        }

        return NextResponse.json({
          success: true,
          live_verified: true,
          action: 'check_razorpay_status',
          razorpay_status: liveStatus,
          message: `Live Razorpay API confirmed payment link ${plinkId} is PAID! Transaction marked as recovered.`,
          transaction: updatedTx,
          payments: rzpStatus.link.payments,
        });
      }

      return NextResponse.json({
        success: true,
        live_verified: false,
        action: 'check_razorpay_status',
        razorpay_status: liveStatus,
        message: `Razorpay API reports status as "${liveStatus}". Customer has not completed payment yet on test checkout.`,
        transaction: tx,
      });
    }

    // Action 1: Customer replies "STOP" / "NO" (Opt Out)
    if (action === 'opt_out' || (customer_reply && /^(stop|no|cancel|unsubscribe)$/i.test(customer_reply.trim()))) {
      const updatedCustomer = await db.optOutCustomer({ customer_id: tx.customer_id });
      const updatedTx = await db.updateTransaction(tx.id, {
        status: 'opted_out',
      });

      // Update latest attempt outcome
      const attempts = await db.getRecoveryAttempts(tx.id);
      if (attempts.length > 0) {
        const latest = attempts[attempts.length - 1];
        latest.outcome = 'opted_out';
      }

      return NextResponse.json({
        success: true,
        action: 'opt_out',
        message: 'Customer successfully opted out. do_not_contact set to TRUE. Further automated messaging blocked.',
        customer: updatedCustomer,
        transaction: updatedTx,
      });
    }

    // Action: Customer clicks recovery payment link (Simulate Click)
    if (action === 'simulate_click') {
      const updatedTx = await db.updateTransaction(tx.id, {
        funnel_stage: 'link_clicked',
      });

      const attempts = await db.getRecoveryAttempts(tx.id);
      if (attempts.length > 0) {
        const latest = attempts[attempts.length - 1];
        await db.updateRecoveryAttempt(latest.id, { outcome: 'clicked' });
      }

      return NextResponse.json({
        success: true,
        action: 'simulate_click',
        message: 'Simulated customer click on recovery payment link. Funnel advanced: Messaged → Link Clicked.',
        transaction: updatedTx,
      });
    }

    // Action: Customer re-attempts checkout (Simulate Retry)
    if (action === 'simulate_retry') {
      const updatedTx = await db.updateTransaction(tx.id, {
        funnel_stage: 'payment_retried',
      });

      const attempts = await db.getRecoveryAttempts(tx.id);
      if (attempts.length > 0) {
        const latest = attempts[attempts.length - 1];
        await db.updateRecoveryAttempt(latest.id, { outcome: 'retried' });
      }

      return NextResponse.json({
        success: true,
        action: 'simulate_retry',
        message: 'Simulated customer entering checkout & retrying payment. Funnel advanced: Link Clicked → Payment Retried.',
        transaction: updatedTx,
      });
    }

    // Action 2: Customer completes payment via retry link
    if (action === 'pay_success') {
      let liveVerified = false;
      let rzpFeedback = '';

      // Check if there is an active Razorpay payment link to verify against live API
      if (tx.razorpay_payment_link_id && !tx.razorpay_payment_link_id.startsWith('plink_sim_')) {
        const rzpCheck = await razorpay.getPaymentLink(tx.razorpay_payment_link_id);
        if (rzpCheck.link && rzpCheck.link.status === 'paid') {
          liveVerified = true;
          rzpFeedback = ` (Live verified via Razorpay API: Payment Link ${tx.razorpay_payment_link_id} is PAID)`;
        } else if (rzpCheck.link) {
          rzpFeedback = ` (Razorpay link ${tx.razorpay_payment_link_id} status on Razorpay: ${rzpCheck.link.status}; resolved via demo test trigger)`;
        }
      }

      const updatedTx = await db.updateTransaction(tx.id, {
        status: 'recovered',
        funnel_stage: 'recovered',
      });

      if (tx.customer_id) {
        const customer = await db.getCustomerById(tx.customer_id);
        if (customer) {
          await db.updateCustomer(customer.id, {
            total_recovered: (customer.total_recovered || 0) + 1,
          });
        }
      }

      const attempts = await db.getRecoveryAttempts(tx.id);
      if (attempts.length > 0) {
        const latest = attempts[attempts.length - 1];
        await db.updateRecoveryAttempt(latest.id, { outcome: 'recovered' });
      }

      return NextResponse.json({
        success: true,
        action: 'pay_success',
        live_verified: liveVerified,
        message: `Payment of ₹${tx.amount} marked as recovered${rzpFeedback}. Funnel attributed as Recovered!`,
        transaction: updatedTx,
      });
    }

    // Action 3: Fast-forward cooldown (for live demo testing without waiting 6 real hours)
    if (action === 'expire_cooldown') {
      const attempts = await db.getRecoveryAttempts(tx.id);
      if (attempts.length === 0) {
        return NextResponse.json({ error: 'No attempts exist to fast-forward cooldown on.' }, { status: 400 });
      }

      // Set latest attempt time to 7 hours ago
      const sevenHoursAgo = new Date(Date.now() - 7 * 3600 * 1000).toISOString();
      const latest = attempts[attempts.length - 1];
      latest.sent_at = sevenHoursAgo;

      const store = await db.getStore();
      const idx = store.recovery_attempts.findIndex((a) => a.id === latest.id);
      if (idx !== -1) {
        store.recovery_attempts[idx].sent_at = sevenHoursAgo;
        await db.seed(store);
      }

      return NextResponse.json({
        success: true,
        action: 'expire_cooldown',
        message: 'Fast-forwarded last attempt timestamp to 7 hours ago. 6-hr cooldown satisfied for demo.',
      });
    }

    return NextResponse.json(
      { error: 'Invalid simulation action. Allowed: opt_out, pay_success, expire_cooldown' },
      { status: 400 }
    );
  } catch (err: any) {
    console.error('Error in customer simulation:', err);
    return NextResponse.json(
      { error: 'Customer simulation failed', details: err?.message },
      { status: 500 }
    );
  }
}
